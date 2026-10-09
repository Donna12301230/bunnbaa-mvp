import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

// 平台全域參數（規格 §2），跟 functions/src/config.js 的預設值同一份，要改兩邊一起改。
// 實際值存在 platformConfig/global（管理後台「平台參數」可改），缺的欄位用預設。
export const DEFAULT_PLATFORM_CONFIG = {
  businessWeekdays: [1, 2, 3, 4, 5],
  mealPeriods: { breakfast: "06:00-10:30", lunch: "10:30-14:00", dinner: "16:30-20:00" },
  bookingRangeDays: 30,
  pickupWindow: "11:00-13:00",
  maxPickupWindowMinutes: 120,
  cutoffTime: "20:00",
  weeklyLockWeekday: 6,
  weeklyLockTime: "12:00",
  monthlyPurchaseDay: 25,
  safetyStockRate: 0.1,
  riceAddPrice: 10,
  riceLessPrice: -5,
  slotRemovePrice: -5,
  maxSides: 4,
  addonSidePrice: 10,
  riceAddGrams: 100,
  maxCandidatesPerSlot: 3,
  candidateMinQty: 10,
  openWishThreshold: 20,
  openWishWindowDays: 30,
  rewardRate: 0.05,
  ticketUnit: 100,
  minRevenueToOpen: 10000,
  drawWindowDays: 7,
  couponValidDays: 30,
  cancelHoursBefore: 48,
  cancelCouponRate: 0.3,
  charityConvertAfterMinutes: 30,
  charityCloseAfterMinutes: 120,
  charityReserveMinutes: 10,
  insightRadiusMeters: 1000,
  insightMinUsers: 20,
  commissionRate: 0.05,
};

export type PlatformConfig = typeof DEFAULT_PLATFORM_CONFIG;
type ScalarKey = { [K in keyof PlatformConfig]: PlatformConfig[K] extends number | string ? K : never }[keyof PlatformConfig];

/** 管理後台參數表用：每個參數的中文名稱與店家可不可調（規格 §2 表格） */
export const PLATFORM_CONFIG_FIELDS: { key: ScalarKey; label: string; unit?: string; vendorAdjustable?: string }[] = [
  { key: "pickupWindow", label: "取餐時段（預設）", vendorAdjustable: "可調時段，不可超過 2 小時" },
  { key: "cutoffTime", label: "每日截單（前一天）", vendorAdjustable: "可提前，不可延後" },
  { key: "safetyStockRate", label: "安全庫存比例", vendorAdjustable: "可調" },
  { key: "riceAddPrice", label: "白飯一碗半", unit: "元" },
  { key: "riceLessPrice", label: "白飯半碗", unit: "元" },
  { key: "slotRemovePrice", label: "配菜少一道", unit: "元／道" },
  { key: "maxSides", label: "配菜最多可選", unit: "道" },
  { key: "addonSidePrice", label: "第四道加菜（設為備案不加價）", unit: "元" },
  { key: "riceAddGrams", label: "一碗半多加", unit: "g 熟飯" },
  { key: "maxCandidatesPerSlot", label: "每格候選菜上限", unit: "道" },
  { key: "candidateMinQty", label: "候選菜成立最低量", unit: "份", vendorAdjustable: "可調" },
  { key: "rewardRate", label: "回饋比例" },
  { key: "ticketUnit", label: "抽獎券（每累計實付）", unit: "元／張" },
  { key: "minRevenueToOpen", label: "開池門檻（累積淨營業額）", unit: "元" },
  { key: "drawWindowDays", label: "抽獎期限（開池後）", unit: "天" },
  { key: "couponValidDays", label: "折價券效期（抽中或取消退券後）", unit: "天" },
  { key: "cancelHoursBefore", label: "可取消期限（取餐前）", unit: "小時" },
  { key: "cancelCouponRate", label: "取消退券比例（原價的幾成）" },
  { key: "charityConvertAfterMinutes", label: "未取餐轉愛心餐（時段結束後）", unit: "分" },
  { key: "charityCloseAfterMinutes", label: "愛心餐領取截止（時段結束後）", unit: "分" },
  { key: "charityReserveMinutes", label: "愛心餐預約到場時限（逾時釋出、不停權）", unit: "分" },
  { key: "commissionRate", label: "平台抽成比例（每份餐點實付金額的）" },
];

// 目前生效的平台參數（2026-10-09）：App 啟動時讀一次 platformConfig/global 存在這裡，
// 截單、營業日、可訂天數、加飯價等純函式（pickupSlots.ts、bento.ts）用 liveConfig() 取值，
// 管理員在後台改了參數，前端畫面就會跟伺服器一致。讀到之前用預設值。
let live: PlatformConfig = DEFAULT_PLATFORM_CONFIG;
export function liveConfig(): PlatformConfig {
  return live;
}

export function usePlatformConfig() {
  return useQuery({
    queryKey: ["platformConfig"],
    queryFn: async () => {
      const snap = await getDoc(doc(db, "platformConfig", "global"));
      const data = snap.exists() ? snap.data() : {};
      const merged = { ...DEFAULT_PLATFORM_CONFIG } as Record<string, unknown>;
      for (const key of Object.keys(DEFAULT_PLATFORM_CONFIG)) {
        if (data[key] !== undefined && data[key] !== null) merged[key] = data[key];
      }
      live = merged as PlatformConfig;
      return live;
    },
    staleTime: 30 * 60 * 1000,
    placeholderData: DEFAULT_PLATFORM_CONFIG,
  });
}
