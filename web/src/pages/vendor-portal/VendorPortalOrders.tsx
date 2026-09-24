import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  mockGetMyVendor, mockMenuItems, mockGetVendorOrders, mockGetVendorTableOrders,
  mockCreateTableOrder, mockUpdateOrderStatus, mockConfirmDeposit, mockMarkNoPickup,
} from "@/lib/mockData";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { CalendarDays, MapPin, Users, ClipboardList, TableProperties, RefreshCw, QrCode, Plus, Minus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import type { PreOrderData, TableOrderData } from "@/types";

import { STATUS_MAP } from "@/lib/statusMap";

// Ported from BunnBaa Parse_Ref's client/src/pages/vendor/orders.tsx.
// TODO(firebase): reads/writes mockData.ts's mockPreOrders/mockTableOrders
// instead of Parse.Query("PreOrder"/"TableOrder") and
// Parse.Cloud.run("updateOrderStatus"/"confirmDeposit"/"markNoPickup") —
// swap for Firestore + Cloud Functions once the backend is wired up.
export default function VendorPortalOrders() {
  const { user } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();

  // 新增現場訂單表單狀態
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tableName, setTableName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [selectedItems, setSelectedItems] = useState<Record<string, number>>({}); // menuItemId -> qty

  const { data: myVendor } = useQuery({
    queryKey: ["myVendor", user?.id],
    queryFn: async () => mockGetMyVendor(),
    enabled: !!user,
  });

  // 廠商菜單（供現場訂單選品）
  const { data: menuItems = [] } = useQuery({
    queryKey: ["vendorMenuItems", myVendor?.id],
    queryFn: async () => {
      if (!myVendor) return [];
      return mockMenuItems.filter(i => i.vendorId === myVendor.id && i.isAvailable).sort((a, b) => a.category.localeCompare(b.category));
    },
    enabled: !!myVendor,
  });

  // 新增現場訂單
  const createTableOrderMutation = useMutation({
    mutationFn: async () => {
      if (!myVendor) throw new Error("找不到廠商資料");
      if (!tableName.trim()) throw new Error("請填寫桌號");
      if (!customerName.trim()) throw new Error("請填寫顧客姓名");
      const itemEntries = Object.entries(selectedItems).filter(([, qty]) => qty > 0);
      if (itemEntries.length === 0) throw new Error("請至少選擇一個品項");

      const items = itemEntries.map(([id, qty]) => {
        const item = menuItems.find(m => m.id === id)!;
        return { id, name: item.name, price: item.price, quantity: qty };
      });

      return mockCreateTableOrder(myVendor.id, {
        tableName: tableName.trim(),
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        note: orderNote.trim(),
        items,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendorTableOrders", myVendor?.id] });
      toast({ title: "現場訂單已建立" });
      // 清空表單
      setTableName(""); setCustomerName(""); setCustomerPhone("");
      setOrderNote(""); setSelectedItems({});
      setSheetOpen(false);
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "建立失敗", description: err.message }),
  });

  function adjustQty(id: string, delta: number) {
    setSelectedItems(prev => {
      const cur = prev[id] ?? 0;
      const next = Math.max(0, cur + delta);
      if (next === 0) {
        const { [id]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: next };
    });
  }

  const tableOrderTotal = Object.entries(selectedItems).reduce((sum, [id, qty]) => {
    const item = menuItems.find(m => m.id === id);
    return sum + (item?.price ?? 0) * qty;
  }, 0);

  // PreOrders
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["vendorOrders", myVendor?.id],
    queryFn: async () => {
      if (!myVendor) return [];
      return mockGetVendorOrders(myVendor.id);
    },
    enabled: !!myVendor,
    staleTime: 2 * 60 * 1000,
  });

  // TableOrders (現場訂單)
  const { data: tableOrders = [], isLoading: loadingTable, refetch: refetchTable } = useQuery({
    queryKey: ["vendorTableOrders", myVendor?.id],
    queryFn: async () => {
      if (!myVendor) return [];
      return mockGetVendorTableOrders(myVendor.id);
    },
    enabled: !!myVendor,
    refetchInterval: 3 * 60 * 1000, // 3 分鐘輪詢（原 30 秒）
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ orderId, status, className }: { orderId: string; status: string; className: "PreOrder" | "TableOrder" }) =>
      mockUpdateOrderStatus(orderId, status, className),
    onSuccess: (_, vars) => {
      if (vars.className === "PreOrder") {
        queryClient.invalidateQueries({ queryKey: ["vendorOrders", myVendor?.id] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["vendorTableOrders", myVendor?.id] });
      }
      toast({ title: "訂單狀態已更新" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "更新失敗", description: err.message }),
  });

  const confirmDepositMutation = useMutation({
    mutationFn: async (orderId: string) => mockConfirmDeposit(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendorOrders", myVendor?.id] });
      toast({ title: "訂金已確認收到" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "操作失敗", description: err.message }),
  });

  const markNoPickupMutation = useMutation({
    mutationFn: (orderId: string) => mockMarkNoPickup(orderId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["vendorOrders", myVendor?.id] });
      const msg = result.orderBanned
        ? "已標記未取貨，該會員訂餐資格已自動暫停"
        : "已標記未取貨";
      toast({ title: msg });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "操作失敗", description: err.message }),
  });

  const pending = orders.filter(o => o.status === "pending");
  const confirmed = orders.filter(o => o.status === "confirmed");
  const done = orders.filter(o => ["completed", "cancelled"].includes(o.status));

  const tablePending = tableOrders.filter(o => o.status === "pending");
  const tableActive = tableOrders.filter(o => o.status === "confirmed");
  const tableDone = tableOrders.filter(o => ["completed", "cancelled"].includes(o.status));

  function PreOrderCard({ order }: { order: PreOrderData }) {
    const status = STATUS_MAP[order.status] ?? STATUS_MAP.pending;
    const needsDeposit = order.depositRequired && order.depositStatus === "pending";
    const depositConfirmed = order.depositRequired && order.depositStatus === "confirmed";
    return (
      <Card className="mb-3">
        <CardHeader className="pb-2 flex flex-row items-start justify-between">
          <div>
            <div className="font-semibold text-sm">{order.vendorName}</div>
            <div className="text-xs text-muted-foreground">#{order.id.slice(-8).toUpperCase()}</div>
          </div>
          <div className="flex items-center gap-1.5">
            {needsDeposit && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">需訂金</span>
            )}
            {depositConfirmed && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">訂金已收</span>
            )}
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${status.color}`}>{status.label}</span>
          </div>
        </CardHeader>
        <CardContent className="text-sm space-y-1.5">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <CalendarDays className="w-3.5 h-3.5" />
            取餐：{format(order.pickupDate, "yyyy/MM/dd (EEE)", { locale: zhTW })}
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="w-3.5 h-3.5" /> {order.pickupLocation}
          </div>
          {order.orderType === "group" && order.groupName && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Users className="w-3.5 h-3.5" /> {order.groupName}
            </div>
          )}
          <div className="space-y-1.5 pt-1 border-t border-border">
            <div className="flex justify-between items-center">
              <div className="font-bold text-orange-600">NT$ {order.finalAmount}</div>
              <div className="flex gap-1.5 flex-wrap justify-end">
                {order.status === "pending" && (
                  <>
                    <Button size="sm" className="h-7 text-xs bg-blue-500 hover:bg-blue-600 text-white"
                      onClick={() => updateStatusMutation.mutate({ orderId: order.id, status: "confirmed", className: "PreOrder" })}>
                      確認
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs text-red-500"
                      onClick={() => updateStatusMutation.mutate({ orderId: order.id, status: "cancelled", className: "PreOrder" })}>
                      拒絕
                    </Button>
                  </>
                )}
                {order.status === "confirmed" && (
                  <>
                    <Button size="sm" className="h-7 text-xs bg-green-500 hover:bg-green-600 text-white"
                      onClick={() => updateStatusMutation.mutate({ orderId: order.id, status: "completed", className: "PreOrder" })}>
                      完成取餐
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs text-orange-600 border-orange-300"
                      disabled={markNoPickupMutation.isPending}
                      onClick={async () => {
                        if (await confirm({ title: "要標記為「未取貨」嗎？", description: "此操作將累計該會員的未取貨次數。", confirmLabel: "標記未取貨", destructive: true })) {
                          markNoPickupMutation.mutate(order.id);
                        }
                      }}>
                      未取貨
                    </Button>
                  </>
                )}
              </div>
            </div>
            {needsDeposit && (
              <Button size="sm" className="h-7 text-xs w-full bg-amber-500 hover:bg-amber-600 text-white"
                disabled={confirmDepositMutation.isPending}
                onClick={() => confirmDepositMutation.mutate(order.id)}>
                確認訂金已收到
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  function TableOrderCard({ order }: { order: TableOrderData }) {
    const status = STATUS_MAP[order.status] ?? STATUS_MAP.pending;
    return (
      <Card className="mb-3">
        <CardHeader className="pb-2 flex flex-row items-start justify-between">
          <div>
            <div className="flex items-center gap-1.5 font-semibold text-sm">
              <QrCode className="w-3.5 h-3.5 text-orange-500" />
              桌號：{order.tableName || "未指定"}
            </div>
            <div className="text-xs text-muted-foreground">#{order.id.slice(-8).toUpperCase()}</div>
          </div>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${status.color}`}>{status.label}</span>
        </CardHeader>
        <CardContent className="text-sm space-y-1.5">
          <div className="flex gap-4 text-muted-foreground">
            <span>姓名：<b className="text-foreground">{order.customerName}</b></span>
            <span>電話：<b className="text-foreground">{order.customerPhone}</b></span>
          </div>
          {order.note && (
            <div className="text-muted-foreground">備註：{order.note}</div>
          )}
          <div className="text-xs text-muted-foreground">
            {format(order.createdAt, "MM/dd HH:mm", { locale: zhTW })}
          </div>
          <div className="flex justify-between items-center pt-1 border-t border-border">
            <div className="font-bold text-orange-600">NT$ {order.totalAmount}</div>
            <div className="flex gap-1.5">
              {order.status === "pending" && (
                <>
                  <Button size="sm" className="h-7 text-xs bg-blue-500 hover:bg-blue-600 text-white"
                    onClick={() => updateStatusMutation.mutate({ orderId: order.id, status: "confirmed", className: "TableOrder" })}>
                    確認
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs text-red-500"
                    onClick={() => updateStatusMutation.mutate({ orderId: order.id, status: "cancelled", className: "TableOrder" })}>
                    取消
                  </Button>
                </>
              )}
              {order.status === "confirmed" && (
                <Button size="sm" className="h-7 text-xs bg-green-500 hover:bg-green-600 text-white"
                  onClick={() => updateStatusMutation.mutate({ orderId: order.id, status: "completed", className: "TableOrder" })}>
                  完成出餐
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <VendorPortalLayout>
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <ClipboardList className="w-5 h-5 text-orange-500" /> 訂單管理
      </h2>

      <Tabs defaultValue="table">
        <TabsList className="mb-4">
          <TabsTrigger value="table" className="flex items-center gap-1">
            <TableProperties className="w-3.5 h-3.5" />
            現場訂單
            {tablePending.length > 0 && (
              <span className="ml-1 bg-orange-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                {tablePending.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="preorder" className="flex items-center gap-1">
            <ClipboardList className="w-3.5 h-3.5" />
            預約訂購
            {pending.length > 0 && (
              <span className="ml-1 bg-orange-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                {pending.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* 現場訂單 Tab */}
        <TabsContent value="table">
          <div className="flex justify-between items-center mb-3">
            <p className="text-xs text-muted-foreground">每 3 分鐘自動更新</p>
            <div className="flex gap-2">
              <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white" onClick={() => setSheetOpen(true)}>
                <Plus className="w-3.5 h-3.5 mr-1" /> 新增訂單
              </Button>
              <Button size="sm" variant="outline" onClick={() => refetchTable()} disabled={loadingTable}>
                <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loadingTable ? "animate-spin" : ""}`} /> 更新
              </Button>
            </div>
          </div>

          {loadingTable ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-28 bg-gray-100 rounded-xl animate-pulse" />)}
            </div>
          ) : (
            <Tabs defaultValue="t-pending">
              <TabsList className="mb-3">
                <TabsTrigger value="t-pending">待確認 {tablePending.length > 0 && `(${tablePending.length})`}</TabsTrigger>
                <TabsTrigger value="t-confirmed">備餐中 {tableActive.length > 0 && `(${tableActive.length})`}</TabsTrigger>
                <TabsTrigger value="t-done">歷史</TabsTrigger>
              </TabsList>
              <TabsContent value="t-pending">
                {tablePending.length === 0
                  ? <p className="text-center text-muted-foreground py-8">無待確認現場訂單</p>
                  : tablePending.map(o => <TableOrderCard key={o.id} order={o} />)
                }
              </TabsContent>
              <TabsContent value="t-confirmed">
                {tableActive.length === 0
                  ? <p className="text-center text-muted-foreground py-8">無備餐中訂單</p>
                  : tableActive.map(o => <TableOrderCard key={o.id} order={o} />)
                }
              </TabsContent>
              <TabsContent value="t-done">
                {tableDone.length === 0
                  ? <p className="text-center text-muted-foreground py-8">無歷史現場訂單</p>
                  : tableDone.map(o => <TableOrderCard key={o.id} order={o} />)
                }
              </TabsContent>
            </Tabs>
          )}
        </TabsContent>

        {/* 預約訂購 Tab */}
        <TabsContent value="preorder">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-28 bg-gray-100 rounded-xl animate-pulse" />)}
            </div>
          ) : (
            <Tabs defaultValue="pending">
              <TabsList className="mb-4">
                <TabsTrigger value="pending">待確認 {pending.length > 0 && `(${pending.length})`}</TabsTrigger>
                <TabsTrigger value="confirmed">已確認 {confirmed.length > 0 && `(${confirmed.length})`}</TabsTrigger>
                <TabsTrigger value="done">歷史</TabsTrigger>
              </TabsList>
              <TabsContent value="pending">
                {pending.length === 0
                  ? <p className="text-center text-muted-foreground py-8">無待確認訂單</p>
                  : pending.map(o => <PreOrderCard key={o.id} order={o} />)
                }
              </TabsContent>
              <TabsContent value="confirmed">
                {confirmed.length === 0
                  ? <p className="text-center text-muted-foreground py-8">無已確認訂單</p>
                  : confirmed.map(o => <PreOrderCard key={o.id} order={o} />)
                }
              </TabsContent>
              <TabsContent value="done">
                {done.length === 0
                  ? <p className="text-center text-muted-foreground py-8">無歷史訂單</p>
                  : done.map(o => <PreOrderCard key={o.id} order={o} />)
                }
              </TabsContent>
            </Tabs>
          )}
        </TabsContent>
      </Tabs>

      {/* 新增現場訂單 Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>新增現場訂單</SheetTitle>
          </SheetHeader>

          <div className="space-y-4 py-4">
            {/* 基本資料 */}
            <div className="space-y-3">
              <div>
                <Label>桌號 / 識別碼 <span className="text-red-500">*</span></Label>
                <Input
                  className="mt-1"
                  placeholder="如：A1、3號桌、外帶..."
                  value={tableName}
                  onChange={e => setTableName(e.target.value)}
                />
              </div>
              <div>
                <Label>顧客姓名 <span className="text-red-500">*</span></Label>
                <Input
                  className="mt-1"
                  placeholder="顧客姓名"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                />
              </div>
              <div>
                <Label>電話（選填）</Label>
                <Input
                  className="mt-1"
                  placeholder="09xx-xxx-xxx"
                  value={customerPhone}
                  onChange={e => setCustomerPhone(e.target.value)}
                />
              </div>
              <div>
                <Label>備註（選填）</Label>
                <Textarea
                  className="mt-1 resize-none"
                  rows={2}
                  placeholder="特殊需求..."
                  value={orderNote}
                  onChange={e => setOrderNote(e.target.value)}
                />
              </div>
            </div>

            <Separator />

            {/* 菜單選品 */}
            <div>
              <p className="text-sm font-semibold mb-2">選擇品項</p>
              {menuItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">尚無可用菜單，請先到「菜單管理」新增品項。</p>
              ) : (
                <div className="space-y-2">
                  {menuItems.map(item => {
                    const qty = selectedItems[item.id] ?? 0;
                    return (
                      <div key={item.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                        <div className="flex-1 mr-2">
                          <div className="text-sm font-medium">{item.name}</div>
                          <div className="text-xs text-orange-600">NT$ {item.price}</div>
                          {item.category && (
                            <div className="text-xs text-muted-foreground">{item.category}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            variant="outline" size="icon"
                            className="w-7 h-7"
                            disabled={qty === 0}
                            onClick={() => adjustQty(item.id, -1)}
                          >
                            <Minus className="w-3 h-3" />
                          </Button>
                          <span className="w-5 text-center text-sm">{qty}</span>
                          <Button
                            variant="outline" size="icon"
                            className="w-7 h-7"
                            onClick={() => adjustQty(item.id, 1)}
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {tableOrderTotal > 0 && (
              <>
                <Separator />
                <div className="flex justify-between font-bold text-base">
                  <span>合計</span>
                  <span className="text-orange-600">NT$ {tableOrderTotal}</span>
                </div>
              </>
            )}
          </div>

          <SheetFooter className="pt-2 gap-2">
            <Button variant="outline" onClick={() => setSheetOpen(false)}>取消</Button>
            <Button
              className="bg-orange-500 hover:bg-orange-600 text-white"
              disabled={createTableOrderMutation.isPending}
              onClick={() => createTableOrderMutation.mutate()}
            >
              {createTableOrderMutation.isPending ? "建立中..." : "建立訂單"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </VendorPortalLayout>
  );
}
