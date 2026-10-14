// No-shows and charity meals. Charity meals appear in the "Charity meals" (愛心餐) tab of the "My meals" page.
//
// charityMeals/{id} (publicly readable, no personal data at all):
//   vendor_id, vendor_name, vendor_address (+ *_en English copies), lat, lng, date, source: noshow|donated, status: available|reserved|claimed|given|wasted,
//   pickup_code (label number on the bento box, so the vendor can find it), item_name, sides[], deadline (Timestamp)
// charityReservations/{id} (readable by the owner, stored separately from locks, kept for 30 days):
//   user_id, meal_id, vendor_id, date, status: reserved|claimed|expired, expires_at, qr_nonce
// (the old charityBans scheme is gone: expired reservations are released to the next person, no ban)
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { Timestamp } = require("firebase-admin/firestore");
const {
  REGION, db, onCall, HttpsError, FieldValue, t, isEmulator, assertSignedInUser, callerVendorId, notifyUser, notifyVendor,
  forEachVendor, distanceMeters, decodeGeohash,
} = require("./common");
const { loadPlatformConfig } = require("./config");
const { taipeiToday, addDays } = require("./calendar");
const { ACTIVE_LOCK_STATUSES } = require("./prep");
const { helpers } = require("./orders");

function mealFromLock(lockId, lock, vendor, source, deadline) {
  return {
    vendor_id: lock.vendor_id,
    vendor_name: vendor.name || "",
    vendor_address: vendor.address || "",
    // English copies for the English UI (translate.js); empty when the vendor or order wasn't translated yet
    vendor_name_en: vendor.name_en || "",
    vendor_address_en: vendor.address_en || "",
    lat: Number.isFinite(vendor.lat) ? vendor.lat : null,
    lng: Number.isFinite(vendor.lng) ? vendor.lng : null,
    date: lock.pickup_date,
    source,
    status: "available",
    lock_id: lockId, // for backend reconciliation only; not shown on public pages
    pickup_code: lock.pickup_code || null,
    item_name: lock.item_name,
    item_name_en: lock.item_name_en || "",
    sides: [
      ...(lock.slots || []).filter((s) => !s.removed).map((s) => s.resolved || s.default_dish),
      lock.extra_side?.mode === "addon" ? lock.extra_side.resolved || lock.extra_side.dish : null,
    ].filter(Boolean),
    deadline: Timestamp.fromDate(deadline),
    created_at: FieldValue.serverTimestamp(),
  };
}

/**
 * "Charity meals nearby" push: off by default; sent only to users who turned it on, within 1 km of their usual location (coarse geohash),
 * during the charity meal window, at most 2 per person per day.
 */
async function notifyNearby(vendor, count) {
  if (!Number.isFinite(vendor.lat) || !Number.isFinite(vendor.lng) || count <= 0) return;
  const today = taipeiToday();
  const snap = await db().collection("users").where("charity_nearby_push", "==", true).get();
  for (const doc of snap.docs) {
    const u = doc.data();
    const home = decodeGeohash(u.home_geo);
    if (!home || distanceMeters(home, vendor) > 1000) continue;
    if ((u.muted_kinds || []).includes("charity")) continue;
    const log = u.charity_push_log || {};
    const sent = log.date === today ? log.count || 0 : 0;
    if (sent >= 2) continue;
    await doc.ref.set({ charity_push_log: { date: today, count: sent + 1 } }, { merge: true });
    await notifyUser(doc.id, () => ({
      kind: "charity_nearby",
      title: t("附近有愛心餐", "Charity meals nearby"),
      body: t(`「${vendor.name}」有 ${count} 份愛心餐開放領取`, `${vendor.name_en || vendor.name} has ${count} charity meal(s) open`),
      link: "/my-bookings?tab=charity",
    }));
  }
}

/** Charity meal deadline = 2 hours after that meal period's pickup slot ends (breakfast, lunch and dinner computed separately) */
function charityDeadline(vendor, date, config, window = null) {
  const { end } = helpers.todayRange(vendor, date, window, config);
  return new Date(end.getTime() + config.charityCloseAfterMinutes * 60000);
}

function periodDeadline(end, config) {
  return new Date(end.getTime() + config.charityCloseAfterMinutes * 60000);
}

/** Diner donates on the pickup day (before the pickup slot ends): opens for claiming immediately and counts toward their charity record */
exports.donateLock = onCall({}, async (request) => {
  assertSignedInUser(request, "捐出愛心餐", "donate a charity meal");
  const lockId = request.data?.lock_id;
  const ref = db().collection("locks").doc(String(lockId || "_"));
  const snap = await ref.get();
  if (!snap.exists || snap.data().buyer_uid !== request.auth.uid) throw new HttpsError("permission-denied", t("這不是你的訂單", "This isn't your order"));
  const lock = snap.data();
  const vendorSnap = await db().collection("vendors").doc(lock.vendor_id).get();
  const vendor = { id: vendorSnap.id, ...vendorSnap.data() };
  const config = await loadPlatformConfig(db());
  const today = taipeiToday();
  if (lock.pickup_date !== today) throw new HttpsError("failed-precondition", t(`取餐當天才能捐為愛心餐；取餐 ${config.cancelHoursBefore} 小時前可以取消換折價券`, `You can donate on the pickup day; up to ${config.cancelHoursBefore} hours before pickup you can cancel for a coupon instead`));
  const { end } = helpers.todayRange(vendor, today, lock.pickup_window, config);
  if (Date.now() > end.getTime()) throw new HttpsError("failed-precondition", t("取餐時段已結束", "The pickup window has ended"));
  const mealRef = db().collection("charityMeals").doc();
  await db().runTransaction(async (tx) => {
    const fresh = (await tx.get(ref)).data();
    if (!["locked", "for_resale"].includes(fresh.status)) throw new HttpsError("failed-precondition", t("這筆訂單目前不能捐出", "This order can't be donated now"));
    tx.update(ref, { status: "charity", charity_source: "donated", charity_meal_id: mealRef.id, resale_deadline: FieldValue.delete() });
    tx.set(mealRef, mealFromLock(ref.id, fresh, vendor, "donated", charityDeadline(vendor, today, config, fresh.pickup_window)));
    tx.set(db().collection("users").doc(request.auth.uid), { donated_count: FieldValue.increment(1) }, { merge: true });
  });
  await notifyNearby(vendor, 1);
  await notifyUser(request.auth.uid, {
    kind: "charity",
    title: t("謝謝你的愛心", "Thank you for your kindness"),
    body: t("你捐出的便當已開放給需要的人領取。", "Your meal is now open for someone in need to pick up."),
    link: "/my-bookings?tab=charity",
  });
  return { meal_id: mealRef.id };
});

/** 30 minutes after the pickup slot ends, bentos still not picked up become charity meals; no refund, draw tickets issued as usual */
exports.convertToCharity = onSchedule({ schedule: "every 5 minutes", timeZone: "Asia/Taipei", region: REGION }, async () => {
  const config = await loadPlatformConfig(db());
  const today = taipeiToday();
  await forEachVendor("convertToCharity", async (vendor) => {
    for (const { period, label, end } of await helpers.lockPeriodRangesOn(vendor, today, config)) {
      if (Date.now() < end.getTime() + config.charityConvertAfterMinutes * 60000) continue;
      const planRef = db().collection("vendors").doc(vendor.id).collection("prepPlans").doc(today);
      const plan = await planRef.get();
      const flag = `charity_converted_${period}`;
      if (plan.exists && (plan.data()[flag] || (period === "lunch" && plan.data().charity_converted))) continue;
      const deadline = periodDeadline(end, config);
      const converted = [];
      for (const doc of await helpers.activeLocksOn(vendor.id, today, period, config)) {
        const mealRef = db().collection("charityMeals").doc();
        const ok = await db().runTransaction(async (tx) => {
          const fresh = (await tx.get(doc.ref)).data();
          if (!ACTIVE_LOCK_STATUSES.includes(fresh.status)) return false;
          tx.update(doc.ref, { status: "charity", charity_source: "noshow", charity_meal_id: mealRef.id, resale_deadline: FieldValue.delete() });
          tx.set(mealRef, mealFromLock(doc.id, fresh, vendor, "noshow", deadline));
          return true;
        });
        if (ok) converted.push(doc.data().buyer_uid);
      }
      await planRef.set({ [flag]: true, charity_noshow_count: FieldValue.increment(converted.length) }, { merge: true });
      await notifyNearby(vendor, converted.length);
      for (const uid of converted) {
        await notifyUser(uid, () => ({
          kind: "charity",
          title: t("今天的便當沒有領到", "You didn't pick up today's meal"),
          body: t(
            "為了不浪費，店家已將它轉為愛心餐，開放給需要的人。這筆訂單的抽獎券已照常發放。下次來不了的話，可以在取餐前按「捐為愛心餐」，餐點會更新鮮。",
            "To avoid waste, it's now a charity meal for someone in need. Your draw tickets were still issued. Next time, tap \"Donate\" before pickup so the meal is fresher."
          ),
          link: "/my-bookings",
        }));
      }
      if (converted.length > 0) {
        const closeAt = deadline.toLocaleTimeString("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit" });
        await notifyVendor(vendor.id, () => ({
          title: t(`${label} ${converted.length} 份未取餐已轉為愛心餐`, `${converted.length} unclaimed meals are now charity meals`),
          body: t(`開放預約與現場領取，${closeAt} 截止後請輸入現場送出份數。`, `Open for reservations and walk-ins until ${closeAt}.`),
          link: "/vendor-portal/charity",
        }));
      }
    }
  });
});

/** Charity meal deadline (2 hours after the pickup slot ends): close claiming and remind the vendor to enter the number given out */
exports.closeCharity = onSchedule({ schedule: "every 10 minutes", timeZone: "Asia/Taipei", region: REGION }, async () => {
  const config = await loadPlatformConfig(db());
  const today = taipeiToday();
  await forEachVendor("closeCharity", async (vendor) => {
    for (const { period, label, end } of await helpers.lockPeriodRangesOn(vendor, today, config)) {
      const deadline = periodDeadline(end, config);
      if (Date.now() < deadline.getTime()) continue;
      const planRef = db().collection("vendors").doc(vendor.id).collection("prepPlans").doc(today);
      const plan = await planRef.get();
      const flag = `charity_closed_${period}`;
      if (plan.exists && (plan.data()[flag] || (period === "lunch" && plan.data().charity_closed))) continue;
      await planRef.set({ [flag]: true }, { merge: true });
      const meals = await db().collection("charityMeals").where("vendor_id", "==", vendor.id).where("date", "==", today).get();
      const mine = meals.docs.filter((d) => d.data().deadline?.toMillis?.() <= deadline.getTime());
      const open = mine.filter((d) => d.data().status === "available");
      if (mine.length > 0) {
        await notifyVendor(vendor.id, () => ({
          title: t(`${label}愛心餐已截止`, "Charity meals closed"),
          body: t(`還有 ${open.length} 份未被預約，請輸入現場送出份數，其餘記為報廢。`, `${open.length} weren't reserved. Enter how many you gave out on site.`),
          link: "/vendor-portal/charity",
        }));
      }
    }
  });
});

/**
 * Online reservation: phone-verified account, 1 per person per day, arrive within 10 minutes; released on timeout, no ban.
 */
exports.reserveCharity = onCall({}, async (request) => {
  assertSignedInUser(request, "預約愛心餐", "reserve a charity meal");
  const uid = request.auth.uid;
  if (!request.auth.token?.phone_number && !isEmulator()) {
    const user = await db().collection("users").doc(uid).get();
    if (!user.exists || !user.data().phone_verified) {
      throw new HttpsError("failed-precondition", t("預約愛心餐需要手機驗證的帳號，請用手機門號登入", "Charity reservations need a phone-verified account"));
    }
  }
  const config = await loadPlatformConfig(db());
  const today = taipeiToday();
  const mine = await db().collection("charityReservations").where("user_id", "==", uid).where("date", "==", today).get();
  // Expired-and-released reservations don't count (no ban; the user may reserve another)
  if (mine.docs.some((d) => ["reserved", "claimed"].includes(d.data().status))) {
    throw new HttpsError("resource-exhausted", t("每人每天限預約 1 份愛心餐", "One charity meal per person per day"));
  }
  const mealId = request.data?.meal_id;
  const vendorId = request.data?.vendor_id;
  let mealRef;
  if (mealId) {
    mealRef = db().collection("charityMeals").doc(String(mealId));
  } else if (vendorId) {
    const avail = await db().collection("charityMeals").where("vendor_id", "==", vendorId).where("date", "==", today).where("status", "==", "available").limit(1).get();
    if (avail.empty) throw new HttpsError("not-found", t("這家店目前沒有可預約的愛心餐", "No charity meals available here right now"));
    mealRef = avail.docs[0].ref;
  } else {
    throw new HttpsError("invalid-argument", "meal_id or vendor_id is required");
  }
  const resRef = db().collection("charityReservations").doc();
  const expires = await db().runTransaction(async (tx) => {
    const meal = (await tx.get(mealRef)).data();
    if (!meal || meal.status !== "available" || meal.date !== today) throw new HttpsError("failed-precondition", t("這份愛心餐已被預約", "This meal was just reserved"));
    const deadline = meal.deadline.toMillis();
    if (Date.now() >= deadline) throw new HttpsError("failed-precondition", t("愛心餐已截止", "Charity meals have closed"));
    const expiresAt = Math.min(Date.now() + config.charityReserveMinutes * 60000, deadline);
    tx.update(mealRef, { status: "reserved", reservation_id: resRef.id });
    tx.set(resRef, {
      user_id: uid, meal_id: mealRef.id, vendor_id: meal.vendor_id, vendor_name: meal.vendor_name, vendor_name_en: meal.vendor_name_en || "", date: today,
      item_name: meal.item_name, item_name_en: meal.item_name_en || "", status: "reserved", expires_at: Timestamp.fromMillis(expiresAt), created_at: FieldValue.serverTimestamp(),
    });
    return expiresAt;
  });
  return { reservation_id: resRef.id, expires_at: expires };
});

/** No-show after reserving: release the meal to the next person (no ban), and clear reservations older than 30 days */
exports.expireCharityReservation = onSchedule({ schedule: "every 1 minutes", timeZone: "Asia/Taipei", region: REGION }, async () => {
  const config = await loadPlatformConfig(db());
  const expired = await db().collection("charityReservations")
    .where("status", "==", "reserved").where("expires_at", "<=", Timestamp.now()).get();
  for (const doc of expired.docs) {
    const res = doc.data();
    await db().runTransaction(async (tx) => {
      const fresh = (await tx.get(doc.ref)).data();
      if (fresh.status !== "reserved") return;
      const mealRef = db().collection("charityMeals").doc(res.meal_id);
      const meal = (await tx.get(mealRef)).data();
      tx.update(doc.ref, { status: "expired" });
      if (meal?.status === "reserved" && meal.reservation_id === doc.id) {
        tx.update(mealRef, { status: meal.deadline.toMillis() > Date.now() ? "available" : "wasted", reservation_id: FieldValue.delete() });
      }
    });
    await notifyUser(res.user_id, () => ({
      kind: "charity",
      title: t("愛心餐預約已逾時", "Charity reservation expired"),
      body: t(`預約後 ${config.charityReserveMinutes} 分鐘內未到場，餐點已釋出給下一位。還有剩的話可以再預約。`, `You didn't arrive within ${config.charityReserveMinutes} minutes, so the meal went to the next person. You can reserve again if any are left.`),
      link: "/my-bookings?tab=charity",
    }));
  }
  const old = await db().collection("charityReservations").where("date", "<", addDays(taipeiToday(), -30)).limit(300).get();
  const batch = db().batch();
  old.docs.forEach((d) => batch.delete(d.ref));
  if (!old.empty) await batch.commit();
});

/** Vendor hands out one on site (no reservation, first come first served, no account needed) */
exports.giveCharityOnsite = onCall({}, async (request) => {
  const vendorId = await callerVendorId(request, request.data?.vendor_id);
  const ref = db().collection("charityMeals").doc(String(request.data?.meal_id || "_"));
  await db().runTransaction(async (tx) => {
    const meal = (await tx.get(ref)).data();
    if (!meal || meal.vendor_id !== vendorId) throw new HttpsError("not-found", "meal not found");
    if (meal.status !== "available") throw new HttpsError("failed-precondition", t("這份已被預約或領走", "Already reserved or taken"));
    tx.update(ref, { status: "given", given_at: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});

/**
 * After 15:00 the vendor enters the number given out on site; the rest are recorded as waste. Waste goes into prepPlans
 * and is used by next week's forecast (buildWeeklyPurchase subtracts wasted portions).
 */
exports.submitCharityResult = onCall({}, async (request) => {
  const vendorId = await callerVendorId(request, request.data?.vendor_id);
  const date = request.data?.date || taipeiToday();
  const given = Number(request.data?.given);
  if (!Number.isInteger(given) || given < 0) throw new HttpsError("invalid-argument", "given must be a non-negative integer");
  const meals = await db().collection("charityMeals").where("vendor_id", "==", vendorId).where("date", "==", date).get();
  const open = meals.docs.filter((d) => d.data().status === "available" || d.data().status === "given");
  const alreadyGiven = open.filter((d) => d.data().status === "given").length;
  let toGive = Math.max(0, given - alreadyGiven);
  const batch = db().batch();
  let wasted = 0;
  for (const d of open) {
    if (d.data().status === "given") continue;
    if (toGive > 0) {
      batch.update(d.ref, { status: "given" });
      toGive--;
    } else {
      batch.update(d.ref, { status: "wasted" });
      wasted++;
    }
  }
  const claimed = meals.docs.filter((d) => d.data().status === "claimed").length;
  batch.set(db().collection("vendors").doc(vendorId).collection("prepPlans").doc(date), {
    charity_result: { total: meals.size, reserved_claimed: claimed, given_onsite: Math.min(given, open.length), wasted, submitted_at: FieldValue.serverTimestamp() },
  }, { merge: true });
  await batch.commit();
  // All of the day's charity meals were given out: notify the original buyers, only once
  const planRef = db().collection("vendors").doc(vendorId).collection("prepPlans").doc(date);
  const alreadyNotified = (await planRef.get()).data()?.charity_all_given_notified;
  const wastedBefore = meals.docs.filter((d) => d.data().status === "wasted").length;
  if (wasted === 0 && wastedBefore === 0 && meals.size > 0 && !alreadyNotified) {
    await planRef.set({ charity_all_given_notified: true }, { merge: true });
    const lockIds = [...new Set(meals.docs.map((d) => d.data().lock_id).filter(Boolean))];
    const owners = new Set();
    for (const id of lockIds) {
      const lock = (await db().collection("locks").doc(id).get()).data();
      if (lock?.buyer_uid) owners.add(lock.buyer_uid);
    }
    for (const uid of owners) {
      await notifyUser(uid, () => ({
        kind: "charity",
        title: t("今天的愛心餐都送出去了", "All of today's charity meals were given out"),
        body: t("謝謝你，今天沒有浪費任何一份便當。", "Thank you — not a single meal went to waste today."),
        link: "/my-bookings",
      }));
    }
  }
  return { wasted, given: Math.min(given, open.length), claimed };
});
