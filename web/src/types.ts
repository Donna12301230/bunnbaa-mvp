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
  menu_catalogs?: string[]; // 菜單目錄（目錄 > 分類 兩層）的名稱與順序，店主在菜單管理頁維護
  // 取餐排程（店家設定頁，店主可改），沒設定＝預設時段、每天營業，見 lib/pickupSlots.ts
  pickup_windows?: string[]; // "11:30-12:00"
  business_hours?: BusinessHour[];
  holidays?: string[]; // YYYY-MM-DD
  slot_capacity?: number; // 每個取餐時段所有餐點合計上限；0／沒設＝不限，已訂數在 slot_counters
  // 第一階段規格 §2 店家可調參數（沒設＝平台預設）
  cutoff_time?: string; // 前一天幾點截單，只能比平台（20:00）早
  safety_stock_rate?: number;
  candidate_min_qty?: number;
  lat?: number; // 取餐點座標：附近愛心餐、區域洞察
  lng?: number;
  forecast_daily?: Record<string, number>; // 新店家前 4 週自填預估：menu_item_id → 每日份數
  anomaly_weeks?: string[]; // 店家標記的異常週（週一日期），預測時排除
  disaster_dates?: string[]; // 停班停課日（Functions 寫）
  typhoon_notice?: { dates: string[]; event_id: string } | null;
  menu_locked_week?: string;
  rewards_paused_from?: string;
  // 收益看板成本參數（§9.3），由 updateVendorCosts 寫，薪資不得低於基本工資
  hourly_wage?: number;
  staff_salaries?: number[];
  fixed_costs?: number;
  owner_hours_per_day?: number;
  linepay_fee_rate?: number;
}

export type MealPeriod = "breakfast" | "lunch" | "dinner";

export interface MenuItem {
  id: string;
  vendor_id: string;
  name: string;
  name_en?: string;
  description_en?: string;
  category_en?: string;
  // 目錄（分類的上一層，選填）：名稱存這裡，順序存 vendors.menu_catalogs，見 lib/menuCatalog.ts
  catalog?: string | null;
  catalog_en?: string;
  description: string;
  price: number;
  category: string;
  is_available: boolean;
  image: string | null;
  allergens: string[];
  dietary_tags: string[];
  created_at: unknown; // Firestore Timestamp
  // 便當（第一階段規格 §3）：沒有 slots 的是單品，不能加減飯菜
  item_type?: "bento" | "single"; // 單品直接點選、不需組合
  meal_periods?: MealPeriod[]; // 供應餐期（沒設＝店家所有時段）
  template?: string | null;
  // 可選主菜，各自定價（便當價以所選主菜為準）；沒有 mains 時用 main＋price
  mains?: BentoMain[];
  main?: { name: string; component_id?: string | null; portion_text?: string | null } | null;
  rice_component_id?: string | null;
  // 備料組成：每份都有、不能換也不能減的半成品（便當的固定附餐例如滷蛋；單品的全部組成例如蛋餅皮＋蛋）。portions 沒設＝1 份
  fixed?: { name: string; component_id?: string | null; portion_text?: string | null; portions?: number }[];
  slots?: BentoSlot[];
  custom_fields?: BentoCustomField[]; // 配菜下方店家自訂的下拉欄位（例：湯品、飲料、辣度）
  weekdays?: number[]; // 週菜單輪替：只在這幾天供應（沒設＝每天）
  component_id?: string | null; // 單品對應的半成品（備料用）
}

export interface BentoMain {
  name: string;
  component_id?: string | null;
  price: number;
  image_url?: string | null;
  portion_text?: string | null; // 材料總和顯示用，例：「雞腿 1 塊」（店家菜單編輯時由配方帶出）
}

export interface BentoCandidate {
  name: string;
  component_id?: string | null;
  image_url?: string | null; // 消費者點圖片選菜（§4.2）
  portion_text?: string | null; // 材料總和顯示用，例：「苦瓜 60 克」
  portion_level: number; // 1 全份、0.5 半份（第一階段只分兩級；由成本推算，店家可微調）
  weekly_cap?: number | null; // 本週供應上限
  min_qty?: number | null; // 成立最低量（沒設＝店家設定／平台預設）
  disabled?: boolean; // 成本比例 < 0.5，不得列為候選
}

export interface BentoSlot {
  category: string; // 青菜類、肉類配菜、蛋豆類…候選菜只能同類別
  default: { name: string; component_id?: string | null; image_url?: string | null; portion_text?: string | null };
  candidates: BentoCandidate[];
}

/** 店家自訂欄位（便當配菜下方的下拉選單）：消費者從選項選一個，第一個是預設；選項可加減價 */
export interface BentoCustomOption {
  name: string;
  price: number; // 加減價（0＝不加價）
}
export interface BentoCustomField {
  label: string;
  options: BentoCustomOption[];
}
/** 訂單上記錄的自訂欄位選擇 */
export interface LockCustomOption {
  label: string;
  index: number;
  choice: string;
  price: number;
}

/** 第四道配菜：備案（不加價，前三道沒成立時遞補）或加菜（+10） */
export type ExtraSideMode = "backup" | "addon";
export interface ExtraSideChoice {
  slot: number;
  candidate: number | null; // null＝那一格的預設菜
  mode: ExtraSideMode;
}
export interface LockExtraSide {
  slot: number;
  candidate_index: number | null;
  dish: string;
  component_id?: string | null;
  portion_level?: number;
  mode: ExtraSideMode;
  wished?: boolean;
  resolved?: string | null;
  used_for_slot?: number | null;
}

export type RiceOption = "add" | "normal" | "less";
/** 下單時每格的選擇：預設菜、候選菜 index、不要 */
export type SlotChoice = "default" | "none" | number;

export interface LockSlot {
  category: string;
  default_dish: string;
  default_component_id?: string | null;
  removed: boolean;
  wished: string | null;
  wished_component_id?: string | null;
  candidate_index?: number;
  resolved: string | null; // 截單判定後的實際配菜
  portion_level: number | null;
  substituted_from?: string;
  backup_used?: boolean; // 許願未成立，遞補第四道備案
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
  menu_item_id?: string | null; // 計畫供應的品項（決定餐期與可選時段）
  created_at: unknown; // Firestore Timestamp
}

export type LockStatus =
  | "locked"
  | "for_resale"
  | "for_gift"
  | "resold_and_fulfilled"
  | "fulfilled"
  | "no_show" // 舊制（未取餐停權），現在改轉愛心餐
  | "charity" // 未取餐轉入或主動捐出的愛心餐
  | "cancelling"
  | "cancelled"; // 消費者取消（取餐 48 小時前，換折價券）、停班停課自動退款

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
  phone_last3?: string | null; // 下單時手機末三碼，店家核對用（跟 4 碼取餐號一起當核銷碼）
  resale_price?: number; // 轉讓人自訂的轉讓價（0 ～ 原價）；沒填用早鳥價，見 lib/transfers.ts
  no_show_note?: string | null;
  note?: string; // 消費者下單時的備註（例如「不要香菜」），購物車結帳才會有
  consumer_feedback?: string | null;
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
  // 第一階段規格：便當內容、金額拆解、取餐憑證
  menu_item_id?: string | null;
  meal_period?: MealPeriod;
  main_dish?: string | null;
  main_index?: number | null;
  slots?: LockSlot[];
  extra_side?: LockExtraSide | null;
  custom_options?: LockCustomOption[];
  plan_day?: number;
  rice?: RiceOption;
  list_price?: number;
  early_bird_amount?: number;
  adjust_amount?: number;
  coupon_id?: string | null;
  coupon_discount?: number;
  payer_uid?: string;
  paid_amount?: number; // payer 在 transaction_id 實付的金額（退款依據）
  resale_hold?: { uid: string; intent_id: string; expires_at: unknown } | null; // 有人正在付款接手
  transfer_refund?: { uid: string; amount: number; status: "done" | "failed" | "none" } | null;
  pickup_code?: string; // 4 碼取餐號
  share_token?: string; // 代領連結
  cutoff_at?: unknown; // Firestore Timestamp
  cutoff_done?: boolean;
  charity_source?: "noshow" | "donated";
  cancel_reason?: "customer" | "disaster";
  refunded_amount?: number;
  // 消費者取消不退現金，改發折價券（原價 30%）：券的面額與 id；kept_amount 是留在店家的款項
  refund_coupon_amount?: number;
  refund_coupon_id?: string | null;
  kept_amount?: number;
  tickets_issued?: number;
  tags?: string[];
}

export interface Payout {
  id: string;
  vendor_id: string;
  amount: number; // 撥給店家的金額（已扣平台抽成）
  gross_amount?: number; // 消費者實付加總
  commission_amount?: number; // 平台抽成；2026-10-05 以前的紀錄沒有（當時全額撥款）
  commission_rate?: number;
  lock_count: number;
  status: "pending_manual_export";
  created_at: unknown; // Firestore Timestamp
}

export interface AccuracyReport {
  id: string;
  vendor_id: string;
  horizon: string;
  accuracy_rate: number;
  error_range: string; // 程式算的（vendorCalibration.calibrationStats），不是 LLM
  error_range_en?: string;
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
  homeGeo?: string; // 常用地點（粗略 geohash 7 碼）
  donatedCount?: number; // 主動捐出的愛心餐份數（個人愛心紀錄）
  mutedKinds?: string[]; // 關掉的通知類型，例如 "charity"
  charityNearbyPush?: boolean; // 「附近有愛心餐」推播，預設關閉
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

// ── 第一階段規格：配方、採購、獎勵、愛心餐、洞察 ──────────────────────────

export interface Ingredient {
  id: string;
  name: string;
  category: string;
  unit: string; // g / 個
  purchase_unit_label: string; // 例：盒、公斤、袋
  purchase_unit_size: number; // 一個採購單位是多少 unit
  yield_rate: number; // 熟成率（熟重 / 生重）
  loss_rate: number;
  shelf_days: number;
  frequency: "monthly" | "weekly" | "daily";
  supplier_id?: string | null;
  unit_price: number; // 每採購單位
}

export interface Component {
  id: string;
  name: string;
  portion_grams: number;
  ingredients: { ingredient_id: string; grams: number }[];
  prep_minutes: number;
  equipment: string;
  batch_capacity: number;
  advance_hours: number;
  method?: string;
  flavors?: string[];
  /** AI 產生的配方草稿，店家還沒確認過（菜單上會標「AI 草稿」） */
  ai_draft?: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  line_id?: string;
  note?: string;
}

export interface Coupon {
  id: string;
  vendor_id: string;
  vendor_name?: string;
  tier: string;
  label: string;
  discount: number;
  status: "issued" | "owned" | "redeemed" | "expired" | "unclaimed";
  pool_period: string;
  user_id?: string;
  expires_at?: unknown;
  lock_id?: string;
}

export interface RewardTicket {
  id: string;
  vendor_id: string;
  vendor_name?: string;
  user_id: string;
  period_id: string;
  status: "pending" | "drawable" | "drawn" | "forfeited" | "revoked";
  pool_period?: string;
  draw_deadline?: unknown;
  coupon_id?: string;
}

export interface RewardStatus {
  id: string;
  vendor_name: string;
  tickets_so_far: number;
  // 開池門檻改成累積淨營業額（2026-10-05）；舊資料只有 min_tickets，前端用 amount_to_open 回推
  revenue_so_far?: number;
  min_revenue?: number;
  min_tickets?: number;
  amount_to_open: number;
  pool_open: boolean;
  pool_period: string | null;
  draw_deadline: unknown;
  remaining_total: number;
  paused?: boolean;
}

export interface CharityMeal {
  id: string;
  vendor_id: string;
  vendor_name: string;
  vendor_address?: string;
  lat: number | null;
  lng: number | null;
  date: string;
  source: "noshow" | "donated";
  status: "available" | "reserved" | "claimed" | "given" | "wasted";
  pickup_code?: string | null;
  item_name: string;
  sides: string[];
  deadline: unknown;
}

export interface CharityReservation {
  id: string;
  user_id: string;
  meal_id: string;
  vendor_id: string;
  vendor_name: string;
  date: string;
  item_name: string;
  status: "reserved" | "claimed" | "expired";
  expires_at: unknown;
}

export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  link: string | null;
  kind: string;
  read: boolean;
  created_at: unknown;
}
