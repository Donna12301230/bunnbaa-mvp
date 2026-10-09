// 颱風與天災（規格 §11）。
// 資料來源：國家災害防救科技中心 CAP Atom feed（彙整中央氣象署、人事行政總處），
//   停班停課 AlertType=33、颱風 AlertType=5。可用 DISASTER_FEED_BASE 覆寫；抓不到時平台管理者
//   可在後台手動建立天災事件（備援）。
// disasterEvents/{id}：type: work_suspension|typhoon_warning|price_spike, counties[], towns[], dates[],
//   source: ncdr|manual, summary, processed, result
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const {
  REGION, db, onCall, HttpsError, FieldValue, logger, t, assertAdminOrEmulator, callerVendorId, notifyUser, notifyVendor,
  allVendors, countyOf,
} = require("./common");
const { loadVendorCatalog } = require("./common");
const { componentCost, portionLevelFor } = require("./bento");
const { ACTIVE_LOCK_STATUSES } = require("./prep");
const { taipeiToday, addDays } = require("./calendar");
const { helpers } = require("./orders");

const FEED_BASE = () => process.env.DISASTER_FEED_BASE || "https://alerts.ncdr.nat.gov.tw/RssAtomFeed.ashx?AlertType=";

function parseEntries(xml) {
  const entries = [];
  for (const m of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const body = m[1];
    const pick = (tag) => (body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || "";
    entries.push({ id: pick("id").trim(), title: pick("title").trim(), summary: pick("summary").trim(), updated: pick("updated").trim() });
  }
  return entries;
}

/**
 * 「[停班停課通知]臺北市:明天停止上班、停止上課。」→ { county, town, date }
 * 只看「停止上班」（上班族午餐）；只停課不影響。「今天晚上」不影響午餐。
 */
function parseSuspension(entry) {
  const text = entry.summary.replace(/台/g, "臺");
  const segments = text.replace(/^\[[^\]]*\]/, "").split(/[。；;]/);
  const baseDate = (entry.updated || "").slice(0, 10) || taipeiToday();
  const out = [];
  for (const seg of segments) {
    const m = seg.match(/^\s*(\S{2}[市縣])(\S*?[區鄉鎮市])?\s*[:：](.*)$/);
    if (!m) continue;
    const [, county, town, rest] = m;
    if (!rest.includes("停止上班")) continue;
    if (/今天晚上|今晚/.test(rest) && !/明天/.test(rest)) continue;
    const date = /明天/.test(rest) ? addDays(baseDate, 1) : baseDate;
    out.push({ county, town: town || null, date });
  }
  return out;
}

async function pollFeeds() {
  const created = [];
  try {
    const res = await fetch(`${FEED_BASE()}33`);
    for (const entry of parseEntries(await res.text())) {
      if (!entry.id) continue;
      const found = parseSuspension(entry);
      if (found.length === 0) continue;
      const id = `ncdr_${entry.id}`.replace(/[^\w-]/g, "_").slice(0, 140);
      const ref = db().collection("disasterEvents").doc(id);
      if ((await ref.get()).exists) continue;
      await ref.set({
        type: "work_suspension",
        counties: [...new Set(found.map((f) => f.county))],
        towns: found.filter((f) => f.town).map((f) => `${f.county}${f.town}`),
        whole_counties: found.filter((f) => !f.town).map((f) => f.county),
        dates: [...new Set(found.map((f) => f.date))],
        source: "ncdr",
        summary: entry.summary.slice(0, 500),
        processed: false,
        created_at: FieldValue.serverTimestamp(),
      });
      created.push(id);
    }
  } catch (err) {
    logger.warn("work-suspension feed failed", err);
  }
  try {
    const res = await fetch(`${FEED_BASE()}5`);
    const today = taipeiToday();
    for (const entry of parseEntries(await res.text())) {
      if (!entry.id || !(entry.updated || "").startsWith(today.slice(0, 7))) continue;
      if (Date.now() - Date.parse(entry.updated) > 2 * 86400000) continue;
      const id = `ncdr_${entry.id}`.replace(/[^\w-]/g, "_").slice(0, 140);
      const ref = db().collection("disasterEvents").doc(id);
      if ((await ref.get()).exists) continue;
      await ref.set({
        type: "typhoon_warning", counties: [], towns: [], whole_counties: [], dates: [today, addDays(today, 1), addDays(today, 2)],
        source: "ncdr", summary: entry.summary.replace(/^[\w\d.,:+\-\s]*?(?=[一-鿿])/, "").slice(0, 300),
        processed: false, created_at: FieldValue.serverTimestamp(),
      });
      created.push(id);
    }
  } catch (err) {
    logger.warn("typhoon feed failed", err);
  }
  return created;
}

exports.pollDisasterFeeds = onSchedule({ schedule: "every 15 minutes", timeZone: "Asia/Taipei", region: REGION }, async () => {
  await pollFeeds();
});

exports.triggerDisasterPollNow = onCall({}, async (request) => {
  assertAdminOrEmulator(request);
  return { created: await pollFeeds() };
});

function vendorAffected(vendor, event) {
  if (event.type === "typhoon_warning" || event.type === "price_spike") {
    return (event.counties || []).length === 0 || event.counties.includes(countyOf(vendor.address));
  }
  const county = countyOf(vendor.address);
  if (!county) return false;
  if ((event.whole_counties || event.counties || []).includes(county) && !(event.towns || []).some((x) => x.startsWith(county))) return true;
  const addr = String(vendor.address || "").replace(/台/g, "臺");
  return (event.towns || []).some((x) => addr.includes(x.replace(county, "")) && x.startsWith(county));
}

/** 重算品項候選菜的份量級距（菜價變動後；只影響未截單日期，已截單的份量已鎖定） */
async function recalcPortionLevels(vendorId) {
  const catalog = await loadVendorCatalog(vendorId);
  const batch = db().batch();
  let changed = 0;
  for (const item of Object.values(catalog.itemsById)) {
    if (!Array.isArray(item.slots)) continue;
    const slots = item.slots.map((slot) => {
      const base = componentCost(catalog.componentsById[slot.default?.component_id], catalog.ingredientsById);
      const candidates = (slot.candidates || []).map((c) => {
        const level = portionLevelFor(base, componentCost(catalog.componentsById[c.component_id], catalog.ingredientsById));
        if (level !== c.portion_level) changed++;
        return { ...c, portion_level: level ?? 0.5, disabled: level === null };
      });
      return { ...slot, candidates };
    });
    batch.update(db().collection("menu_items").doc(item.id), { slots });
  }
  await batch.commit();
  return changed;
}

exports.recalcPortionLevels = onCall({}, async (request) => {
  const vendorId = await callerVendorId(request, request.data?.vendor_id);
  return { changed: await recalcPortionLevels(vendorId) };
});

async function processEvent(ref, event) {
  const vendors = (await allVendors()).filter((v) => vendorAffected(v, event));
  const result = { vendors: vendors.length, cancelled: 0, failed: 0, notified: 0 };
  for (const vendor of vendors) {
    if (event.type === "work_suspension") {
      for (const date of event.dates || []) {
        const locks = await helpers.activeLocksOn(vendor.id, date);
        for (const doc of locks) {
          try {
            if (await helpers.cancelAndRefund(doc.ref, "disaster")) {
              result.cancelled++;
              // 2026-10-09 起退款一律退成平台點數（給付款人），可結帳折抵或到會員中心退回 LINE Pay
              const d = doc.data();
              const payer = d.payer_uid || d.buyer_uid;
              await notifyUser(d.buyer_uid, {
                kind: "disaster",
                title: t("停班停課，訂單已自動取消", "Work suspension — order cancelled"),
                body: payer === d.buyer_uid
                  ? t(`${date}「${d.item_name}」已取消，款項已全額退成平台點數，可結帳折抵或到會員中心退回 LINE Pay；折價券已退回。`,
                    `${date} ${d.item_name} was cancelled. The full amount is back as BunnBaa points — use them at checkout or send them back to LINE Pay from My account.`)
                  : t(`${date}「${d.item_name}」已取消，款項已全額退成點數給原付款人。`, `${date} ${d.item_name} was cancelled; the payer got the full amount back as points.`),
                link: payer === d.buyer_uid ? "/profile?tab=points" : "/my-bookings",
              });
              if (payer !== d.buyer_uid) {
                await notifyUser(payer, {
                  kind: "refund",
                  title: t("停班停課，款項已退成點數", "Work suspension — refunded as points"),
                  body: t(`你付款的「${d.item_name}」（${date}）因停班停課取消，款項已全額退成平台點數。`, `${d.item_name} (${date}), which you paid for, was cancelled; the full amount is back as points.`),
                  link: "/profile?tab=points",
                });
              }
            }
          } catch (err) {
            result.failed++;
            logger.error(`disaster refund failed for lock ${doc.id}`, err);
          }
        }
        await db().collection("vendors").doc(vendor.id).set({ disaster_dates: FieldValue.arrayUnion(date) }, { merge: true });
      }
      await notifyVendor(vendor.id, {
        title: t("停班停課：訂單已自動取消退款", "Work suspension: orders cancelled and refunded"),
        body: t(`${(event.dates || []).join("、")} 的訂單已全額退成消費者的平台點數，不計入營業額與抽獎券，平台不收抽成。`, `Orders on ${(event.dates || []).join(", ")} were refunded to customers as points; they don't count toward revenue, tickets or commission.`),
        link: "/vendor-portal/orders",
      });
    } else if (event.type === "typhoon_warning") {
      const upcoming = [];
      for (const date of event.dates || []) {
        if ((await helpers.activeLocksOn(vendor.id, date)).length > 0) upcoming.push(date);
      }
      await db().collection("vendors").doc(vendor.id).set({ typhoon_notice: { dates: event.dates, event_id: ref.id } }, { merge: true });
      if (upcoming.length > 0) {
        result.notified++;
        await notifyVendor(vendor.id, {
          title: "颱風警報：請留意採購",
          body: `${upcoming.join("、")} 有訂單。建議葉菜延後到貨、預設配菜暫改耐放菜；停班時訂單會自動取消退款。`,
          link: "/vendor-portal/purchasing",
        });
      }
    } else if (event.type === "price_spike") {
      await recalcPortionLevels(vendor.id);
      result.notified++;
      await notifyVendor(vendor.id, {
        title: "菜價變動：份量級距已重算",
        body: "未截單日期的候選菜份量級距已依最新單價重算；已截單訂單可在「每日備料」等值替換配菜。",
        link: "/vendor-portal/menu",
      });
    }
  }
  const ok = result.failed === 0;
  await ref.update({ processed: ok, result, processed_at: FieldValue.serverTimestamp() });
  return result;
}

/** 新事件（自動或手動）→ 處理；退款失敗的會在管理員按「重新處理」時再試 */
exports.onDisasterEventWritten = onDocumentWritten({ document: "disasterEvents/{id}", region: REGION }, async (event) => {
  const after = event.data?.after;
  if (!after?.exists) return;
  const data = after.data();
  if (data.processed || data.result) return;
  await processEvent(after.ref, data);
});

exports.reprocessDisasterEvent = onCall({ timeoutSeconds: 300 }, async (request) => {
  assertAdminOrEmulator(request);
  const ref = db().collection("disasterEvents").doc(String(request.data?.event_id || "_"));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "event not found");
  return processEvent(ref, snap.data());
});

/**
 * 天災期間等值替換配菜（§11，須事先寫入訂購條款）：已截單的訂單，店家把某道菜換成
 * 等值的另一道，並通知消費者。
 */
exports.substituteDish = onCall({}, async (request) => {
  const vendorId = await callerVendorId(request, request.data?.vendor_id);
  const { date, from, to } = request.data || {};
  if (!date || !from || !to) throw new HttpsError("invalid-argument", "date, from, to are required");
  const snap = await db().collection("locks").where("vendor_id", "==", vendorId).where("pickup_date", "==", date).get();
  const vendor = (await db().collection("vendors").doc(vendorId).get()).data();
  let changed = 0;
  for (const doc of snap.docs) {
    const lock = doc.data();
    if (!ACTIVE_LOCK_STATUSES.includes(lock.status)) continue;
    let hit = false;
    const slots = (lock.slots || []).map((s) => {
      const current = s.resolved || s.default_dish;
      if (!s.removed && current === from) {
        hit = true;
        return { ...s, resolved: to, substituted_from: from };
      }
      return s;
    });
    if (!hit) continue;
    await doc.ref.update({ slots });
    changed++;
    await notifyUser(lock.buyer_uid, {
      kind: "disaster",
      title: t("配菜等值替換通知", "Side dish substituted"),
      body: t(`因天災／菜價異常，「${vendor.name}」${date} 的「${from}」改為「${to}」。`, `${vendor.name} replaced ${from} with ${to} on ${date}.`),
      link: "/my-bookings",
    });
  }
  const planRef = db().collection("vendors").doc(vendorId).collection("prepPlans").doc(date);
  await planRef.set({ substitutions: FieldValue.arrayUnion({ from, to }) }, { merge: true });
  return { changed };
});

module.exports.parseSuspension = parseSuspension;
