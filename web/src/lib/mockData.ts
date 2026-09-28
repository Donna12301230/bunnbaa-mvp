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

export function mockUpdatePreOrderStatus(orderId: string, status: PreOrderData["status"]) {
  const order = mockPreOrders.find(o => o.id === orderId);
  if (order) {
    order.status = status;
    if (status === "completed") order.paymentStatus = "paid";
  }
}

interface MockSessionSummary {
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
