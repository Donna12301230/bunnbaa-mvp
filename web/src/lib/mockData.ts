// TODO(firebase): static sample data standing in for Parse Server (Back4App)
// queries (`Parse.Query("Vendor")`, `Parse.Query("MenuItem")`, `Parse.Cloud.run(...)`)
// across the ported login/home/admin/vendor-portal pages. Replace each mock*
// function below with a real Firestore read/write once the backend is wired up.
import type {
  VendorData,
  MenuItemData,
  BusinessHour,
  OrderSessionData,
  PreOrderData,
  TableOrderData,
} from "@/types";

const defaultBusinessHours: BusinessHour[] = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  open: weekday !== 1, // 週一公休，示意用
  openTime: "10:30",
  closeTime: "19:00",
}));

export const mockVendors: VendorData[] = [
  {
    id: "vendor-1",
    name: "王媽媽便當",
    description: "家常台式便當，每日現炒現做",
    address: "嘉義市東區林森西路 100 號",
    phone: "05-123-4567",
    coverImage: undefined,
    isApproved: true,
    isActive: true,
    subscriptionStatus: "active",
    subscriptionEndDate: new Date(Date.now() + 20 * 86400000),
    ownerId: "mock-vendoruser1",
    businessHours: defaultBusinessHours,
    holidays: [],
    createdAt: new Date("2026-01-10"),
  },
  {
    id: "vendor-2",
    name: "阿嘉炸雞排",
    description: "酥脆現炸雞排、雞塊、薯條",
    address: "嘉義市西區中山路 88 號",
    phone: "05-234-5678",
    coverImage: undefined,
    isApproved: true,
    isActive: true,
    subscriptionStatus: "trial",
    subscriptionEndDate: new Date(Date.now() + 5 * 86400000),
    ownerId: "mock-vendoruser2",
    businessHours: defaultBusinessHours,
    holidays: [],
    createdAt: new Date("2026-02-01"),
  },
  {
    id: "vendor-3",
    name: "早安三明治",
    description: "現點現做手工厚蛋三明治",
    address: "嘉義市東區大學路 168 號",
    phone: "05-345-6789",
    coverImage: undefined,
    isApproved: false,
    isActive: false,
    subscriptionStatus: "trial",
    ownerId: "mock-vendoruser3",
    businessHours: defaultBusinessHours,
    holidays: [],
    createdAt: new Date("2026-03-01"),
  },
];

export const mockMenuItems: MenuItemData[] = [
  { id: "item-1", name: "招牌排骨便當", description: "香煎排骨、三樣配菜", price: 90, isAvailable: true, category: "便當", allergens: ["蛋"], dietaryTags: ["葷食"], vendorId: "vendor-1", createdAt: new Date("2026-01-11") },
  { id: "item-2", name: "滷雞腿便當", description: "古早味滷雞腿", price: 95, isAvailable: true, category: "便當", allergens: [], dietaryTags: ["葷食"], vendorId: "vendor-1", createdAt: new Date("2026-01-11") },
  { id: "item-3", name: "素食便當", description: "五樣時蔬配豆腐", price: 80, isAvailable: true, category: "便當", allergens: ["大豆"], dietaryTags: ["素食"], vendorId: "vendor-1", createdAt: new Date("2026-01-12") },
  { id: "item-4", name: "原味雞排", description: "酥脆現炸", price: 70, isAvailable: true, category: "炸物", allergens: ["小麥/麩質"], dietaryTags: ["葷食"], vendorId: "vendor-2", createdAt: new Date("2026-02-02") },
  { id: "item-5", name: "辣味雞排", description: "麻辣夠味", price: 75, isAvailable: true, category: "炸物", allergens: ["小麥/麩質"], dietaryTags: ["葷食", "辣"], vendorId: "vendor-2", createdAt: new Date("2026-02-02") },
  { id: "item-6", name: "手工厚蛋三明治", description: "現煎厚蛋、生菜、火腿", price: 55, isAvailable: true, category: "早餐", allergens: ["蛋", "奶"], dietaryTags: ["葷食"], vendorId: "vendor-3", createdAt: new Date("2026-03-02") },
];

export interface MockBanAppeal {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  adminNote?: string;
  createdAt: Date;
}

export const mockBanAppeals: MockBanAppeal[] = [
  {
    id: "appeal-1",
    userId: "mock-user42",
    username: "student42",
    displayName: "陳同學",
    reason: "當天臨時生病無法取餐，已提前私訊店家告知",
    status: "pending",
    createdAt: new Date("2026-03-10"),
  },
];

// ── Mock "cloud function" mutations (Parse.Cloud.run stand-ins) ────────────
export function mockApproveVendor(id: string, approved: boolean) {
  const vendor = mockVendors.find(v => v.id === id);
  if (vendor) {
    vendor.isApproved = approved;
    vendor.isActive = approved;
  }
}

export function mockProcessBanAppeal(appealId: string, approved: boolean) {
  const appeal = mockBanAppeals.find(a => a.id === appealId);
  if (appeal) {
    appeal.status = approved ? "approved" : "rejected";
  }
}

export interface MockReportStats {
  totalRevenue: number;
  totalOrders: number;
  avgOrder: number;
  completedOrders: number;
  revenueByDate: { date: string; revenue: number }[];
  topItems: { name: string; qty: number; revenue: number }[];
}

function dateKey(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function mockGetVendorReportStats(vendorId: string, source: "pre" | "table"): MockReportStats | null {
  if (source === "pre") {
    const orders = mockPreOrders.filter(o => o.vendorId === vendorId && o.status !== "cancelled");
    if (orders.length === 0) return null;
    const totalRevenue = orders.reduce((s, o) => s + o.finalAmount, 0);
    const totalOrders = orders.length;
    const avgOrder = Math.round(totalRevenue / totalOrders);
    const completedOrders = orders.filter(o => o.status === "completed").length;
    const dateMap = new Map<string, number>();
    orders.forEach(o => dateMap.set(dateKey(o.pickupDate), (dateMap.get(dateKey(o.pickupDate)) ?? 0) + o.finalAmount));
    const revenueByDate = Array.from(dateMap.entries()).slice(-15).map(([date, revenue]) => ({ date, revenue }));
    const itemMap = new Map<string, { name: string; qty: number; revenue: number }>();
    orders.forEach(o => o.items.forEach(i => {
      const cur = itemMap.get(i.menuItemName);
      if (cur) { cur.qty += i.quantity; cur.revenue += i.quantity * i.unitPrice; }
      else itemMap.set(i.menuItemName, { name: i.menuItemName, qty: i.quantity, revenue: i.quantity * i.unitPrice });
    }));
    const topItems = Array.from(itemMap.values()).sort((a, b) => b.qty - a.qty).slice(0, 10);
    return { totalRevenue, totalOrders, avgOrder, completedOrders, revenueByDate, topItems };
  }

  const orders = mockTableOrders.filter(o => o.vendorId === vendorId && o.status !== "cancelled");
  if (orders.length === 0) return null;
  const totalRevenue = orders.reduce((s, o) => s + o.totalAmount, 0);
  const totalOrders = orders.length;
  const avgOrder = Math.round(totalRevenue / totalOrders);
  const completedOrders = orders.filter(o => o.status === "completed").length;
  const dateMap = new Map<string, number>();
  orders.forEach(o => dateMap.set(dateKey(o.createdAt), (dateMap.get(dateKey(o.createdAt)) ?? 0) + o.totalAmount));
  const revenueByDate = Array.from(dateMap.entries()).slice(-15).map(([date, revenue]) => ({ date, revenue }));
  const itemMap = new Map<string, { name: string; qty: number; revenue: number }>();
  orders.forEach(o => o.items.forEach(i => {
    const cur = itemMap.get(i.menuItemName);
    if (cur) { cur.qty += i.quantity; cur.revenue += i.quantity * i.unitPrice; }
    else itemMap.set(i.menuItemName, { name: i.menuItemName, qty: i.quantity, revenue: i.quantity * i.unitPrice });
  }));
  const topItems = Array.from(itemMap.values()).sort((a, b) => b.qty - a.qty).slice(0, 10);
  return { totalRevenue, totalOrders, avgOrder, completedOrders, revenueByDate, topItems };
}

export function mockGetMyVendor(): VendorData {
  // Demo purposes: every "vendor" user is treated as owning the first mock vendor.
  return mockVendors[0];
}

export function mockUpdateVendor(vendorId: string, patch: Partial<VendorData>) {
  const vendor = mockVendors.find(v => v.id === vendorId);
  if (vendor) Object.assign(vendor, patch);
  return vendor;
}

export async function mockSaveVendorSettings(vendorId: string, patch: Partial<VendorData>) {
  return mockUpdateVendor(vendorId, patch);
}

export async function mockRequestCancelSubscription(vendorId: string) {
  mockUpdateVendor(vendorId, { subscriptionStatus: "cancelled", cancelRequestedAt: new Date() });
}

export async function mockReactivateSubscription(vendorId: string) {
  mockUpdateVendor(vendorId, { subscriptionStatus: "active", cancelRequestedAt: undefined });
}

export function mockSyncOrderSessions(vendor: VendorData, weekDates: Date[]): number {
  const businessHours = vendor.businessHours ?? [];
  const holidays = vendor.holidays ?? [];
  if (businessHours.length === 0) return 0;
  const now = new Date();
  let created = 0;
  for (const date of weekDates) {
    const dateStr = date.toISOString().slice(0, 10);
    if (holidays.includes(dateStr)) continue;
    const bh = businessHours.find(h => h.weekday === date.getDay());
    if (!bh?.open) continue;
    if (mockOrderSessions.some(s => s.vendorId === vendor.id && s.sessionDate.toISOString().slice(0, 10) === dateStr)) continue;
    if (dateStr === now.toISOString().slice(0, 10) && bh.closeTime < now.toTimeString().slice(0, 5)) continue;
    mockOrderSessions.push({
      id: "session-" + Math.random().toString(36).slice(2, 9),
      vendorId: vendor.id,
      sessionDate: new Date(`${dateStr}T${bh.openTime}:00`),
      pickupTime: bh.closeTime,
      deadline: new Date(`${dateStr}T${bh.closeTime}:00`),
      pickupLocation: vendor.address ?? "",
      status: "open",
      note: "",
      autoCreated: true,
      createdAt: new Date(),
    });
    created++;
  }
  return created;
}

export function mockToggleSessionStatus(id: string) {
  const session = mockOrderSessions.find(s => s.id === id);
  if (session) session.status = session.status === "open" ? "closed" : "open";
}

export function mockSaveMenuItem(
  form: { id?: string | null; name: string; description: string; price: number; category: string; isAvailable: boolean; image?: string; allergens: string[]; dietaryTags: string[] },
  vendorId: string,
): MenuItemData {
  if (form.id) {
    const existing = mockMenuItems.find(i => i.id === form.id);
    if (existing) {
      Object.assign(existing, { ...form, image: form.image || undefined });
      return existing;
    }
  }
  const created: MenuItemData = {
    id: "item-" + Math.random().toString(36).slice(2, 9),
    name: form.name,
    description: form.description,
    price: form.price,
    category: form.category,
    isAvailable: form.isAvailable,
    image: form.image || undefined,
    allergens: form.allergens,
    dietaryTags: form.dietaryTags,
    vendorId,
    createdAt: new Date(),
  };
  mockMenuItems.push(created);
  return created;
}

export function mockDeleteMenuItem(id: string) {
  const idx = mockMenuItems.findIndex(i => i.id === id);
  if (idx >= 0) mockMenuItems.splice(idx, 1);
}

export interface MockVendorDashboard {
  vendorName: string;
  pendingOrders: number;
  totalOrders: number;
  menuCount: number;
  tablePending: number;
  todaySessions: { id: string; pickupTime: string; pickupLocation: string; status: string; orderCount: number }[];
}

export async function mockGetVendorDashboard(): Promise<MockVendorDashboard> {
  const vendor = mockVendors[0];
  return {
    vendorName: vendor?.name ?? "我的店家",
    pendingOrders: mockPreOrders.filter(o => o.status === "pending").length,
    totalOrders: mockPreOrders.length,
    menuCount: mockMenuItems.filter(i => i.vendorId === vendor?.id).length,
    tablePending: mockTableOrders.filter(o => o.status === "pending").length,
    todaySessions: mockOrderSessions.map(s => ({
      id: s.id,
      pickupTime: s.pickupTime,
      pickupLocation: s.pickupLocation,
      status: s.status,
      orderCount: mockPreOrders.filter(o => o.sessionId === s.id).length,
    })),
  };
}

export const mockOrderSessions: OrderSessionData[] = [
  {
    id: "session-1",
    vendorId: "vendor-1",
    sessionDate: new Date(),
    pickupTime: "12:00",
    deadline: new Date(Date.now() + 3600 * 1000),
    pickupLocation: "店面自取",
    status: "open",
    note: "",
    createdAt: new Date(),
  },
];

export const mockPreOrders: PreOrderData[] = [
  {
    id: "preorder-1",
    customerId: "mock-student1",
    vendorId: "vendor-1",
    vendorName: "王媽媽便當",
    sessionId: "session-1",
    pickupDate: new Date(),
    pickupLocation: "店面自取",
    orderType: "individual",
    totalAmount: 90,
    discountAmount: 0,
    finalAmount: 90,
    status: "confirmed",
    paymentMethod: "cash",
    paymentStatus: "unpaid",
    items: [{ id: "poi-1", menuItemId: "item-1", menuItemName: "招牌排骨便當", quantity: 1, unitPrice: 90, note: "" }],
    createdAt: new Date(),
  },
];

export const mockTableOrders: TableOrderData[] = [];

export function mockFindPreOrderByCode(code: string, vendorId: string): PreOrderData | undefined {
  const suffix = code.trim().toUpperCase().slice(-8);
  return mockPreOrders.find(o =>
    o.vendorId === vendorId &&
    (o.status === "confirmed" || o.status === "pending") &&
    o.id.slice(-8).toUpperCase() === suffix,
  );
}

export function mockUpdatePreOrderStatus(orderId: string, status: PreOrderData["status"]) {
  const order = mockPreOrders.find(o => o.id === orderId);
  if (order) {
    order.status = status;
    if (status === "completed") order.paymentStatus = "paid";
  }
}

export interface MockSessionSummary {
  sessionDate: Date;
  pickupTime: string;
  deadline: Date;
  pickupLocation: string;
  status: string;
  note: string;
  totalOrders: number;
  totalAmount: number;
  totalItems: number;
  itemAggregates: { name: string; quantity: number; unitPrice: number }[];
  customerOrders: { orderId: string; customerName: string; department: string; status: string; paymentStatus: string; finalAmount: number; items: { name: string; quantity: number; unitPrice: number; note: string }[] }[];
}

export async function mockGetSessionSummary(sessionId: string): Promise<MockSessionSummary | null> {
  const session = mockOrderSessions.find(s => s.id === sessionId);
  if (!session) return null;

  const orders = mockPreOrders.filter(o => o.sessionId === sessionId && o.status !== "cancelled");

  const aggregateMap = new Map<string, { name: string; quantity: number; unitPrice: number }>();
  orders.forEach(order => {
    order.items.forEach(item => {
      const existing = aggregateMap.get(item.menuItemName);
      if (existing) existing.quantity += item.quantity;
      else aggregateMap.set(item.menuItemName, { name: item.menuItemName, quantity: item.quantity, unitPrice: item.unitPrice });
    });
  });
  const itemAggregates = Array.from(aggregateMap.values()).sort((a, b) => b.quantity - a.quantity);

  const customerOrders = orders.map(order => ({
    orderId: order.id,
    customerName: order.groupName || "未知用戶",
    department: "",
    status: order.status,
    paymentStatus: order.paymentStatus,
    finalAmount: order.finalAmount,
    items: order.items.map(i => ({ name: i.menuItemName, quantity: i.quantity, unitPrice: i.unitPrice, note: i.note })),
  }));

  const totalAmount = customerOrders.reduce((s, o) => s + o.finalAmount, 0);
  const totalItems = orders.reduce((s, o) => s + o.items.reduce((si, i) => si + i.quantity, 0), 0);

  return {
    sessionDate: session.sessionDate,
    pickupTime: session.pickupTime,
    deadline: session.deadline,
    pickupLocation: session.pickupLocation,
    status: session.status,
    note: session.note,
    totalOrders: customerOrders.length,
    totalAmount,
    totalItems,
    itemAggregates,
    customerOrders,
  };
}

export function mockGetVendorOrders(vendorId: string): PreOrderData[] {
  return [...mockPreOrders]
    .filter(o => o.vendorId === vendorId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(o => ({ ...o, vendorName: o.groupName || "會員" })); // 沿用來源專案的欄位重用方式：這裡的 vendorName 實際顯示的是顧客/團名
}

export function mockGetVendorTableOrders(vendorId: string): TableOrderData[] {
  return [...mockTableOrders].filter(o => o.vendorId === vendorId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function mockCreateTableOrder(vendorId: string, input: {
  tableName: string; customerName: string; customerPhone: string; note: string;
  items: { id: string; name: string; price: number; quantity: number }[];
}): string {
  const totalAmount = input.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const order: TableOrderData = {
    id: "table-" + Math.random().toString(36).slice(2, 9),
    vendorId,
    tableName: input.tableName,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    totalAmount,
    status: "pending",
    paymentMethod: "cash",
    paymentStatus: "unpaid",
    note: input.note,
    items: input.items.map((i, idx) => ({ id: `toi-${idx}-${i.id}`, menuItemId: i.id, menuItemName: i.name, quantity: i.quantity, unitPrice: i.price, note: "" })),
    createdAt: new Date(),
  };
  mockTableOrders.push(order);
  return order.id;
}

export function mockUpdateOrderStatus(orderId: string, status: string, className: "PreOrder" | "TableOrder") {
  if (className === "PreOrder") {
    const order = mockPreOrders.find(o => o.id === orderId);
    if (order) order.status = status as PreOrderData["status"];
  } else {
    const order = mockTableOrders.find(o => o.id === orderId);
    if (order) order.status = status as TableOrderData["status"];
  }
}

export function mockConfirmDeposit(orderId: string) {
  const order = mockPreOrders.find(o => o.id === orderId);
  if (order) order.depositStatus = "confirmed";
}

export async function mockMarkNoPickup(_orderId: string): Promise<{ orderBanned: boolean }> {
  // TODO(firebase): source tracks a per-user noPickupCount and auto-bans after
  // repeated no-shows — the mock always reports "not banned".
  return { orderBanned: false };
}

export function mockCompletePreOrder(orderId: string) {
  const order = mockPreOrders.find(o => o.id === orderId);
  if (order) {
    order.status = "completed";
    order.paymentStatus = "paid";
  }
}

export interface MockAccuracyReport {
  accuracy_rate: number;
  error_range: string;
  explanation: string;
  pattern_note: string;
  disclaimer: string;
}

export const mockAccuracyReport: MockAccuracyReport = {
  accuracy_rate: 0.86,
  error_range: "±8 份",
  explanation: "近 14 天的實際取餐量與預估量差距落在可接受範圍內。",
  pattern_note: "週五午餐時段常低估約 10%，可考慮提高備料量。",
  disclaimer: "本報告由 AI 產生，僅供參考，實際備料仍請以店家判斷為準。",
};

// ── 首頁「計畫方案」模板用的假資料（訂閱式計畫餐 + 轉讓市集） ──────────────
export interface MealPlanTransfer {
  id: string;
  sellerName: string;
  planName: string;
  daysLeftLabel: string;
  originalPrice: number;
  resalePrice: number;
  location: string;
}

export const mockMealPlanTransfers: MealPlanTransfer[] = [
  { id: "t1", sellerName: "王同學", planName: "健康輕食週計畫（剩5天）", daysLeftLabel: "1天後截止", originalPrice: 600, resalePrice: 450, location: "台中公益店" },
  { id: "t2", sellerName: "陳同學", planName: "健康特惠週省計畫", daysLeftLabel: "1天後截止", originalPrice: 600, resalePrice: 450, location: "台中公益店" },
  { id: "t3", sellerName: "林同學", planName: "增肌蛋白餐計畫（剩3天）", daysLeftLabel: "2天後截止", originalPrice: 700, resalePrice: 520, location: "嘉義東區店" },
  { id: "t4", sellerName: "黃同學", planName: "低卡輕食計畫（剩6天）", daysLeftLabel: "3天後截止", originalPrice: 650, resalePrice: 480, location: "嘉義西區店" },
];

export interface MealPlanOption {
  id: string;
  label: string; // "A方案" / "B方案"
  name: string;
  description: string;
  pricePerMeal: number;
  rating: number;
  fastestBooking: string;
}

export interface VendorMealPlanGroup {
  vendorId: string;
  vendorName: string;
  vendorImage?: string;
  plans: MealPlanOption[];
}

export const mockVendorMealPlans: VendorMealPlanGroup[] = [
  {
    vendorId: "vendor-1",
    vendorName: "一頭牛日式燒肉",
    plans: [
      { id: "p1", label: "A方案", name: "減脂健身餐 (5天)", description: "每日午餐、附贈無糖茶", pricePerMeal: 150, rating: 4.8, fastestBooking: "下週一" },
      { id: "p2", label: "B方案", name: "增肌蛋白餐 (7天)", description: "每日午餐、附贈蛋白餐食蛋白飯", pricePerMeal: 150, rating: 4.7, fastestBooking: "下週一" },
    ],
  },
  {
    vendorId: "vendor-2",
    vendorName: "王媽媽便當",
    plans: [
      { id: "p3", label: "A方案", name: "家常均衡餐 (5天)", description: "每日午餐、附贈溫豆漿", pricePerMeal: 140, rating: 4.6, fastestBooking: "下週二" },
      { id: "p4", label: "B方案", name: "高蛋白便當餐 (7天)", description: "每日午餐、附贈黑豆漿", pricePerMeal: 160, rating: 4.5, fastestBooking: "下週二" },
    ],
  },
  {
    vendorId: "vendor-3",
    vendorName: "阿嘉炸雞排",
    plans: [
      { id: "p5", label: "A方案", name: "酥脆雞排餐 (5天)", description: "每日午餐、附贈紅茶", pricePerMeal: 130, rating: 4.4, fastestBooking: "下週三" },
      { id: "p6", label: "B方案", name: "雙拼炸物餐 (7天)", description: "每日午餐、附贈綠茶", pricePerMeal: 155, rating: 4.3, fastestBooking: "下週三" },
    ],
  },
];


// ── 商家後台「成長獎勵」用的假資料（VendorDashboard.dc.html 草圖新增的分頁） ──
// 全新機制：商家累積合作營收達門檻，解鎖消費者端抽獎（單抽／十連抽），獎項是
// 折扣券（8/6/5/3/1折或整份 0 元），對應 Main 草圖新增的跑馬燈「剛抽中...0 元
// 大獎」。目前完全沒有資料模型與後端邏輯，這裡先用假資料把畫面撐出來。
// TODO(firebase): 需要新設計 growth_rewards（門檻/累積營收）與 draws（開獎紀錄）
// collection，抽獎邏輯建議走 Cloud Function（client 不可信任機率計算）。
export interface GrowthMilestone {
  id: string;
  label: string;
  threshold: number;
  achieved: boolean;
}

export interface DrawRecord {
  id: string;
  date: string;
  consumer: string;
  tierPercentOff: number; // 80/60/50/30/10；0 代表整份免費
  tierLabel: string;
  item: string;
}

export interface MockGrowthRewards {
  cumulativeRevenue: number;
  milestones: GrowthMilestone[];
  voucherRemaining: number;
  voucherTotal: number;
  drawHistory: DrawRecord[];
}

const TIER_LABEL: Record<number, string> = { 80: "8折", 60: "6折", 50: "5折", 30: "3折", 10: "1折", 0: "0元整份" };

export const mockGrowthRewards: MockGrowthRewards = {
  cumulativeRevenue: 186400,
  milestones: [
    { id: "tier1", label: "20 萬門檻・單抽", threshold: 200000, achieved: true },
    { id: "tier2", label: "100 萬門檻・十連抽", threshold: 1000000, achieved: false },
  ],
  voucherRemaining: 3,
  voucherTotal: 10,
  drawHistory: [
    { id: "d1", date: "09/24", consumer: "林＊同學", tierPercentOff: 60, tierLabel: TIER_LABEL[60], item: "舒肥雞胸溫沙拉餐盒" },
    { id: "d2", date: "09/22", consumer: "陳＊同學", tierPercentOff: 0, tierLabel: TIER_LABEL[0], item: "一頭牛日式燒肉丼 A方案（整份）" },
    { id: "d3", date: "09/20", consumer: "黃＊同學", tierPercentOff: 80, tierLabel: TIER_LABEL[80], item: "舒肥雞胸溫沙拉餐盒" },
    { id: "d4", date: "09/18", consumer: "周＊同學", tierPercentOff: 10, tierLabel: TIER_LABEL[10], item: "舒肥雞胸溫沙拉餐盒" },
    { id: "d5", date: "09/16", consumer: "王＊同學", tierPercentOff: 50, tierLabel: TIER_LABEL[50], item: "舒肥雞胸溫沙拉餐盒" },
  ],
};

// ── 首頁「今日推薦鎖定方案」用的假資料（UI草圖 Main.dc.html 新增的單點型卡片區） ──
// TODO(firebase): 這組卡片目前純前端示意（勾選消保法同意欄位才能按「立即預付
// 鎖定」），沒有寫入 Firestore。真正端到端接 locks collection 的單一品項示範在
// pages/ConsumerLockPage.tsx（掛在 /lock，demo 影片用），之後要把這裡串成真的，
// 可以照那個檔案的 handleLock() 模式擴充成多品項版本。
export interface LockMealOption {
  id: string;
  title: string;
  time: string;
  original: number;
  price: number;
  photoFrom: string;
  photoTo: string;
}

export const mockLockMeals: LockMealOption[] = [
  { id: "lm1", title: "舒肥雞胸溫沙拉餐盒", time: "12:00–12:30", original: 150, price: 120, photoFrom: "from-emerald-100", photoTo: "to-green-100" },
  { id: "lm2", title: "塔香牛肉藜麥碗", time: "11:30–12:00", original: 160, price: 128, photoFrom: "from-orange-100", photoTo: "to-amber-100" },
  { id: "lm3", title: "地中海鮪魚酪梨碗", time: "12:30–13:00", original: 145, price: 116, photoFrom: "from-yellow-100", photoTo: "to-lime-100" },
];
