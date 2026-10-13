// Platform-wide settings. Stored in platformConfig/global and edited by admins under "Platform settings" in the admin console;
// when the doc is missing or lacks fields, these defaults apply so the server can still compute. The frontend's web/src/lib/platformConfig.ts
// has the same defaults; change both together.
const DEFAULT_PLATFORM_CONFIG = {
  businessWeekdays: [1, 2, 3, 4, 5], // Monday to Friday
  // Meal period ranges: classified by the pickup slot's start time
  mealPeriods: {
    breakfast: "06:00-10:30",
    lunch: "10:30-14:00",
    dinner: "16:30-20:00",
  },
  bookingRangeDays: 30, // at most 30 days ahead
  pickupWindow: "11:00-13:00", // default pickup slot; vendors can adjust it, max 2 hours
  maxPickupWindowMinutes: 120,
  cutoffTime: "20:00", // the day before pickup; vendors can only move it earlier
  weeklyLockWeekday: 6, // Saturday
  weeklyLockTime: "12:00",
  monthlyPurchaseDay: 25,
  safetyStockRate: 0.1, // vendor-adjustable
  riceAddPrice: 10,
  riceLessPrice: -5,
  slotRemovePrice: -5,
  maxSides: 4, // at most 4 sides
  addonSidePrice: 10, // fourth side as "add-on" is +10; as "backup" it's free
  riceAddGrams: 100, // extra rice = +100 g cooked rice (provisional)
  maxCandidatesPerSlot: 3,
  candidateMinQty: 10, // vendor-adjustable
  openWishThreshold: 20, // 20 people within the last 30 days
  openWishWindowDays: 30,
  // Growth rewards (revised 2026-10-05): once cumulative net revenue reaches NT$10,000 the pool opens, and 10% is returned as coupons drawn among draw-ticket holders
  // (lowering the rate to 5% was discussed on 10/05; on 2026-10-12 it was decided to keep 10%)
  rewardRate: 0.1,
  ticketUnit: 100, // one draw ticket per NT$100
  minRevenueToOpen: 10000,
  drawWindowDays: 7,
  couponValidDays: 30,
  // Cancellation (revised 2026-10-05): allowed up to 48 hours before pickup; no cash refund, instead a coupon worth 30% of the original price (valid for couponValidDays)
  cancelHoursBefore: 48,
  cancelCouponRate: 0.3,
  charityConvertAfterMinutes: 30,
  charityCloseAfterMinutes: 120,
  charityReserveMinutes: 10, // arrive within 10 minutes of reserving; on timeout it's released to the next person, no ban
  insightRadiusMeters: 1000,
  insightMinUsers: 20,
  // Partnership plan (revised 2026-10-05): no monthly fee, 5% commission per meal (on the amount paid); vendors add the 5% to their own prices
  commissionRate: 0.05,
};

// Minimum wage: platformConfig/minimumWage stores { monthly, hourly, effectiveFrom, source, history[] };
// used when the doc doesn't exist (Ministry of Labor announcement effective 2026-01-01: monthly 29,500, hourly 196).
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

// Coupon types: discount = amount off, cost = cost of upgrading from the base tier, weight = share of the upgrade budget.
// Phase 1 keeps only 3 types (free meal, half price, base 5%-off); the 90%-, 70%- and 20%-off coupons are left for a later release.
// The first entry is the grand prize (used for the grand-prize guarantee); the last is the tier remaining budget keeps upgrading into.
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

/** Minimum wage: returns the { monthly, hourly } in effect on a given day (YYYY-MM-DD); with no date, the current entry */
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
