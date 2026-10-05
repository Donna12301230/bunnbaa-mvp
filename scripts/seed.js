/**
 * Seeds a coherent demo dataset across every collection the deployed backend
 * actually reads/writes (see functions/src/index.js + firestore.rules):
 * vendors, locks (historical + current), payouts, accuracy_reports,
 * discount_explanations, growth_rewards, draws.
 *
 * Story this tells (2026-09-23 seed, TODO.md pilot scope):
 *   - cafe-renheya-demo ("仁和雅咖啡"): the hero vendor every hardcoded
 *     VENDOR_ID in the frontend (Marketplace/VendorDashboard/VendorPortal*)
 *     points at. 45 days of history, accuracy improving 55%→90%, settled
 *     payouts cross the 20萬 growth-reward threshold so the consumer-side
 *     draw card + VendorPortalGrowth page both have something to show.
 *   - wang-mama-biandang / ajia-friedchicken: two more real vendors with
 *     their own history at different reliability levels (variable, not
 *     stable) — populates the admin cross-vendor screens with more than
 *     one data point. Not wired into any hardcoded consumer-facing page,
 *     same limitation the real multi-vendor flows already have.
 *   - zaoan-sandwich: a brand-new vendor with zero history (reliability
 *     "new", no accuracy_reports) — the calibration agent's real behavior
 *     ("skip vendors with no fulfilled/no_show rounds yet") means this one
 *     deliberately gets none, not an oversight.
 *
 * AI-generated fields (accuracy_reports, discount_explanations) are
 * hand-written here instead of calling Gemini — the API key isn't
 * provisioned yet (TODO.md 卡點 2). discount_explanations is pre-warmed
 * *before* any lock is written, so the real deployed `onLockCreated`
 * trigger finds a cache hit for every lock this script creates and never
 * attempts a Gemini call. Swap in real reports once the key lands; nothing
 * here needs to change to stop conflicting with it.
 *
 * Plan-type locks (訂閱制多日方案, HomePage.tsx handleJoinPlan) are
 * deliberately NOT seeded — they're only ever visible on the buyer's own
 * MyBookings page (queried by buyer_uid), and a synthetic buyer_uid isn't
 * reachable by anyone signing in for the demo. Same call the project
 * already made for this (TODO.md: "「計畫型」...這次沒有補假資料").
 *
 * Usage:
 *   cd scripts && npm install       # one-time: installs firebase-admin locally
 *   node scripts/seed.js            # refuses to run if any target vendor already has locks
 *   node scripts/seed.js --force    # seeds anyway (will duplicate data)
 *   node scripts/seed.js --catalog-only  # only (re)seeds menu_items/meal_plans/
 *                                          ban_appeals/vendor profile fields —
 *                                          idempotent (deterministic doc ids),
 *                                          safe to run even though the historical
 *                                          locks/payouts have already been seeded
 *   node scripts/seed.js --config-only   # only writes platform_config/growth +
 *                                          landing_events (overwrites them)
 *

 * Requires a service account key. Either:
 *   - run via `firebase emulators:exec` against the local emulator, or
 *   - set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON
 *     for the real bunnbaa-mvp-5474 project (this is what TODO.md's
 *     "錄 demo 前再灌資料" step means).
 *
 * After running against production, still manually needed (this script
 * can't do it — no real Firebase Auth UID to bind):
 *   - vendors/{id}.owner_uid for each vendor, per TODO.md "商家帳號綁定"
 *     流程, otherwise the vendor-portal login guard has nothing to match.
 */
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

const FORCE = process.argv.includes("--force");
const CATALOG_ONLY = process.argv.includes("--catalog-only");
// 只寫平台設定（platform_config/growth、landing_events），不動商家／菜單／帳號，正式站補資料用
const CONFIG_ONLY = process.argv.includes("--config-only");

/* ------------------------------------------------------------------ *
 * Small helpers shared with the deployed backend — duplicated instead
 * of imported because this is a plain CommonJS script and functions/src
 * is a separate npm package; keep these two in sync by hand if either
 * side changes.
 * ------------------------------------------------------------------ */

// functions/src/index.js cacheKeyFor()
function cacheKeyFor({ vendor_id, item_name, discount_percent, resellable, pickup_window }) {
  return [vendor_id, item_name, discount_percent, resellable, pickup_window]
    .join("|")
    .replace(/[^a-zA-Z0-9|_.:-]/g, "_")
    .slice(0, 200);
}

// web/src/lib/pricing.ts EARLY_BIRD_TIERS / applyEarlyBirdPrice()
const EARLY_BIRD_TIERS = [
  { minDays: 0, maxDays: 1, discountPercent: 5 },
  { minDays: 2, maxDays: 13, discountPercent: 20 },
  { minDays: 14, maxDays: 30, discountPercent: 30 },
];
function priceForDaysAhead(original, daysAhead) {
  const tier = EARLY_BIRD_TIERS.find((t) => daysAhead >= t.minDays && daysAhead <= t.maxDays);
  const discountPercent = tier ? tier.discountPercent : 0;
  return { discountPercent, lockedPrice: Math.round(original * (1 - discountPercent / 100)) };
}

function daysAgo(n, hour = 12) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}
function daysFromNow(n, hour = 12) {
  return daysAgo(-n, hour);
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function pick(arr, i) {
  return arr[i % arr.length];
}

/** Auto-flushing batch so callers don't have to think about the 500-op cap. */
class BatchWriter {
  constructor(limit = 400) {
    this.limit = limit;
    this.batch = db.batch();
    this.count = 0;
    this.totalCommitted = 0;
  }
  async set(ref, data) {
    this.batch.set(ref, data);
    this.count++;
    if (this.count >= this.limit) await this.flush();
  }
  async update(ref, data) {
    this.batch.update(ref, data);
    this.count++;
    if (this.count >= this.limit) await this.flush();
  }
  async flush() {
    if (this.count === 0) return;
    await this.batch.commit();
    this.totalCommitted += this.count;
    this.batch = db.batch();
    this.count = 0;
  }
}

/* ------------------------------------------------------------------ *
 * Vendor config
 * ------------------------------------------------------------------ */

const VENDORS = [
  {
    id: "cafe-renheya-demo",
    name: "仁和雅咖啡",
    itemName: "招牌鮭魚御飯糰便當",
    itemCategory: "便當",
    description: "使用在地食材的家常咖啡輕食，主打鮭魚御飯糰便當",
    address: "嘉義市東區林森東路 212 號",
    phone: "05-276-1188",
    originalPrice: 160,
    pickupWindow: "12:00-13:00",
    verified: true,
    historyDays: 45,
    locksPerDay: 42,
    accuracyStart: 0.55,
    accuracyEnd: 0.9,
    rainyEveryNDays: 5,
    rainPenalty: 0.15,
    unsettledRecentDays: 2, // left for the live demo to settle via triggerSettlementNow
    targetMinRevenue: 210000, // safely clears the 20萬 growth-reward tier1, nowhere near tier2 (100萬)
    buyerPrefix: "demo-user-cafe",
  },
  {
    id: "wang-mama-biandang",
    name: "王媽媽便當",
    itemName: "招牌排骨便當",
    itemCategory: "便當",
    description: "家常台式便當，每日現炒現做",
    address: "嘉義市西區忠孝路 45 號",
    phone: "05-223-9981",
    originalPrice: 130,
    pickupWindow: "12:00-12:30",
    verified: false,
    historyDays: 20,
    locksPerDay: 18,
    accuracyStart: 0.6,
    accuracyEnd: 0.79, // ends just under the 0.8 "stable" cutoff on purpose
    rainyEveryNDays: 6,
    rainPenalty: 0.12,
    unsettledRecentDays: 1,
    buyerPrefix: "demo-user-wangmama",
  },
  {
    id: "ajia-friedchicken",
    name: "阿嘉炸雞排",
    itemName: "酥脆雞排",
    itemCategory: "炸物",
    description: "酥脆現炸雞排、雞塊、薯條",
    address: "嘉義市西區中山路 88 號",
    phone: "05-234-5678",
    originalPrice: 85,
    pickupWindow: "17:00-18:00",
    verified: false,
    historyDays: 10,
    locksPerDay: 12,
    accuracyStart: 0.45,
    accuracyEnd: 0.65,
    rainyEveryNDays: 4,
    rainPenalty: 0.15,
    unsettledRecentDays: 1,
    buyerPrefix: "demo-user-ajia",
  },
  {
    id: "zaoan-sandwich",
    name: "早安三明治",
    itemName: "手工厚蛋三明治",
    itemCategory: "早餐",
    description: "現點現做手工厚蛋三明治",
    address: "嘉義市東區大學路 168 號",
    phone: "05-345-6789",
    originalPrice: 60,
    pickupWindow: "08:00-09:00",
    verified: false,
    historyDays: 0, // brand new — no history at all, reliability stays "new"
    buyerPrefix: "demo-user-zaoan",
  },
];

const GENERAL_NO_SHOW_NOTES = [
  "客人臨時有事沒來",
  "客人忘記取餐時間，已過取餐時段",
  "客人表示訂單重複，忘記取消其中一筆",
  "臨時加班無法前來取餐",
];
const RAINY_NO_SHOW_NOTES = [
  "當天下大雨，客人説不想出門",
  "雨勢太大，客人臨時改叫外送",
  "下雨天出門不方便，客人取消到店意願",
];
const FEEDBACK_TEXTS = [
  "東西很好吃，下次還會訂",
  "份量剛好，口味很不錯",
  "準時可以取餐，體驗很好",
  "包裝很用心，會再回購",
];

/* ------------------------------------------------------------------ *
 * discount_explanations cache — must be written before any lock, so
 * onLockCreated finds a cache hit instead of calling Gemini.
 * ------------------------------------------------------------------ */

function buildExplanationCombos() {
  const cafe = VENDORS[0];
  const wangmama = VENDORS[1];
  const ajia = VENDORS[2];
  const zaoan = VENDORS[3];
  return [
    {
      vendor_id: cafe.id, item_name: cafe.itemName, discount_percent: 5, resellable: true, pickup_window: cafe.pickupWindow,
      explanation_text: "這是當日／隔日取餐的早鳥價（95折）。鎖定後如果沒辦法來取，可以在取餐前轉賣或贈送給別人，不會直接損失。",
    },
    {
      vendor_id: cafe.id, item_name: cafe.itemName, discount_percent: 5, resellable: true, pickup_window: "17:30-18:30",
      explanation_text: "這是當日／隔日取餐的早鳥價（95折），取餐時段為 17:30–18:30。鎖定後如果沒辦法來，可以在期限內轉賣或贈送。",
    },
    {
      vendor_id: cafe.id, item_name: cafe.itemName, discount_percent: 20, resellable: true, pickup_window: cafe.pickupWindow,
      explanation_text: "提前 2–13 天預訂可以拿到 8折，比當日鎖定的折扣更高，因為店家能更早掌握備料量。一樣可以轉賣或贈送。",
    },
    {
      vendor_id: cafe.id, item_name: cafe.itemName, discount_percent: 30, resellable: true, pickup_window: cafe.pickupWindow,
      explanation_text: "提前 14–30 天預訂是折扣最高的區間（7折），適合排定得到的固定行程。取餐前一樣可以轉賣或贈送給別人。",
    },
    {
      vendor_id: wangmama.id, item_name: wangmama.itemName, discount_percent: 5, resellable: true, pickup_window: wangmama.pickupWindow,
      explanation_text: "這是當日／隔日取餐的早鳥價（95折）。鎖定後沒辦法來取餐的話，可以在取餐前轉賣或贈送。",
    },
    {
      vendor_id: ajia.id, item_name: ajia.itemName, discount_percent: 5, resellable: true, pickup_window: ajia.pickupWindow,
      explanation_text: "這是當日／隔日取餐的早鳥價（95折）。鎖定後沒辦法來取餐的話，可以在取餐前轉賣或贈送。",
    },
    {
      vendor_id: zaoan.id, item_name: zaoan.itemName, discount_percent: 5, resellable: true, pickup_window: zaoan.pickupWindow,
      explanation_text: "這是當日／隔日取餐的早鳥價（95折）。鎖定後沒辦法來取餐的話，可以在取餐前轉賣或贈送。",
    },
  ];
}

async function seedDiscountExplanations() {
  const writer = new BatchWriter();
  const disclaimer = "此為鎖定規則說明，非購買建議";
  for (const combo of buildExplanationCombos()) {
    const key = cacheKeyFor(combo);
    await writer.set(db.collection("discount_explanations").doc(key), {
      explanation_text: combo.explanation_text,
      disclaimer,
      generated_at: FieldValue.serverTimestamp(),
    });
  }
  await writer.flush();
  console.log("Seeded discount_explanations cache");
}

/* ------------------------------------------------------------------ *
 * Vendors
 * ------------------------------------------------------------------ */

async function seedVendors(finalAccuracyByVendor) {
  const writer = new BatchWriter();
  for (const v of VENDORS) {
    const finalAccuracy = finalAccuracyByVendor[v.id];
    const reliabilityTone = finalAccuracy == null ? "new" : finalAccuracy >= 0.8 ? "stable" : "variable";
    await writer.set(db.collection("vendors").doc(v.id), {
      name: v.name,
      item_focus: v.itemName,
      reliability_tone: reliabilityTone,
      verified: v.verified,
      description: v.description,
      address: v.address,
      phone: v.phone,
      // owner_uid intentionally left unset — bind it manually to a real
      // Firebase Auth uid per TODO.md's "商家帳號綁定" before the demo.
      owner_uid: null,
      created_at: Timestamp.fromDate(daysAgo(v.historyDays > 0 ? v.historyDays + 5 : 2)),
    });
  }
  await writer.flush();
  console.log(`Seeded ${VENDORS.length} vendors`);
}

/* ------------------------------------------------------------------ *
 * Historical locks + daily payout settlement (mirrors settleVendorPayout
 * in functions/src/index.js, run once per historical day instead of
 * live on a schedule).
 * ------------------------------------------------------------------ */

async function seedVendorHistory(v, writer) {
  if (v.historyDays === 0) return { revenue: 0, lockCount: 0, payoutCount: 0, finalAccuracy: null };

  const lockedPrice = Math.round(v.originalPrice * 0.95); // same-day pickup = 95折 early-bird tier
  let revenue = 0;
  let lockCount = 0;
  let payoutCount = 0;
  let finalAccuracy = v.accuracyEnd;

  for (let day = v.historyDays; day >= 1; day--) {
    const date = daysAgo(day);
    if (date.getDay() === 0 || date.getDay() === 6) continue; // 第一階段週一至週五營業（規格 §2）
    const dateStr = isoDate(date);
    const progress = v.historyDays === 1 ? 1 : (v.historyDays - day) / (v.historyDays - 1);
    let dayAccuracy = v.accuracyStart + progress * (v.accuracyEnd - v.accuracyStart);
    const isRainy = day % v.rainyEveryNDays === 0;
    if (isRainy) dayAccuracy = Math.max(0.2, dayAccuracy - v.rainPenalty);
    if (day === 1) finalAccuracy = dayAccuracy;

    const fulfilledCount = Math.round(v.locksPerDay * dayAccuracy);
    const resoldCount = Math.round(fulfilledCount * 0.15);
    const plainFulfilledCount = fulfilledCount - resoldCount;

    const dayLocks = []; // { ref, status, locked_price }
    for (let i = 0; i < v.locksPerDay; i++) {
      const status = i < plainFulfilledCount ? "fulfilled" : i < fulfilledCount ? "resold_and_fulfilled" : "no_show";
      const willSucceed = status !== "no_show";
      const ref = db.collection("locks").doc();
      await writer.set(ref, {
        vendor_id: v.id,
        menu_item_id: `${v.id}-item-1`, // 材料成本、備料都靠它對到配方
        item_name: v.itemName,
        pickup_window: v.pickupWindow,
        pickup_date: dateStr,
        discount_percent: 5,
        resellable: true,
        locked_price: lockedPrice,
        status,
        no_show_note: willSucceed ? null : isRainy ? pick(RAINY_NO_SHOW_NOTES, i) : pick(GENERAL_NO_SHOW_NOTES, i),
        consumer_feedback: willSucceed && i % 4 === 0 ? pick(FEEDBACK_TEXTS, i) : null,
        buyer_uid: `${v.buyerPrefix}-${day}-${i}`,
        created_at: Timestamp.fromDate(date),
      });
      dayLocks.push({ ref, status, locked_price: lockedPrice });
      lockCount++;
    }

    if (day > v.unsettledRecentDays) {
      const settleable = dayLocks.filter((l) => l.status === "fulfilled" || l.status === "resold_and_fulfilled");
      if (settleable.length > 0) {
        const amount = settleable.reduce((sum, l) => sum + l.locked_price, 0);
        const payoutRef = db.collection("payouts").doc();
        await writer.set(payoutRef, {
          vendor_id: v.id,
          amount,
          lock_ids: settleable.map((l) => l.ref.id),
          lock_count: settleable.length,
          status: "pending_manual_export",
          created_at: Timestamp.fromDate(daysAgo(day, 20)), // settled that evening, 20:00 matches settleVendorPayouts schedule
        });
        for (const l of settleable) {
          await writer.update(l.ref, { payout_settled: true, payout_id: payoutRef.id });
        }
        revenue += amount;
        payoutCount++;
      }
    }
  }

  return { revenue, lockCount, payoutCount, finalAccuracy, lockedPrice };
}

/** Tops up a vendor's settled revenue to targetMinRevenue if the simulated history fell short. */
async function topUpRevenue(v, currentRevenue, lockedPrice, writer) {
  if (!v.targetMinRevenue || currentRevenue >= v.targetMinRevenue) return { added: 0, lockCount: 0 };

  const needed = Math.ceil((v.targetMinRevenue - currentRevenue) / lockedPrice);
  // oldest history bucket; weekends have no history (Mon–Fri only), so step back to Friday
  const oldest = daysAgo(v.historyDays).getDay();
  const date = daysAgo(v.historyDays + (oldest === 6 ? 1 : oldest === 0 ? 2 : 0));
  const dateStr = isoDate(date);
  const refs = [];
  for (let i = 0; i < needed; i++) {
    const ref = db.collection("locks").doc();
    await writer.set(ref, {
      vendor_id: v.id,
      menu_item_id: `${v.id}-item-1`, // 材料成本、備料都靠它對到配方
      item_name: v.itemName,
      pickup_window: v.pickupWindow,
      pickup_date: dateStr,
      discount_percent: 5,
      resellable: true,
      locked_price: lockedPrice,
      status: "fulfilled",
      no_show_note: null,
      consumer_feedback: null,
      buyer_uid: `${v.buyerPrefix}-topup-${i}`,
      created_at: Timestamp.fromDate(date),
    });
    refs.push(ref);
  }
  const amount = needed * lockedPrice;
  const payoutRef = db.collection("payouts").doc();
  await writer.set(payoutRef, {
    vendor_id: v.id,
    amount,
    lock_ids: refs.map((r) => r.id),
    lock_count: refs.length,
    status: "pending_manual_export",
    created_at: Timestamp.fromDate(daysAgo(v.historyDays, 20)),
  });
  for (const ref of refs) {
    await writer.update(ref, { payout_settled: true, payout_id: payoutRef.id });
  }
  return { added: amount, lockCount: needed };
}

/* ------------------------------------------------------------------ *
 * accuracy_reports — hand-written stand-ins for Gemini output (see file
 * header). Each vendor with history gets an early low-confidence report
 * and a latest report matching its actual simulated accuracy, so the
 * "履約穩定度" badge and VendorDashboard's report card agree with the
 * lock data underneath them.
 * ------------------------------------------------------------------ */

async function seedAccuracyReports(v, finalAccuracy, writer) {
  if (v.historyDays === 0 || finalAccuracy == null) return 0;
  const disclaimer = "此為預測準確率參考資訊，非備貨建議";
  const errorRangeFor = (rate) => `±${Math.max(1, Math.round(v.locksPerDay * (1 - rate) * 0.6))} 份`;

  const reports = [
    {
      generated_at: daysAgo(v.historyDays - Math.min(3, v.historyDays - 1), 23.5),
      accuracy_rate: Math.max(0.3, v.accuracyStart - 0.05),
      error_range: errorRangeFor(Math.max(0.3, v.accuracyStart - 0.05)),
      explanation: "目前累積的鎖定/履約輪數還不多，預測準確率仍在觀察初期波動。",
      pattern_note: "目前資料量不足以判斷模式。",
    },
    {
      generated_at: daysAgo(v.unsettledRecentDays, 23.5),
      accuracy_rate: finalAccuracy,
      error_range: errorRangeFor(finalAccuracy),
      explanation:
        finalAccuracy >= 0.8
          ? `近 ${v.historyDays} 天的實際取餐量與預估量差距落在可接受範圍內，準確率穩定在九成上下。`
          : `近 ${v.historyDays} 天的預測準確率約 ${Math.round(finalAccuracy * 100)}%，仍有波動，尚未進入穩定區間。`,
      pattern_note: "雨天的鎖定量與實際取餐量落差明顯較大，其餘時段落差不大（僅供參考，非備貨建議）。",
    },
  ];

  for (const r of reports) {
    const ref = db.collection("accuracy_reports").doc();
    await writer.set(ref, {
      vendor_id: v.id,
      horizon: "daily",
      accuracy_rate: r.accuracy_rate,
      error_range: r.error_range,
      explanation: r.explanation,
      pattern_note: r.pattern_note,
      disclaimer,
      generated_at: Timestamp.fromDate(r.generated_at),
    });
  }
  return reports.length;
}

/* ------------------------------------------------------------------ *
 * Current / upcoming locks — created_at is real serverTimestamp() (not
 * backdated) so they sort to the top of the vendor_id+created_at index
 * every hardcoded frontend query already uses (Marketplace's limit(200),
 * VendorPortalPrep's onSnapshot, etc).
 * ------------------------------------------------------------------ */

async function seedCurrentLocks(writer) {
  const now = new Date();
  const cafe = VENDORS[0];
  const wangmama = VENDORS[1];
  const ajia = VENDORS[2];
  const zaoan = VENDORS[3];

  async function addLock(v, { daysAhead: requested, window, status, resaleDeadlineHoursFromNow, buyerSuffix }) {
    // 週一至週五營業（規格 §2）：落在週六、週日的往後挪到週一（今天本身是週末就照舊，demo 才有今天的單）
    const day = daysFromNow(requested).getDay();
    const daysAhead = requested === 0 ? 0 : day === 6 ? requested + 2 : day === 0 ? requested + 1 : requested;
    const pickupDate = isoDate(daysFromNow(daysAhead));
    const { discountPercent, lockedPrice } = priceForDaysAhead(v.originalPrice, daysAhead);
    const data = {
      vendor_id: v.id,
      menu_item_id: `${v.id}-item-1`, // 材料成本、備料都靠它對到配方
      item_name: v.itemName,
      pickup_window: window,
      pickup_date: pickupDate,
      discount_percent: discountPercent,
      resellable: true,
      locked_price: lockedPrice,
      status,
      no_show_note: null,
      consumer_feedback: null,
      buyer_uid: `${v.buyerPrefix}-cur-${buyerSuffix}`,
      created_at: FieldValue.serverTimestamp(),
    };
    if (resaleDeadlineHoursFromNow !== undefined) {
      data.resale_deadline = Timestamp.fromDate(new Date(now.getTime() + resaleDeadlineHoursFromNow * 3600 * 1000));
    }
    await writer.set(db.collection("locks").doc(), data);
  }

  // cafe-renheya-demo — the hero vendor every hardcoded frontend page reads
  await addLock(cafe, { daysAhead: 0, window: cafe.pickupWindow, status: "locked", buyerSuffix: 1 });
  await addLock(cafe, { daysAhead: 0, window: cafe.pickupWindow, status: "locked", buyerSuffix: 2 });
  await addLock(cafe, { daysAhead: 1, window: cafe.pickupWindow, status: "locked", buyerSuffix: 3 });
  await addLock(cafe, { daysAhead: 0, window: "17:30-18:30", status: "locked", buyerSuffix: 4 });
  await addLock(cafe, { daysAhead: 1, window: "17:30-18:30", status: "locked", buyerSuffix: 5 });
  await addLock(cafe, { daysAhead: 6, window: cafe.pickupWindow, status: "locked", buyerSuffix: 6 }); // 8折 tier
  await addLock(cafe, { daysAhead: 9, window: cafe.pickupWindow, status: "locked", buyerSuffix: 7 }); // 8折 tier
  await addLock(cafe, { daysAhead: 21, window: cafe.pickupWindow, status: "locked", buyerSuffix: 8 }); // 7折 tier
  await addLock(cafe, { daysAhead: 0, window: cafe.pickupWindow, status: "for_resale", resaleDeadlineHoursFromNow: 3, buyerSuffix: 9 });
  await addLock(cafe, { daysAhead: 1, window: cafe.pickupWindow, status: "for_resale", resaleDeadlineHoursFromNow: 5, buyerSuffix: 10 });
  await addLock(cafe, { daysAhead: 0, window: "17:30-18:30", status: "for_resale", resaleDeadlineHoursFromNow: 2, buyerSuffix: 11 });
  await addLock(cafe, { daysAhead: 1, window: cafe.pickupWindow, status: "for_resale", resaleDeadlineHoursFromNow: 8, buyerSuffix: 12 });
  await addLock(cafe, { daysAhead: 1, window: cafe.pickupWindow, status: "for_resale", resaleDeadlineHoursFromNow: -1, buyerSuffix: 13 }); // expired, free-claimable
  await addLock(cafe, { daysAhead: 1, window: cafe.pickupWindow, status: "for_resale", resaleDeadlineHoursFromNow: -3, buyerSuffix: 14 }); // expired, free-claimable
  await addLock(cafe, { daysAhead: 0, window: cafe.pickupWindow, status: "for_gift", buyerSuffix: 15 });
  await addLock(cafe, { daysAhead: 1, window: cafe.pickupWindow, status: "for_gift", buyerSuffix: 16 });

  // wang-mama-biandang
  await addLock(wangmama, { daysAhead: 0, window: wangmama.pickupWindow, status: "locked", buyerSuffix: 1 });
  await addLock(wangmama, { daysAhead: 0, window: wangmama.pickupWindow, status: "locked", buyerSuffix: 2 });
  await addLock(wangmama, { daysAhead: 1, window: wangmama.pickupWindow, status: "locked", buyerSuffix: 3 });
  await addLock(wangmama, { daysAhead: 1, window: wangmama.pickupWindow, status: "for_resale", resaleDeadlineHoursFromNow: 4, buyerSuffix: 4 });

  // ajia-friedchicken
  await addLock(ajia, { daysAhead: 0, window: ajia.pickupWindow, status: "locked", buyerSuffix: 1 });
  await addLock(ajia, { daysAhead: 1, window: ajia.pickupWindow, status: "locked", buyerSuffix: 2 });
  await addLock(ajia, { daysAhead: 0, window: ajia.pickupWindow, status: "for_resale", resaleDeadlineHoursFromNow: 3, buyerSuffix: 3 });

  // zaoan-sandwich — brand new vendor, just a few pending orders, no track record
  await addLock(zaoan, { daysAhead: 0, window: zaoan.pickupWindow, status: "locked", buyerSuffix: 1 });
  await addLock(zaoan, { daysAhead: 0, window: zaoan.pickupWindow, status: "locked", buyerSuffix: 2 });
  await addLock(zaoan, { daysAhead: 1, window: zaoan.pickupWindow, status: "locked", buyerSuffix: 3 });

  console.log("Seeded 26 current/upcoming locks across 4 vendors");
}

/* ------------------------------------------------------------------ *
 * growth_rewards / draws — only for cafe-renheya-demo, the vendor whose
 * settled revenue is engineered to clear the 20萬 tier1 threshold.
 * ------------------------------------------------------------------ */

async function seedGrowthRewards(cafe, writer) {
  await writer.set(db.collection("growth_rewards").doc(cafe.id), {
    voucher_total: 10,
    voucher_remaining: 9, // one 0-元 draw already seeded below
    // mirrors functions/src/index.js syncGrowthUnlock — the seeded payouts
    // are engineered to clear tier1 (20萬) but not tier2 (100萬)
    unlocked_milestones: ["tier1"],
  });

  const draws = [80, 60, 50, 0, 30, 80];
  for (let i = 0; i < draws.length; i++) {
    await writer.set(db.collection("draws").doc(), {
      vendor_id: cafe.id,
      buyer_tag: `draw${i}`.slice(-6),
      item_name: cafe.itemName,
      price_percent: draws[i],
      created_at: Timestamp.fromDate(daysAgo(draws.length - i)),
    });
  }
  console.log(`Seeded growth_rewards + ${draws.length} draws for ${cafe.id}`);
}

/* ------------------------------------------------------------------ *
 * Catalog data — menu_items / meal_plans / vendor profile fields /
 * ban_appeals. All use deterministic doc ids (not db.collection().doc()
 * auto-ids) specifically so re-running this section is a safe upsert,
 * not a duplicate — unlike the historical locks/payouts above, which are
 * guarded by guardNotAlreadySeeded() instead because they don't have a
 * natural stable id to upsert against.
 * ------------------------------------------------------------------ */

// Patches display fields onto already-existing vendor docs via update()
// (merge), not set() (full overwrite) — deliberately doesn't touch
// reliability_tone/verified/owner_uid/created_at, which seedVendors()
// above already owns.
async function patchVendorProfiles(writer) {
  for (const v of VENDORS) {
    await writer.update(db.collection("vendors").doc(v.id), {
      description: v.description,
      address: v.address,
      phone: v.phone,
    });
  }
  console.log(`Patched description/address/phone for ${VENDORS.length} vendors`);
}

// One real menu_items doc per vendor, reusing the exact item name/price
// already baked into that vendor's lock/payout history — no new numbers.
async function seedMenuItems(writer) {
  for (const v of VENDORS) {
    await writer.set(db.collection("menu_items").doc(`${v.id}-item-1`), {
      vendor_id: v.id,
      name: v.itemName,
      description: v.description,
      price: v.originalPrice,
      category: v.itemCategory,
      is_available: true,
      image: null,
      allergens: [],
      dietary_tags: [],
      created_at: Timestamp.fromDate(daysAgo(v.historyDays > 0 ? v.historyDays + 5 : 2)),
    });
  }
  console.log(`Seeded ${VENDORS.length} menu_items`);
}

// Two plans per vendor (A/B, 5天/7天), price_per_meal is a discount off
// the vendor's existing single-item price — not an invented number.
const MEAL_PLAN_DEFS = [
  { key: "a", label: "A方案", days: 5, priceFactor: 0.9, name: "五日輕食計畫" },
  { key: "b", label: "B方案", days: 7, priceFactor: 0.95, name: "七日安心餐" },
];

async function seedMealPlans(writer) {
  for (const v of VENDORS) {
    for (const def of MEAL_PLAN_DEFS) {
      await writer.set(db.collection("meal_plans").doc(`${v.id}-plan-${def.key}`), {
        vendor_id: v.id,
        label: def.label,
        name: `${def.name}（${def.days}天）`,
        description: `每日供餐${v.itemName}，連續 ${def.days} 天`,
        price_per_meal: Math.round(v.originalPrice * def.priceFactor),
        fastest_booking: "明天起",
        days: def.days,
        created_at: Timestamp.fromDate(daysAgo(v.historyDays > 0 ? v.historyDays + 5 : 2)),
      });
    }
  }
  console.log(`Seeded ${VENDORS.length * MEAL_PLAN_DEFS.length} meal_plans`);
}

// 平台層級設定，前端商家後台與 Functions（drawGrowthReward／syncGrowthUnlock）讀同一份。
// 用 set 覆寫，重跑 seed 會把管理員在 Console 改過的值蓋回預設。
async function seedPlatformConfig(writer) {
  await writer.set(db.collection("platform_config").doc("growth"), {
    milestones: [
      { id: "tier1", label: "20 萬門檻・單抽", label_en: "NT$200k · single draw", threshold: 200000 },
      { id: "tier2", label: "100 萬門檻・十連抽", label_en: "NT$1M · ten draws", threshold: 1000000 },
    ],
    voucher_total: 10,
  });
  console.log("Seeded platform_config/growth");

  // Landing 頁「近期活動」（*_en 是英文版文案，選填）。icon 是前端 EVENT_ICONS 的 key（sparkle／calendar／
  // repeat／store／ticket／bell）；active: false 可以先下架不刪除。
  const events = [
    { id: "growth-draw", date_label: "每月 1 日", title: "成長獎勵抽獎", body: "合作店家營收達標就解鎖，最高抽中整份 0 元。", icon: "sparkle", href: "/home",
      date_label_en: "1st of every month", title_en: "Growth reward draw", body_en: "Unlocked when a partner vendor hits its revenue goal — win up to a free meal." },
    { id: "exam-early-bird", date_label: "期中考週", title: "考前便當早鳥加碼", body: "考試週提前預約，讀書不用再排隊買午餐。", icon: "calendar", href: "/home",
      date_label_en: "Midterm week", title_en: "Exam-week early-bird boost", body_en: "Book ahead during exams and skip the lunch queue." },
    { id: "transfer-market", date_label: "隨時進行", title: "同學轉讓市集", body: "臨時有事？把餐點轉給需要的人，不浪費一份。", icon: "repeat", href: "/marketplace",
      date_label_en: "Ongoing", title_en: "Classmate transfer market", body_en: "Something came up? Pass your meal to someone who needs it — nothing wasted." },
    { id: "vendor-recruit", date_label: "新店家進駐", title: "合作店家招募中", body: "餐廳、咖啡廳都能加入，提前掌握備餐數量。", icon: "store", href: "/vendors",
      date_label_en: "New vendors", title_en: "Now recruiting partner vendors", body_en: "Restaurants and cafés welcome — know how much to prep in advance." },
  ];
  for (const [i, { id, ...event }] of events.entries()) {
    await writer.set(db.collection("landing_events").doc(id), { ...event, sort_order: i + 1, active: true });
  }
  console.log(`Seeded ${events.length} landing_events`);
}

// Admin-only collection (see firestore.rules) — no consumer submission
// flow exists (TODO.md), so this is the only way any content ever lands
// here. buyer_uid values reuse real seeded historical buyer_uids so the
// appeal at least plausibly ties back to an actual no-show in the demo data.
async function seedBanAppeals(writer) {
  const appeals = [
    {
      id: "appeal-1",
      buyer_uid: "demo-user-cafe-14-3",
      username: "student42",
      display_name: "陳同學",
      reason: "當天臨時生病無法取餐，已提前私訊店家告知",
      status: "pending",
      admin_note: null,
      createdAt: daysAgo(3),
    },
    {
      id: "appeal-2",
      buyer_uid: "demo-user-wangmama-10-2",
      username: "student88",
      display_name: "林同學",
      reason: "忘記設定取餐提醒，下次會注意",
      status: "approved",
      admin_note: "首次違規，同意解封",
      createdAt: daysAgo(6),
    },
  ];
  for (const a of appeals) {
    await writer.set(db.collection("ban_appeals").doc(a.id), {
      buyer_uid: a.buyer_uid,
      username: a.username,
      display_name: a.display_name,
      reason: a.reason,
      status: a.status,
      admin_note: a.admin_note,
      created_at: Timestamp.fromDate(a.createdAt),
    });
  }
  console.log(`Seeded ${appeals.length} ban_appeals`);
}

/* ------------------------------------------------------------------ *
 * Safety guard — refuse to double-seed production by accident.
 * ------------------------------------------------------------------ */

async function guardNotAlreadySeeded() {
  if (FORCE) return;
  for (const v of VENDORS) {
    const existing = await db.collection("locks").where("vendor_id", "==", v.id).limit(1).get();
    if (!existing.empty) {
      console.error(
        `locks already exist for vendor ${v.id} — refusing to reseed and duplicate data. Pass --force to override.`
      );
      process.exit(1);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Emulator-only demo accounts — the platform login (web/src/lib/auth.ts)
 * is real Firebase Auth now, and the vendor role comes from
 * vendors/{id}.owner_uid, so local dev needs real accounts to log in with.
 * Never runs against production (no FIREBASE_AUTH_EMULATOR_HOST there).
 * Idempotent: reuses an existing account, re-binds owner_uid every run
 * (seedVendors() resets it to null).
 * ------------------------------------------------------------------ */

const DEMO_PASSWORD = "demo1234";
const DEMO_ACCOUNTS = [
  { email: "vendor@bunnbaa.test", displayName: "仁和雅咖啡（demo）", ownsVendor: "cafe-renheya-demo" },
  { email: "customer@bunnbaa.test", displayName: "demo 消費者" },
  // web/src/lib/adminAuth.ts ADMIN_EMAILS — only created inside the emulator
  { email: "suw192336@gmail.com", displayName: "平台管理員（emulator）" },
  // A pending vendor_applications/{uid} so /admin/vendors has something to approve
  { email: "applicant@bunnbaa.test", displayName: "早安三明治（申請中）", appliesAs: "早安三明治" },
];

// Vendor subscriptions (web/src/lib/subscription.ts) — one vendor per state so
// the vendor portal + /admin/vendors show each of them. Only fills vendors
// that don't have a subscription yet, so re-running never undoes a renewal.
// zaoan-sandwich is left unset on purpose: approving applicant@ binds it and
// starts its free trial (AdminVendorsPage).
const SUBSCRIPTIONS = {
  "cafe-renheya-demo": { status: "active", endInDays: 20 },
  "wang-mama-biandang": { status: "trial", endInDays: 5 },
  "ajia-friedchicken": { status: "cancelled", endInDays: 3, cancelledFrom: "active" },
};

async function seedSubscriptions() {
  for (const [vendorId, sub] of Object.entries(SUBSCRIPTIONS)) {
    const ref = db.collection("vendors").doc(vendorId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().subscription_status) continue;
    await ref.update({
      subscription_status: sub.status,
      subscription_end_date: Timestamp.fromDate(daysFromNow(sub.endInDays)),
      ...(sub.cancelledFrom
        ? { cancelled_from: sub.cancelledFrom, cancel_requested_at: Timestamp.fromDate(daysAgo(2)) }
        : {}),
    });
  }
  console.log("Seeded vendor subscriptions (only where missing)");
}

async function seedDemoAccounts() {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) return;
  for (const acct of DEMO_ACCOUNTS) {
    let user;
    try {
      user = await admin.auth().getUserByEmail(acct.email);
    } catch (err) {
      if (err.code !== "auth/user-not-found") throw err;
      user = await admin.auth().createUser({ email: acct.email, password: DEMO_PASSWORD, displayName: acct.displayName });
    }
    if (acct.ownsVendor) {
      await db.collection("vendors").doc(acct.ownsVendor).set({ owner_uid: user.uid }, { merge: true });
    }
    if (acct.appliesAs) {
      const appRef = db.collection("vendor_applications").doc(user.uid);
      if (!(await appRef.get()).exists) {
        await appRef.set({
          store_name: acct.appliesAs,
          phone: "05-2710000",
          email: acct.email,
          status: "pending",
          created_at: FieldValue.serverTimestamp(),
        });
      }
    }
  }
  console.log(`Emulator demo accounts ready (password ${DEMO_PASSWORD}): ${DEMO_ACCOUNTS.map((a) => a.email).join(", ")}`);
}

/* ------------------------------------------------------------------ */

async function main() {
  if (CONFIG_ONLY) {
    const writer = new BatchWriter();
    await seedPlatformConfig(writer);
    await writer.flush();
    console.log("\nConfig-only seed complete.");
    process.exit(0);
    return;
  }

  if (CATALOG_ONLY) {
    const writer = new BatchWriter();
    await patchVendorProfiles(writer);
    await seedMenuItems(writer);
    await seedMealPlans(writer);
    await seedBanAppeals(writer);
    await seedPlatformConfig(writer);
    await writer.flush();
    await seedSubscriptions();
    await seedDemoAccounts();
    console.log("\nCatalog-only seed complete.");
    process.exit(0);
    return;
  }

  await guardNotAlreadySeeded();

  await seedDiscountExplanations(); // must land before any lock write

  const writer = new BatchWriter();
  const finalAccuracyByVendor = {};
  let totalLocks = 0;
  let totalPayouts = 0;

  for (const v of VENDORS) {
    const result = await seedVendorHistory(v, writer);
    finalAccuracyByVendor[v.id] = result.finalAccuracy;
    totalLocks += result.lockCount;
    totalPayouts += result.payoutCount;

    if (v.targetMinRevenue) {
      const topUp = await topUpRevenue(v, result.revenue, result.lockedPrice, writer);
      if (topUp.added > 0) {
        totalLocks += topUp.lockCount;
        totalPayouts += 1;
        console.log(`Topped up ${v.id} by $${topUp.added} (${topUp.lockCount} extra fulfilled locks) to clear the growth-reward threshold`);
      }
    }

    const reportCount = await seedAccuracyReports(v, result.finalAccuracy, writer);
    if (reportCount) console.log(`Seeded ${reportCount} accuracy_reports for ${v.id} (final accuracy ${result.finalAccuracy?.toFixed(2)})`);
  }

  await seedVendors(finalAccuracyByVendor);
  await patchVendorProfiles(writer);
  await seedMenuItems(writer);
  await seedMealPlans(writer);
  await seedBanAppeals(writer);
  await seedCurrentLocks(writer);
  await seedGrowthRewards(VENDORS[0], writer);
  await seedPlatformConfig(writer);

  await writer.flush();
  await seedSubscriptions();
  await seedDemoAccounts();

  console.log(`\nSeed complete: ${totalLocks} historical locks, ${totalPayouts} payouts, 4 vendors, ${writer.totalCommitted + 26} total writes (approx).`);
  console.log("discount_explanation fields on each lock are filled in asynchronously by the deployed onLockCreated trigger — give it a minute.");
  console.log("Still needed before recording: bind vendors/{id}.owner_uid to real Firebase Auth uids (TODO.md 商家帳號綁定); Gemini key for any *new* lock created live during the demo.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
