// doc/測試文件.md chapter 7: negative tests for the Firestore security rules plus related page cases.
// Uses a separate demo-rules-test project so the dev emulator's data (bunnbaa-mvp-5474) is untouched.
// Run:
//   dev emulator already running → cd scripts/tests && npm run test:rules
//   not running → cd scripts/tests && npm run test:rules:exec (starts a Firestore-only emulator)
// Override the emulator address with FIRESTORE_EMULATOR_HOST (default 127.0.0.1:8080).
const fs = require("node:fs");
const path = require("node:path");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const {
  doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp, collection, addDoc,
} = require("firebase/firestore");

const RULES = fs.readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8");
const [HOST, PORT] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
const results = [];

(async () => {
  const env = await initializeTestEnvironment({
    projectId: "demo-rules-test",
    firestore: { rules: RULES, host: HOST, port: Number(PORT) },
  });
  await env.clearFirestore();

  const tok = (email, extra = {}) => ({ email, firebase: { sign_in_provider: "password" }, ...extra });
  const A = env.authenticatedContext("userA", tok("a@test")).firestore();
  const B = env.authenticatedContext("userB", tok("b@test")).firestore();
  const OWNER = env.authenticatedContext("owner1", tok("o1@test")).firestore();
  const OWNER2 = env.authenticatedContext("owner2", tok("o2@test")).firestore();
  const ADMIN = env.authenticatedContext("admin", tok("suw192336@gmail.com")).firestore();
  const ANON = env.unauthenticatedContext().firestore();

  // Seed data
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const future = Timestamp.fromMillis(Date.now() + 10 * 86400000);
    await setDoc(doc(db, "vendors/v1"), { name: "店一", owner_uid: "owner1", subscription_status: "active", subscription_end_date: future, i18n_src: { name: "店一" } });
    await setDoc(doc(db, "vendors/v2"), { name: "店二", owner_uid: "owner2" });
    await setDoc(doc(db, "locks/lA"), { buyer_uid: "userA", vendor_id: "v1", status: "locked", locked_price: 80, item_name: "便當" });
    await setDoc(doc(db, "locks/lAfree"), { buyer_uid: "userA", vendor_id: "v1", status: "fulfilled", locked_price: 80, item_name: "便當" });
    await setDoc(doc(db, "locks/lAresale"), { buyer_uid: "userA", vendor_id: "v1", status: "for_resale", locked_price: 80, item_name: "便當" });
    await setDoc(doc(db, "locks/lAcharity"), { buyer_uid: "userA", vendor_id: "v1", status: "charity", charity_source: "noshow", locked_price: 80, item_name: "便當" });
    await setDoc(doc(db, "locks/lAgift"), { buyer_uid: "userA", vendor_id: "v1", status: "for_gift", locked_price: 80, item_name: "便當" });
    await setDoc(doc(db, "users/userA"), { display_name: "A", lang: "zh" });
    await setDoc(doc(db, "users/userB"), { display_name: "B", lang: "zh" });
    await setDoc(doc(db, "lock_tokens/lB"), { buyer_uid: "userB", fcm_token: "x" });
    await setDoc(doc(db, "payouts/p2"), { vendor_id: "v2", amount: 1 });
    await setDoc(doc(db, "accuracy_reports/r2"), { vendor_id: "v2" });
    await setDoc(doc(db, "admin_audit_logs/log1"), { admin_email: "suw192336@gmail.com" });
    await setDoc(doc(db, "tasteProfiles/userB"), { prefs: {} });
    await setDoc(doc(db, "tasteProfiles/userA"), { prefs: {} });
    await setDoc(doc(db, "areaInsights/v2"), { vendor_id: "v2" });
    await setDoc(doc(db, "coupons/cB"), { user_id: "userB", vendor_id: "v2" });
    await setDoc(doc(db, "rewardTickets/tB"), { user_id: "userB", vendor_id: "v2" });
    await setDoc(doc(db, "charityReservations/crB"), { user_id: "userB", vendor_id: "v1" });
    await setDoc(doc(db, "charityBans/userB"), { until: future });
    await setDoc(doc(db, "vendors/v1/prepPlans/2026-10-01"), { done: {}, total: 10 });
    await setDoc(doc(db, "charityMeals/cm1"), { vendor_id: "v1", status: "available" });
    await setDoc(doc(db, "rewardStatus/v1"), { tickets: 10 });
    await setDoc(doc(db, "menu_embeddings/m1"), { v: [1] });
    await setDoc(doc(db, "resale_matches/lA"), { notified_uids: [] });
    await setDoc(doc(db, "draws/d1"), { buyer_tag: "abc123" });
    await setDoc(doc(db, "reviews/lAfree"), { vendor_id: "v1", rating: 5 });
  });

  async function t(id, name, fn) {
    try { await fn(); results.push([id, "PASS", name, ""]); }
    catch (e) { results.push([id, "FAIL", name, (e.message || String(e)).split("\n")[0].slice(0, 160)]); }
  }
  const in24h = () => Timestamp.fromMillis(Date.now() + 3600000);

  await t("R-01", "會員直接建立 locks 被拒", () => assertFails(setDoc(doc(A, "locks/new1"), { buyer_uid: "userA", vendor_id: "v1", status: "locked" })));
  await t("R-02", "讀別人 locked 的 lock 被拒", () => assertFails(getDoc(doc(B, "locks/lA"))));
  await t("R-03", "自己把 lock 改成 fulfilled 被拒", () => assertFails(updateDoc(doc(A, "locks/lA"), { status: "fulfilled" })));
  await t("R-04", "上架轉讓時改 locked_price 被拒", () => assertFails(updateDoc(doc(A, "locks/lA"), { status: "for_resale", locked_price: 1 })));
  await t("R-04+", "（對照）正常上架轉讓允許", async () => {
    await assertSucceeds(updateDoc(doc(A, "locks/lA"), { status: "for_resale", resale_deadline: in24h() }));
    await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), "locks/lA"), { status: "locked", resale_deadline: null }));
  });
  await t("R-05a", "resale_deadline 設過去被拒", () => assertFails(updateDoc(doc(A, "locks/lA"), { status: "for_resale", resale_deadline: Timestamp.fromMillis(Date.now() - 60000) })));
  await t("R-05b", "resale_deadline 設 32 天後被拒", () => assertFails(updateDoc(doc(A, "locks/lA"), { status: "for_resale", resale_deadline: Timestamp.fromMillis(Date.now() + 32 * 86400000) })));
  await t("R-06", "自己改 orderBanned=false 被拒", () => assertFails(updateDoc(doc(A, "users/userA"), { orderBanned: false })));
  await t("R-07", "lang 改成 jp 被拒", () => assertFails(updateDoc(doc(A, "users/userA"), { lang: "jp" })));
  await t("R-08a", "讀寫 payment_intents 被拒", async () => { await assertFails(getDoc(doc(A, "payment_intents/o1"))); await assertFails(setDoc(doc(A, "payment_intents/o1"), { a: 1 })); });
  await t("R-08b", "讀別家 payouts 被拒（會員）", () => assertFails(getDoc(doc(A, "payouts/p2"))));
  await t("R-08c", "讀別人的 lock_tokens 被拒", () => assertFails(getDoc(doc(A, "lock_tokens/lB"))));
  await t("R-09", "寫 slot_counters/draws/growth_rewards/accuracy_reports 被拒", async () => {
    for (const p of ["slot_counters/x", "draws/x", "growth_rewards/v1", "accuracy_reports/x"]) await assertFails(setDoc(doc(A, p), { a: 1 }));
  });
  const review = (lock, extra = {}) => ({ vendor_id: "v1", meal_plan_id: null, item_name: "便當", rating: 5, comment: "", reviewer_label: "資工系同學", created_at: serverTimestamp(), ...extra });
  await t("R-10a", "評別人的 lock 被拒", () => assertFails(setDoc(doc(B, "reviews/lAfree2"), review())));
  await t("R-10b", "評還沒取餐的 lock 被拒", () => assertFails(setDoc(doc(A, "reviews/lA"), review())));
  await t("R-10c", "同一筆評第二次被拒", () => assertFails(setDoc(doc(A, "reviews/lAfree"), review())));
  await t("R-11", "未封鎖卻建立 ban_appeals 被拒", () => assertFails(setDoc(doc(A, "ban_appeals/x"), { buyer_uid: "userA", status: "pending", reason: "x" })));
  await t("R-12a", "店主改店名被拒", () => assertFails(updateDoc(doc(OWNER, "vendors/v1"), { name: "新名" })));
  await t("R-12b", "店主改 verified 被拒", () => assertFails(updateDoc(doc(OWNER, "vendors/v1"), { verified: true })));
  await t("R-12c", "沒有月費訂閱了：店主改任何訂閱欄位都被拒", async () => {
    await assertFails(updateDoc(doc(OWNER, "vendors/v1"), { subscription_end_date: Timestamp.fromMillis(Date.now() + 999 * 86400000) }));
    await assertFails(updateDoc(doc(OWNER, "vendors/v1"), { subscription_status: "cancelled", cancelled_from: "active", cancel_requested_at: serverTimestamp() }));
  });
  await t("R-12d", "店主可以改菜單目錄（menu_catalogs，最多 30 個）；別家店主被拒", async () => {
    await assertSucceeds(updateDoc(doc(OWNER, "vendors/v1"), { menu_catalogs: ["午餐便當", "飲料"] }));
    await assertFails(updateDoc(doc(OWNER, "vendors/v1"), { menu_catalogs: "午餐便當" }));
    await assertFails(updateDoc(doc(OWNER, "vendors/v1"), { menu_catalogs: Array.from({ length: 31 }, (_, i) => `目錄${i}`) }));
    await assertFails(updateDoc(doc(OWNER2, "vendors/v1"), { menu_catalogs: ["亂改"] }));
  });
  await t("R-13", "cover_image 設 http:// 被拒", () => assertFails(updateDoc(doc(OWNER, "vendors/v1"), { cover_image: "http://x.com/a.png" })));
  await t("R-14", "店主改 i18n_src.name 被拒", () => assertFails(updateDoc(doc(OWNER, "vendors/v1"), { i18n_src: { name: "hack" } })));
  await t("R-15", "店主讀別家 payouts/accuracy_reports 被拒", async () => { await assertFails(getDoc(doc(OWNER, "payouts/p2"))); await assertFails(getDoc(doc(OWNER, "accuracy_reports/r2"))); });
  await t("R-16a", "管理員刪稽核紀錄被拒", () => assertFails(deleteDoc(doc(ADMIN, "admin_audit_logs/log1"))));
  await t("R-16b", "管理員用別人 email 寫稽核被拒", () => assertFails(setDoc(doc(ADMIN, "admin_audit_logs/log2"), { admin_email: "ckchildlikekid@gmail.com" })));
  await t("R-17", "未登入可讀 for_resale／for_gift lock、vendors、menu_items", async () => {
    await assertSucceeds(getDoc(doc(ANON, "locks/lAresale")));
    await assertSucceeds(getDoc(doc(ANON, "locks/lAgift")));
    await assertSucceeds(getDoc(doc(ANON, "vendors/v1")));
    await assertSucceeds(getDoc(doc(ANON, "menu_items/any")));
  });
  await t("R-18", "讀寫 menu_embeddings、assistant_cache 被拒", async () => {
    for (const db of [A, OWNER]) {
      await assertFails(getDoc(doc(db, "menu_embeddings/m1"))); await assertFails(setDoc(doc(db, "menu_embeddings/m2"), { a: 1 }));
      await assertFails(getDoc(doc(db, "assistant_cache/c1"))); await assertFails(setDoc(doc(db, "assistant_cache/c2"), { a: 1 }));
    }
  });
  await t("R-19", "會員/店主讀寫 resale_matches 被拒；管理員可讀", async () => {
    await assertFails(getDoc(doc(A, "resale_matches/lA"))); await assertFails(getDoc(doc(OWNER, "resale_matches/lA")));
    await assertFails(setDoc(doc(A, "resale_matches/x"), { a: 1 }));
    await assertSucceeds(getDoc(doc(ADMIN, "resale_matches/lA")));
  });
  await t("R-20", "自己寫 assistant_usage、resale_match_log 被拒", async () => {
    await assertFails(updateDoc(doc(A, "users/userA"), { assistant_usage: { count: 0 } }));
    await assertFails(updateDoc(doc(A, "users/userA"), { resale_match_log: { count: 0 } }));
  });
  await t("R-21", "讀別人 tasteProfiles 被拒", () => assertFails(getDoc(doc(A, "tasteProfiles/userB"))));
  await t("R-22", "自己寫 tasteProfiles.scores 被拒", () => assertFails(updateDoc(doc(A, "tasteProfiles/userA"), { scores: { 辣: 99 } })));
  await t("R-23", "讀別家/會員讀 areaInsights 被拒", async () => { await assertFails(getDoc(doc(OWNER, "areaInsights/v2"))); await assertFails(getDoc(doc(A, "areaInsights/v2"))); });
  await t("R-24", "會員寫 coupons/rewardTickets/userSpend/rewardStatus/rewardPeriods 被拒", async () => {
    for (const p of ["coupons/x", "rewardTickets/x", "userSpend/x", "rewardStatus/v1", "vendors/v1/rewardPeriods/2026-09-28"]) await assertFails(setDoc(doc(A, p), { user_id: "userA" }));
  });
  await t("R-25", "讀別人 coupons/rewardTickets/charityReservations 被拒", async () => {
    await assertFails(getDoc(doc(A, "coupons/cB"))); await assertFails(getDoc(doc(A, "rewardTickets/tB"))); await assertFails(getDoc(doc(A, "charityReservations/crB")));
  });
  await t("R-26", "店主讀 charityReservations、charityBans 被拒", async () => {
    await assertFails(getDoc(doc(OWNER, "charityReservations/crB"))); await assertFails(getDoc(doc(OWNER, "charityBans/userB")));
  });
  await t("R-27", "會員寫 charityMeals/charityBans/disasterEvents/sideWishes 被拒", async () => {
    for (const p of ["charityMeals/x", "charityBans/userA", "disasterEvents/x", "sideWishes/x"]) await assertFails(setDoc(doc(A, p), { a: 1 }));
  });
  await t("R-28", "店主改 prepPlans 的 done 以外欄位被拒", async () => {
    await assertFails(updateDoc(doc(OWNER, "vendors/v1/prepPlans/2026-10-01"), { total: 99 }));
    await assertSucceeds(updateDoc(doc(OWNER, "vendors/v1/prepPlans/2026-10-01"), { done: { a: true } }));
  });
  await t("R-29", "未登入可讀 charityMeals、rewardStatus", async () => {
    await assertSucceeds(getDoc(doc(ANON, "charityMeals/cm1"))); await assertSucceeds(getDoc(doc(ANON, "rewardStatus/v1")));
  });
  // Related page cases
  await t("C-MY-10a", "已取餐可填回饋一次、第二次不能改", async () => {
    await assertSucceeds(updateDoc(doc(A, "locks/lAfree"), { consumer_feedback: "好吃" }));
    await assertFails(updateDoc(doc(A, "locks/lAfree"), { consumer_feedback: "改" }));
  });
  await t("C-MY-10b", "未取餐（第一階段轉成 charity）可填回饋（BUG-2 回歸）", () => assertSucceeds(updateDoc(doc(A, "locks/lAcharity"), { consumer_feedback: "臨時有事" })));
  await t("C-MY-07", "自己領自己的贈送被拒", () => assertFails(updateDoc(doc(A, "locks/lAgift"), { status: "locked", buyer_uid: "userA", transferred_from_uids: ["userA"] })));
  await t("C-MY-06", "會員 B 領取贈送", () => assertSucceeds(updateDoc(doc(B, "locks/lAgift"), { status: "locked", buyer_uid: "userB", transferred_from_uids: ["userA"] })));
  await t("C-MKT-06", "期限未到不能免費領", () => assertFails(updateDoc(doc(B, "locks/lAresale"), { status: "locked", buyer_uid: "userB", locked_price: 0, transferred_from_uids: ["userA"] })));
  await t("C-BAN-05", "未封鎖者直接寫 ban_appeals 被拒", () => assertFails(addDoc(collection(B, "ban_appeals"), { buyer_uid: "userB", status: "pending" })));
  await t("V-MNU-06", "別家店主寫 v1 的 menu_items 被拒", () => assertFails(setDoc(doc(OWNER2, "menu_items/x"), { vendor_id: "v1", name: "x" })));
  await t("V-GRW-05", "店主直接改 coupons 被拒", () => assertFails(setDoc(doc(OWNER, "coupons/cB"), { discount: 100 })));
  await t("V-SET-10", "店主截單設 21:00 被拒、18:00 允許", async () => {
    await assertFails(updateDoc(doc(OWNER, "vendors/v1"), { cutoff_time: "21:00" }));
    await assertSucceeds(updateDoc(doc(OWNER, "vendors/v1"), { cutoff_time: "18:00" }));
  });
  await t("A-ANM-02", "管理員改 anomalies 只能動 status/note", async () => {
    await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), "anomalies/a1"), { status: "open", note: "", type: "refund" }));
    await assertSucceeds(updateDoc(doc(ADMIN, "anomalies/a1"), { status: "reviewed", note: "ok" }));
    await assertFails(updateDoc(doc(ADMIN, "anomalies/a1"), { type: "x" }));
  });
  // Writes the frontend actually sends (MyBookingsPage, TransferMarketPage, ProfilePage, subscription.ts, TasteAndNotifySection)
  const seed = (p, data) => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), p), data));
  const windowEnd = (daysAhead) => { // MyBookingsPage.pickupWindowEnd: 13:00 (Taipei) on the pickup date
    const d = new Date(Date.now() + daysAhead * 86400000 + 8 * 3600000).toISOString().slice(0, 10);
    return Timestamp.fromDate(new Date(`${d}T13:00:00+08:00`));
  };
  await t("C-MY-03", "上架轉讓：取餐日在 3 天後（期限＝取餐時段結束）", async () => {
    await seed("locks/lList3d", { buyer_uid: "userA", vendor_id: "v1", status: "locked", locked_price: 80 });
    await assertSucceeds(updateDoc(doc(A, "locks/lList3d"), { status: "for_resale", resale_deadline: windowEnd(3) }));
  });
  await t("C-MY-03b", "上架轉讓：取餐日是明天（期限在 24 小時內）", async () => {
    await seed("locks/lList1d", { buyer_uid: "userA", vendor_id: "v1", status: "locked", locked_price: 80 });
    await assertSucceeds(updateDoc(doc(A, "locks/lList1d"), { status: "for_resale", resale_deadline: Timestamp.fromMillis(Date.now() + 20 * 3600000) }));
  });
  await t("C-MY-03c", "上架轉讓：取餐日在 30 天後（最遠可預訂的一天）", async () => {
    await seed("locks/lList30d", { buyer_uid: "userA", vendor_id: "v1", status: "locked", locked_price: 80 });
    await assertSucceeds(updateDoc(doc(A, "locks/lList30d"), { status: "for_resale", resale_deadline: windowEnd(30) }));
  });
  await t("C-MY-05", "贈送：只能改 status=for_gift", async () => {
    await seed("locks/lGive", { buyer_uid: "userA", vendor_id: "v1", status: "locked", locked_price: 80 });
    await assertFails(updateDoc(doc(A, "locks/lGive"), { status: "for_gift", locked_price: 0 }));
    await assertSucceeds(updateDoc(doc(A, "locks/lGive"), { status: "for_gift" }));
  });
  await t("C-MY-08", "還沒人接手時取消轉讓／贈送 → 回到 locked；別人不能替我取消", async () => {
    await seed("locks/lCxR", { buyer_uid: "userA", vendor_id: "v1", status: "for_resale", resale_deadline: in24h(), locked_price: 80 });
    await seed("locks/lCxG", { buyer_uid: "userA", vendor_id: "v1", status: "for_gift", locked_price: 80 });
    await assertFails(updateDoc(doc(B, "locks/lCxR"), { status: "locked" }));
    await assertSucceeds(updateDoc(doc(A, "locks/lCxR"), { status: "locked" }));
    await assertSucceeds(updateDoc(doc(A, "locks/lCxG"), { status: "locked" }));
  });
  await t("C-MY-08b", "有人正在付款接手（resale_hold 未過期）時，賣家不能取消轉讓；保留過期後才能", async () => {
    const future = Timestamp.fromMillis(Date.now() + 15 * 60000);
    const past = Timestamp.fromMillis(Date.now() - 60000);
    await seed("locks/lHold", { buyer_uid: "userA", vendor_id: "v1", status: "for_resale", resale_deadline: in24h(), locked_price: 80, resale_hold: { uid: "userB", intent_id: "x", expires_at: future } });
    await assertFails(updateDoc(doc(A, "locks/lHold"), { status: "locked" }));
    await seed("locks/lHoldOld", { buyer_uid: "userA", vendor_id: "v1", status: "for_resale", resale_deadline: in24h(), locked_price: 80, resale_hold: { uid: "userB", intent_id: "y", expires_at: past } });
    await assertSucceeds(updateDoc(doc(A, "locks/lHoldOld"), { status: "locked" }));
  });
  await t("C-MKT-05", "轉讓期限過後：別人免費領取（locked_price=0、buyer=B）", async () => {
    await seed("locks/lExp", { buyer_uid: "userA", vendor_id: "v1", status: "for_resale", resale_deadline: Timestamp.fromMillis(Date.now() - 60000), locked_price: 80 });
    await assertFails(updateDoc(doc(B, "locks/lExp"), { status: "locked", buyer_uid: "userB", locked_price: 10, transferred_from_uids: ["userA"] }));
    await assertSucceeds(updateDoc(doc(B, "locks/lExp"), { status: "locked", buyer_uid: "userB", locked_price: 0, transferred_from_uids: ["userA"] }));
  });
  await t("C-MY-11", "已取餐評分允許；評價公開可讀", async () => {
    await seed("locks/lRev", { buyer_uid: "userA", vendor_id: "v1", status: "fulfilled", locked_price: 80, item_name: "便當" });
    await assertSucceeds(setDoc(doc(A, "reviews/lRev"), review(null, { comment: "好吃，推薦" })));
    await assertSucceeds(getDoc(doc(ANON, "reviews/lRev")));
  });
  await t("C-AUTH-08", "被封鎖過的帳號也能改顯示名稱", async () => {
    await seed("users/userBan", { display_name: "舊", lang: "zh", orderBanned: true });
    const BAN = env.authenticatedContext("userBan", tok("ban@test")).firestore();
    await assertSucceeds(updateDoc(doc(BAN, "users/userBan"), { display_name: "新名字" }));
  });
  await t("C-BAN-04", "被封鎖的會員可以送出申訴", async () => {
    const BAN = env.authenticatedContext("userBan", tok("ban@test")).firestore();
    await assertSucceeds(addDoc(collection(BAN, "ban_appeals"), { buyer_uid: "userBan", username: "ban@test", display_name: "新名字", reason: "已改進", status: "pending", created_at: serverTimestamp() }));
  });
  await t("C-AUTH-07", "註冊後送廠商申請：只能建立自己的 vendor_applications", async () => {
    await assertSucceeds(setDoc(doc(A, "vendor_applications/userA"), { store_name: "A 店", phone: "0912", email: "a@test", status: "pending", created_at: serverTimestamp() }));
    await assertFails(setDoc(doc(A, "vendor_applications/userB"), { store_name: "冒名", phone: "", email: "", status: "pending", created_at: serverTimestamp() }));
  });
  await t("C-TST-01", "口味偏好與過敏原：本人可寫可讀，別人讀不到", async () => {
    await assertSucceeds(setDoc(doc(A, "tasteProfiles/userA"), { prefs: { spicy: true, no_beef: true }, allergies: ["花生"] }, { merge: true }));
    await assertSucceeds(getDoc(doc(A, "tasteProfiles/userA")));
    await assertFails(getDoc(doc(B, "tasteProfiles/userA")));
  });
  await t("C-MTC-06 C-CHR-13", "會員可以關掉通知類別（muted_kinds）", () => assertSucceeds(updateDoc(doc(A, "users/userA"), { muted_kinds: ["charity", "resale_match"] })));
  await t("C-MY-18", "上架轉讓自訂轉讓價：0 ～ 原價（原價＋加減項）可以；超過原價、負數、小數被拒；取消轉讓可清掉轉讓價", async () => {
    const base = { buyer_uid: "userA", vendor_id: "v1", status: "locked", locked_price: 80, list_price: 100, adjust_amount: 10 };
    const { deleteField } = require("firebase/firestore");
    await seed("locks/lPriceOk", base);
    await assertSucceeds(updateDoc(doc(A, "locks/lPriceOk"), { status: "for_resale", resale_price: 110, resale_deadline: windowEnd(3) }));
    await assertSucceeds(updateDoc(doc(A, "locks/lPriceOk"), { status: "locked", resale_price: deleteField() }));
    await assertSucceeds(updateDoc(doc(A, "locks/lPriceOk"), { status: "for_resale", resale_price: 0, resale_deadline: windowEnd(3) }));
    for (const [id, price] of [["lPriceHigh", 111], ["lPriceNeg", -1], ["lPriceFloat", 50.5], ["lPriceStr", "50"]]) {
      await seed(`locks/${id}`, base);
      await assertFails(updateDoc(doc(A, `locks/${id}`), { status: "for_resale", resale_price: price, resale_deadline: windowEnd(3) }));
    }
    // Older data has no list_price: cap at locked_price
    await seed("locks/lPriceOld", { buyer_uid: "userA", vendor_id: "v1", status: "locked", locked_price: 80 });
    await assertFails(updateDoc(doc(A, "locks/lPriceOld"), { status: "for_resale", resale_price: 81 }));
    await assertSucceeds(updateDoc(doc(A, "locks/lPriceOld"), { status: "for_resale", resale_price: 80 }));
    // Others can't change the resale price
    await assertFails(updateDoc(doc(B, "locks/lPriceOk"), { resale_price: 1 }));
  });

  await t("R-30", "我的最愛：只有本人能建立（vendor_id＋created_at）、讀、刪；不能更新、不能多帶欄位、別人讀寫被拒", async () => {
    const fav = (db, uid, vid) => doc(db, `users/${uid}/favorites/${vid}`);
    await assertSucceeds(setDoc(fav(A, "userA", "v1"), { vendor_id: "v1", created_at: serverTimestamp() }));
    await assertSucceeds(getDoc(fav(A, "userA", "v1")));
    await assertFails(updateDoc(fav(A, "userA", "v1"), { created_at: serverTimestamp() }));
    await assertFails(setDoc(fav(A, "userA", "v2"), { vendor_id: "v2", created_at: serverTimestamp(), note: "x" }));
    await assertFails(setDoc(fav(A, "userA", "v2"), { vendor_id: "v1", created_at: serverTimestamp() }));
    await assertFails(setDoc(fav(A, "userA", "v2"), { vendor_id: "v2", created_at: Timestamp.fromMillis(Date.now() - 86400000) }));
    await assertFails(getDoc(fav(B, "userA", "v1")));
    await assertFails(setDoc(fav(B, "userA", "v2"), { vendor_id: "v2", created_at: serverTimestamp() }));
    await assertFails(deleteDoc(fav(B, "userA", "v1")));
    await assertSucceeds(deleteDoc(fav(A, "userA", "v1")));
  });

  await t("N-SEC-04", "draws/reviews 公開內容無完整 uid", async () => {
    const d = (await getDoc(doc(ANON, "draws/d1"))).data();
    if (d.buyer_uid) throw new Error("draws 有 buyer_uid");
  });

  await env.cleanup();
  const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
  for (const [id, st, name, msg] of results) console.log(`${st}  ${pad(id, 10)} ${name}${msg ? "  → " + msg : ""}`);
  const fails = results.filter((r) => r[1] === "FAIL").length;
  console.log(`\n${results.length - fails}/${results.length} passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
