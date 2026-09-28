export interface Vendor {
  id: string;
  name: string;
  // *_en：Functions 用 Gemini 自動翻的英文版（functions/src/translate.js），英文介面用 loc() 讀
  name_en?: string;
  description_en?: string;
  item_focus: string;
  reliability_tone: "new" | "variable" | "stable";
  status?: "active" | "disabled"; // missing = active, for backward compat with seeded data
  verified?: boolean; // 平台審核後手動認證，跟 reliability_tone（系統自動算）是兩件事；只有 admin 能寫
  // 瀏覽用的顯示欄位，選填——不是每個商家（例如舊測試商家）都會有值
  description?: string;
  address?: string;
  phone?: string;
  cover_image?: string; // 店家封面圖（Firebase Storage 下載網址），店主在店家設定頁上傳
  owner_uid?: string | null; // 平台審核後綁定的真實 Firebase Auth uid，只有 admin 能寫
  // 商家訂閱，見 lib/subscription.ts；舊資料可能沒有這些欄位
  subscription_status?: "trial" | "active" | "cancelled" | "expired";
  subscription_end_date?: unknown; // Firestore Timestamp
  cancelled_from?: "trial" | "active";
  cancel_requested_at?: unknown; // Firestore Timestamp
  // 取餐排程（店家設定頁，店主可改），沒設定＝預設時段、每天營業，見 lib/pickupSlots.ts
  pickup_windows?: string[]; // "11:30-12:00"
  business_hours?: BusinessHour[];
  holidays?: string[]; // YYYY-MM-DD
  slot_capacity?: number; // 每個取餐時段所有餐點合計上限；0／沒設＝不限，已訂數在 slot_counters
}

export interface MenuItem {
  id: string;
  vendor_id: string;
  name: string;
  name_en?: string;
  description_en?: string;
  category_en?: string;
  description: string;
  price: number;
  category: string;
  is_available: boolean;
  image: string | null;
  allergens: string[];
  dietary_tags: string[];
  created_at: unknown; // Firestore Timestamp
}

export interface MealPlan {
  id: string;
  vendor_id: string;
  label: string; // "A方案" / "B方案"
  label_en?: string;
  name_en?: string;
  description_en?: string;
  fastest_booking_en?: string;
  name: string;
  description: string;
  price_per_meal: number;
  fastest_booking: string;
  days: number; // 供餐天數，加入計畫時會生成這麼多筆 locks
  created_at: unknown; // Firestore Timestamp
}

export type LockStatus =
  | "locked"
  | "for_resale"
  | "for_gift"
  | "resold_and_fulfilled"
  | "fulfilled"
  | "no_show";

export interface Lock {
  id: string;
  vendor_id: string;
  item_name: string;
  item_name_en?: string | null; // 下單時從 menu_items.name_en 帶進來
  pickup_window: string;
  pickup_date: string; // YYYY-MM-DD
  discount_percent: number;
  resellable: boolean;
  locked_price: number;
  status: LockStatus;
  // Set alongside status "for_resale"; a lock past this deadline can be
  // claimed for free (firestore.rules), no scheduled function needed.
  resale_deadline?: unknown; // Firestore Timestamp
  no_show_note?: string | null;
  note?: string; // 消費者下單時的備註（例如「不要香菜」），購物車結帳才會有
  consumer_feedback?: string | null;
  discount_explanation?: string | null; // filled in by onLockCreated
  discount_explanation_en?: string | null;
  buyer_uid: string;
  // 曾經持有過、後來被別人接手（轉賣／免費領取／贈送）的 uid，接手時追加。
  // 「我的轉讓」靠這個查回已被接手的項目，原持有人也因此保有讀取權限。
  transferred_from_uids?: string[];
  created_at: unknown; // Firestore Timestamp
  reminder_sent?: boolean; // device token lives in the private lock_tokens/{lockId} doc
  // 計畫型（訂閱制多日方案）：付款成功後一次生成 N 筆 locks，用同一個 plan_id
  // 串起來，沒有另外的 plan/subscription collection（見 functions 的
  // createPlanLinePayReservation）。2026-09-28 起 plan_id＝該次付款的訂單 id，
  // 之前前端直寫的舊資料是「vendor_id-meal_plans id」。
  plan_id?: string;
  plan_label?: string;
  meal_plan_id?: string; // meal_plans 的 id，2026-09-28 之後加入的計畫才有
}

export interface Payout {
  id: string;
  vendor_id: string;
  amount: number;
  lock_count: number;
  status: "pending_manual_export";
  created_at: unknown; // Firestore Timestamp
}

export interface AccuracyReport {
  id: string;
  vendor_id: string;
  horizon: string;
  accuracy_rate: number;
  error_range: string;
  explanation: string;
  pattern_note: string;
  explanation_en?: string;
  pattern_note_en?: string;
  scenario_answer?: string;
  disclaimer: string;
  generated_at: unknown; // Firestore Timestamp
}

// ── Marketplace UI types (ported from BunnBaa Parse_Ref, back4app/Parse plain
//    object representations — kept distinct from the Lock-feature types above) ──

export interface BusinessHour {
  weekday: number;   // 0=日,1=一,...,6=六
  open: boolean;
  openTime: string;  // "HH:MM"
  closeTime: string; // "HH:MM"
}

export const ALLERGEN_LIST = [
  "蛋", "奶", "花生", "堅果", "小麥/麩質", "大豆", "海鮮", "芝麻",
] as const;

export const DIETARY_TAGS = ["葷食", "素食", "全素", "辣"] as const;

// 過敏原／飲食標籤是固定選項，英文版照這張表翻（資料庫存中文）
const TAG_EN: Record<string, string> = {
  蛋: "Egg", 奶: "Dairy", 花生: "Peanut", 堅果: "Tree nuts", "小麥/麩質": "Wheat / gluten", 大豆: "Soy", 海鮮: "Seafood", 芝麻: "Sesame",
  葷食: "Meat", 素食: "Vegetarian", 全素: "Vegan", 辣: "Spicy",
};
export const tagEn = (tag: string): string => TAG_EN[tag] ?? tag;

export interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  note: string;
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  displayName?: string;
  phone?: string;
  studentId?: string;
  department?: string;
  role: "customer" | "vendor" | "admin";
  vendorId?: string; // role 為 vendor 時，owner_uid 綁定到這個帳號的 vendors/{id}
  orderBanned?: boolean;
  noPickupCount?: number;
  lang?: "zh" | "en"; // users/{uid}.lang，取餐提醒推播用哪種語言
}

// reviews/{lockId}：消費者對已取餐的鎖定打分，公開可讀，見 firestore.rules
export interface Review {
  id: string; // = lock id
  vendor_id: string;
  meal_plan_id: string | null;
  item_name: string;
  rating: number; // 1–5
  comment: string; // 空字串＝不公開心得
  reviewer_label: string;
  // Functions 自動翻的英文（translateReview）
  comment_en?: string;
  item_name_en?: string;
  reviewer_label_en?: string;
  created_at: unknown; // Firestore Timestamp
}
