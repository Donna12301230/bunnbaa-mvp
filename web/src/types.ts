export interface Vendor {
  id: string;
  name: string;
  item_focus: string;
  reliability_tone: "new" | "variable" | "stable";
  status?: "active" | "disabled"; // missing = active, for backward compat with seeded data
}

export type LockStatus =
  | "locked"
  | "for_resale"
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
  no_show_note?: string | null;
  consumer_feedback?: string | null;
  discount_explanation?: string | null; // filled in by onLockCreated
  buyer_uid: string;
  created_at: unknown; // Firestore Timestamp
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

export interface EarlyBirdRule {
  daysInAdvance: number; // minimum days before pickup
  discountRate: number;  // e.g. 0.9 = 90% = 10% off
}

export interface CartItem {
  menuItem: MenuItemData;
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

export interface GroupOrderData {
  id: string;
  leaderId: string;
  leaderName: string;
  vendorId: string;
  vendorName: string;
  sessionId: string;
  sessionDate: Date;
  sessionPickupTime: string;
  sessionDeadline: Date;
  pickupLocation: string;
  title: string;
  joinCode: string;
  status: "open" | "closed";
  note: string;
  memberCount: number;
  createdAt: Date;
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
