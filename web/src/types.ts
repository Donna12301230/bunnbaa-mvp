export interface Vendor {
  id: string;
  name: string;
  item_focus: string;
  reliability_tone: "new" | "variable" | "stable";
  status?: "active" | "disabled"; // missing = active, for backward compat with seeded data
  verified?: boolean; // 平台審核後手動認證，跟 reliability_tone（系統自動算）是兩件事；只有 admin 能寫
  // 瀏覽用的顯示欄位，選填——不是每個商家（例如舊測試商家）都會有值
  description?: string;
  address?: string;
  phone?: string;
  owner_uid?: string | null; // 平台審核後綁定的真實 Firebase Auth uid，只有 admin 能寫
  // 商家訂閱，見 lib/subscription.ts；舊資料可能沒有這些欄位
  subscription_status?: "trial" | "active" | "cancelled" | "expired";
  subscription_end_date?: unknown; // Firestore Timestamp
  cancelled_from?: "trial" | "active";
  cancel_requested_at?: unknown; // Firestore Timestamp
}

export interface MenuItem {
  id: string;
  vendor_id: string;
  name: string;
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
  name: string;
  description: string;
  price_per_meal: number;
  rating: number;
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
  buyer_uid: string;
  created_at: unknown; // Firestore Timestamp
  reminder_sent?: boolean; // device token lives in the private lock_tokens/{lockId} doc
  // 計畫型（訂閱制多日方案）：加入計畫時一次生成 N 筆 locks，用同一個 plan_id
  // 串起來，沒有另外的 plan/subscription collection（見 HomePage.tsx 的
  // handleJoinPlan）。firestore.rules 的 create 規則沒有限制欄位白名單，
  // 所以這兩個欄位不需要另外修改規則。
  plan_id?: string;
  plan_label?: string;
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

export interface VendorData {
  id: string;
  name: string;
  description: string;
  address: string;
  phone: string;
  coverImage?: string;
  isApproved: boolean;
  isActive: boolean;
  subscriptionStatus: "trial" | "active" | "expired" | "cancelled";
  subscriptionStartDate?: Date;
  subscriptionEndDate?: Date;
  cancelRequestedAt?: Date;
  ownerId: string;
  orderWeekdays?: number[]; // 舊欄位，保留向下相容
  businessHours?: BusinessHour[]; // 營業時段（取代 orderWeekdays）
  holidays?: string[];             // 指定公休日，格式 "YYYY-MM-DD"
  tables?: string[];               // 現場點餐桌位 QR code 名稱清單
  createdAt: Date;
}

export const ALLERGEN_LIST = [
  "蛋", "奶", "花生", "堅果", "小麥/麩質", "大豆", "海鮮", "芝麻",
] as const;

export const DIETARY_TAGS = ["葷食", "素食", "全素", "辣"] as const;

// MenuItemData（mock，camelCase）跟上面真實的 MenuItem（snake_case）並存——
// 「揪團預購場次/現場點餐」那組 vendor-portal 頁面回復使用 mock 資料，只有
// VendorListPage/VendorPage/MenuItemPage/CartPage/VendorPortalMenu 這五個
// 真的接了 Firestore 的頁面用 MenuItem。
export interface MenuItemData {
  id: string;
  name: string;
  description: string;
  price: number;
  image?: string;
  isAvailable: boolean;
  category: string;
  allergens: string[];   // 過敏原標示
  dietaryTags: string[]; // 葷素／辣度標記
  vendorId: string;
  createdAt: Date;
}

export interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  note: string;
}

export interface PreOrderData {
  id: string;
  customerId: string;
  vendorId: string;
  vendorName: string;
  sessionId?: string;
  pickupDate: Date;
  pickupLocation: string;
  orderType: "individual" | "group";
  groupName?: string;
  totalAmount: number;
  discountAmount: number;
  finalAmount: number;
  status: "pending" | "confirmed" | "cancelled" | "completed";
  paymentMethod: "cash";
  paymentStatus: "unpaid" | "paid";
  depositRequired?: boolean;
  depositStatus?: "pending" | "confirmed" | "waived";
  items: PreOrderItemData[];
  createdAt: Date;
}

export interface PreOrderItemData {
  id: string;
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  unitPrice: number;
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
}

export interface TableOrderData {
  id: string;
  vendorId: string;
  tableName: string;
  customerName: string;
  customerPhone: string;
  totalAmount: number;
  status: "pending" | "confirmed" | "completed" | "cancelled";
  paymentMethod: "cash";
  paymentStatus: "unpaid" | "paid";
  note: string;
  items: TableOrderItemData[];
  createdAt: Date;
}

export interface TableOrderItemData {
  id: string;
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  unitPrice: number;
  note: string;
}

export interface OrderSessionData {
  id: string;
  vendorId: string;
  sessionDate: Date;
  pickupTime: string;       // e.g. "12:00"
  deadline: Date;
  pickupLocation: string;
  status: "open" | "closed" | "completed";
  note: string;
  autoCreated?: boolean;    // 由 businessHours 自動建立
  createdAt: Date;
}

