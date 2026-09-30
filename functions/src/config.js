// 平台全域參數（規格 §2）。存在 platformConfig/global，管理員在後台「平台參數」改；
// 文件不存在或缺欄位時用這裡的預設值，伺服器照樣能算。前端 web/src/lib/platformConfig.ts
// 有同一份預設值，要改兩邊一起改。
const DEFAULT_PLATFORM_CONFIG = {
  businessWeekdays: [1, 2, 3, 4, 5], // 週一至週五
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
  riceAddGrams: 100, // 加飯 +100 g 熟飯（§16 暫定）
  maxCandidatesPerSlot: 3,
  candidateMinQty: 10, // 店家可調
  openWishThreshold: 20, // 近 30 天 20 人
  openWishWindowDays: 30,
  rewardRate: 0.1,
  ticketUnit: 100, // 每 100 元一張抽獎券
  minTicketsToOpen: 100,
  drawWindowDays: 7,
  couponValidDays: 30,
  charityConvertAfterMinutes: 30,
  charityCloseAfterMinutes: 120,
  charityReserveMinutes: 30,
  charityBanDays: 7,
  insightRadiusMeters: 1000,
  insightMinUsers: 20,
};

// 券種（§8.3）：face＝折抵金額，cost＝從保底升級的成本，weight＝升級預算分配權重
const COUPON_TIERS = [
  { code: "free", label: "零元券", discount: 100, cost: 95, weight: 0.05 },
  { code: "t10", label: "一折券", discount: 90, cost: 85, weight: 0.1 },
  { code: "t30", label: "三折券", discount: 70, cost: 65, weight: 0.15 },
  { code: "t50", label: "五折券", discount: 50, cost: 45, weight: 0.25 },
  { code: "t80", label: "八折券", discount: 20, cost: 15, weight: 0.45 },
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

module.exports = { DEFAULT_PLATFORM_CONFIG, COUPON_TIERS, BASE_TIER, loadPlatformConfig };
