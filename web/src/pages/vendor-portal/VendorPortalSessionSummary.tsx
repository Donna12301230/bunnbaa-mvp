import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { mockGetSessionSummary, mockUpdatePreOrderStatus } from "@/lib/mockData";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft, CalendarDays, Clock, MapPin, Users,
  ShoppingBag, Banknote, CheckCircle2, Circle,
} from "lucide-react";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { STATUS_MAP } from "@/lib/statusMap";

// Ported from BunnBaa Parse_Ref's client/src/pages/vendor/session-summary.tsx.
// TODO(firebase): mockGetSessionSummary/mockUpdatePreOrderStatus stand in for
// the Parse.Query("OrderSession")/PreOrder/PreOrderItem aggregation and
// Parse.Object.save() — swap for Firestore once the backend is wired up.
export default function VendorPortalSessionSummary() {
  const params = useParams<{ sessionId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const sessionId = params.sessionId;
  const [, setDeliveredIds] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useQuery({
    queryKey: ["sessionSummary", sessionId],
    queryFn: async () => {
      const result = await mockGetSessionSummary(sessionId);
      if (!result) throw new Error("找不到此時段資料");
      return result;
    },
    enabled: !!sessionId,
    retry: false,
  });

  const updateOrderMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: "confirmed" | "completed" }) => mockUpdatePreOrderStatus(orderId, status),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["sessionSummary", sessionId] });
      if (vars.status === "completed") {
        setDeliveredIds(prev => new Set(Array.from(prev).concat(vars.orderId)));
        toast({ title: "已標記取餐完成" });
      } else {
        toast({ title: "狀態已更新" });
      }
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "更新失敗", description: err.message }),
  });

  if (isLoading) {
    return (
      <VendorPortalLayout>
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      </VendorPortalLayout>
    );
  }

  if (error || !data) {
    return (
      <VendorPortalLayout>
        <div className="text-center py-16 text-muted-foreground">
          <p>找不到此時段資料。</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/vendor-portal/sessions")}>
            返回時段管理
          </Button>
        </div>
      </VendorPortalLayout>
    );
  }

  const completedCount = data.customerOrders.filter(o => o.status === "completed").length;
  const confirmedOrCompleted = data.customerOrders.filter(o => ["confirmed", "completed"].includes(o.status));

  return (
    <VendorPortalLayout>
      <Button variant="ghost" size="sm" className="-ml-1 mb-3" onClick={() => navigate("/vendor-portal/sessions")}>
        <ArrowLeft className="w-4 h-4 mr-1" /> 返回時段管理
      </Button>

      {/* 時段資訊標頭 */}
      <div className="mb-5">
        <h2 className="text-xl font-bold mb-1">統整訂購單</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarDays className="w-3.5 h-3.5" />
            {format(data.sessionDate, "yyyy/MM/dd (EEE)", { locale: zhTW })}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> 取餐 {data.pickupTime}
          </span>
          <span className="flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" /> {data.pickupLocation}
          </span>
        </div>
        {data.note && <p className="text-xs italic text-muted-foreground mt-1">備註：{data.note}</p>}
      </div>

      {/* 統計卡片 */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <Card>
          <CardContent className="pt-3 pb-3 text-center">
            <Users className="w-4 h-4 mx-auto mb-1 text-orange-500" />
            <div className="text-2xl font-bold">{data.totalOrders}</div>
            <div className="text-xs text-muted-foreground">訂單數</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3 text-center">
            <ShoppingBag className="w-4 h-4 mx-auto mb-1 text-orange-500" />
            <div className="text-2xl font-bold">{data.totalItems}</div>
            <div className="text-xs text-muted-foreground">品項數量</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-3 text-center">
            <Banknote className="w-4 h-4 mx-auto mb-1 text-orange-500" />
            <div className="text-2xl font-bold text-orange-600">{data.totalAmount}</div>
            <div className="text-xs text-muted-foreground">應收總額</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="items">
        <TabsList className="mb-4">
          <TabsTrigger value="items">菜色彙總</TabsTrigger>
          <TabsTrigger value="customers">顧客清單 ({data.totalOrders})</TabsTrigger>
          <TabsTrigger value="delivery">
            發餐清單
            {completedCount > 0 && (
              <span className="ml-1.5 text-xs bg-green-500 text-white rounded-full px-1.5">
                {completedCount}/{data.totalOrders}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* 菜色彙總 Tab */}
        <TabsContent value="items">
          {data.itemAggregates.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">尚無訂單</p>
          ) : (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">各品項訂購數量</CardTitle>
              </CardHeader>
              <CardContent className="space-y-0 divide-y divide-border">
                {data.itemAggregates.map(item => (
                  <div key={item.name} className="flex items-center justify-between py-2.5">
                    <div>
                      <div className="font-medium text-sm">{item.name}</div>
                      <div className="text-xs text-muted-foreground">NT$ {item.unitPrice} / 份</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-lg text-orange-600">× {item.quantity}</div>
                      <div className="text-xs text-muted-foreground">NT$ {item.unitPrice * item.quantity}</div>
                    </div>
                  </div>
                ))}
                <div className="flex justify-between pt-3 font-semibold text-sm">
                  <span>合計</span>
                  <span className="text-orange-600">NT$ {data.totalAmount}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* 顧客清單 Tab */}
        <TabsContent value="customers">
          {data.customerOrders.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">尚無訂單</p>
          ) : (
            <div className="space-y-3">
              {data.customerOrders.map(order => {
                const st = STATUS_MAP[order.status] ?? STATUS_MAP.pending;
                return (
                  <Card key={order.orderId}>
                    <CardHeader className="pb-2 flex flex-row items-start justify-between">
                      <div>
                        <div className="font-semibold text-sm">{order.customerName}</div>
                        {order.department && (
                          <div className="text-xs text-muted-foreground">{order.department}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>
                          {st.label}
                        </span>
                        {order.status === "pending" && (
                          <Button
                            size="sm"
                            className="h-6 text-xs bg-blue-500 hover:bg-blue-600 text-white px-2"
                            onClick={() => updateOrderMutation.mutate({ orderId: order.orderId, status: "confirmed" })}
                          >
                            確認
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="text-sm space-y-1">
                      {order.items.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-muted-foreground">
                          <span>{item.name}{item.note ? <span className="text-xs ml-1">({item.note})</span> : ""}</span>
                          <span>× {item.quantity}　NT$ {item.unitPrice * item.quantity}</span>
                        </div>
                      ))}
                      <Separator className="my-1" />
                      <div className="flex justify-between font-semibold">
                        <span>應付</span>
                        <span className="text-orange-600">NT$ {order.finalAmount}</span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* 發餐清單 Tab */}
        <TabsContent value="delivery">
          <p className="text-xs text-muted-foreground mb-3">
            點擊「已取餐」標記顧客已領取便當並完成付款。
          </p>
          {confirmedOrCompleted.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">沒有已確認的訂單可發餐</p>
          ) : (
            <div className="space-y-2">
              {confirmedOrCompleted.map(order => {
                const isDone = order.status === "completed";
                return (
                  <div
                    key={order.orderId}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${
                      isDone ? "bg-green-50 border-green-200" : "bg-white border-border"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      {isDone
                        ? <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                        : <Circle className="w-5 h-5 text-gray-300 shrink-0" />
                      }
                      <div>
                        <div className={`font-medium text-sm ${isDone ? "line-through text-muted-foreground" : ""}`}>
                          {order.customerName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {order.items.map(i => `${i.name}×${i.quantity}`).join("、")}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-semibold text-orange-600">NT$ {order.finalAmount}</span>
                      {!isDone && (
                        <Button
                          size="sm"
                          className="h-7 text-xs bg-green-500 hover:bg-green-600 text-white"
                          disabled={updateOrderMutation.isPending}
                          onClick={() => updateOrderMutation.mutate({ orderId: order.orderId, status: "completed" })}
                        >
                          已取餐
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}

              {confirmedOrCompleted.length > 0 && (
                <div className="pt-2 text-right text-sm text-muted-foreground">
                  已完成 {completedCount} / {confirmedOrCompleted.length} 筆
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </VendorPortalLayout>
  );
}
