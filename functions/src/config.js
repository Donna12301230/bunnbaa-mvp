// 平台全域參數（規格 §2）。存在 platformConfig/global，管理員在後台「平台參數」改；
// 文件不存在或缺欄位時用這裡的預設值，伺服器照樣能算。前端 web/src/lib/platformConfig.ts
// 有同一份預設值，要改兩邊一起改。
const DEFAULT_PLATFORM_CONFIG = {
  businessWeekdays: [1, 2, 3, 4, 5], // 週一至週五
  // 餐期範圍：依取餐時段的「開始時間」歸類（§2）
  mealPeriods: {
    breakfast: "06:00-10:30",
    lunch: "10:30-14:00",
    dinner: "16:30-20:00",
  },
  bookingRangeDays: 30, // 最遠提前 30 天
  pickupWindow: "11:00-13:00", // 預設取餐時段；店家可調，最長 2 小時
  maxPickupWindowMinutes: 120,
  cutoffTime: "20:00", // 取餐日前一天；店家只能提前
  weeklyLockWeekday: 6, // 週六
  weeklyLockTime: "12:00",
  monthlyPurchaseDay: 25,
  safetyStockRate: 0.1, // 店家可調
  riceAddPrice: 10,
  riceLessPrice: -5,
  slotRemovePrice: -5,
  maxSides: 4, // 配菜最多可選 4 道
  addonSidePrice: 10, // 第四道「加菜」+10；設為「備案」不加價
  riceAddGrams: 100, // 加飯 +100 g 熟飯（§16 暫定）
  maxCandidatesPerSlot: 3,
  candidateMinQty: 10, // 店家可調
  openWishThreshold: 20, // 近 30 天 20 人
  openWishWindowDays: 30,
  // 成長獎勵（2026-10-05 改版）：累積淨營業額滿 1 萬元開池，回饋 5% 變成折價券給持抽獎券的人抽
  rewardRate: 0.05,
  ticketUnit: 100, // 每 100 元一張抽獎券
  minRevenueToOpen: 10000,
  drawWindowDays: 7,
  couponValidDays: 30,
  // 取消（2026-10-05 改版）：取餐 48 小時前可取消，不退現金，改發原價 30% 的折價券（效期同 couponValidDays）
  cancelHoursBefore: 48,
  cancelCouponRate: 0.3,
  charityConvertAfterMinutes: 30,
  charityCloseAfterMinutes: 120,
  charityReserveMinutes: 10, // 預約後 10 分鐘內到場；逾時釋出給下一位、不停權
  insightRadiusMeters: 1000,
  insightMinUsers: 20,
  // 合作方案（2026-10-05 改版）：不收月費，每份餐點抽成 5%（以實付金額計）；店家定價時自行加 5%
  commissionRate: 0.05,
};

// 基本工資（§9.3）：platformConfig/minimumWage 存 { monthly, hourly, effectiveFrom, source, history[] }；
// 文件不存在時用這份（勞動部公告 2026-01-01 生效：月薪 29,500、時薪 196）。
const DEFAULT_MINIMUM_WAGE = {
  monthly: 29500,
  hourly: 196,
  effectiveFrom: "2026-01-01",
  source: "勞動部 2025-09 公告",
  history: [
    { monthly: 28590, hourly: 190, effectiveFrom: "2025-01-01" },
    { monthly: 29500, hourly: 196, effectiveFrom: "2026-01-01" },
  ],
};

// 券種（§8.3）：discount＝折抵金額，cost＝從保底升級的成本，weight＝升級預算分配權重。
// 第一階段只保留 3 種（免費餐券、半價券、保底九五折券）；一折、三折、八折券列入後續改版。
// 陣列第一個是頭獎（頭獎保證用），最後一個是剩餘預算繼續升級的等級。
const COUPON_TIERS = [
  { code: "free", label: "免費餐券", discount: 100, cost: 95, weight: 0.3 },
  { code: "t50", label: "半價券", discount: 50, cost: 45, weight: 0.7 },
];
const BASE_TIER = { code: "t95", label: "九五折券", discount: 5 };

async function loadPlatformConfig(db) {
  const snap = await db.collection("platformConfig").doc("global").get();
  const data = snap.exists ? snap.data() : {};
  const merged = { ...DEFAULT_PLATFORM_CONFIG };
  for (const key of Object.keys(DEFAULT_PLATFORM_CONFIG)) {
    if (data[key] !== undefined && data[key] !== null) merged[key] = data[key];
  }
  return merged;
}

/** 基本工資：回傳某天（YYYY-MM-DD）生效的 { monthly, hourly }；沒給日期就是目前這筆 */
function wageOn(wage, date) {
  const history = Array.isArray(wage?.history) && wage.history.length > 0 ? wage.history : [wage];
  const applicable = history
    .filter((h) => h && Number(h.hourly) > 0 && (!date || !h.effectiveFrom || h.effectiveFrom <= date))
    .sort((a, b) => String(a.effectiveFrom || "").localeCompare(String(b.effectiveFrom || "")));
  const hit = applicable[applicable.length - 1] || wage;
  return { monthly: Number(hit.monthly) || 0, hourly: Number(hit.hourly) || 0, effectiveFrom: hit.effectiveFrom || null };
}

async function loadMinimumWage(db) {
  const snap = await db.collection("platformConfig").doc("minimumWage").get();
  return snap.exists ? { ...DEFAULT_MINIMUM_WAGE, ...snap.data() } : DEFAULT_MINIMUM_WAGE;
}

module.exports = {
  DEFAULT_PLATFORM_CONFIG, COUPON_TIERS, BASE_TIER, DEFAULT_MINIMUM_WAGE, loadPlatformConfig, loadMinimumWage, wageOn,
};
