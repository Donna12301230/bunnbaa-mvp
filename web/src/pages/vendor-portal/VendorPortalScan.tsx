import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { mockGetMyVendor, mockFindPreOrderByCode, mockCompletePreOrder } from "@/lib/mockData";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Search, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { STATUS_MAP } from "@/lib/statusMap";

interface FoundOrder {
  orderId: string;
  customerName: string;
  department: string;
  pickupDate: Date;
  pickupLocation: string;
  items: { name: string; quantity: number; unitPrice: number }[];
  finalAmount: number;
  status: string;
  paymentStatus: string;
}

// Ported from BunnBaa Parse_Ref's client/src/pages/vendor/scan.tsx.
// TODO(firebase): mockFindPreOrderByCode/mockCompletePreOrder stand in for
// Parse.Query("PreOrder")/PreOrderItem lookups and Parse.Object.save() —
// swap for Firestore once the backend is wired up.
export default function VendorPortalScan() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [code, setCode] = useState("");
  const [foundOrder, setFoundOrder] = useState<FoundOrder | null>(null);
  const [searchError, setSearchError] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const { data: myVendor } = useQuery({
    queryKey: ["myVendor", user?.id],
    queryFn: async () => mockGetMyVendor(),
    enabled: !!user,
  });

  async function handleSearch() {
    const input = code.trim().toUpperCase();
    if (!input || !myVendor) return;

    setSearchError("");
    setFoundOrder(null);
    setIsSearching(true);

    try {
      const match = mockFindPreOrderByCode(input, myVendor.id);

      if (!match) {
        setSearchError("找不到符合的訂單，請確認取餐編號是否正確。");
        return;
      }

      setFoundOrder({
        orderId: match.id,
        customerName: "王小明", // TODO(firebase): source customer displayName from users/{uid}
        department: "",
        pickupDate: match.pickupDate,
        pickupLocation: match.pickupLocation,
        items: match.items.map(i => ({ name: i.menuItemName, quantity: i.quantity, unitPrice: i.unitPrice })),
        finalAmount: match.finalAmount,
        status: match.status,
        paymentStatus: match.paymentStatus,
      });
    } catch {
      setSearchError("查詢失敗，請重試。");
    } finally {
      setIsSearching(false);
    }
  }

  const completeMutation = useMutation({
    mutationFn: async (orderId: string) => mockCompletePreOrder(orderId),
    onSuccess: () => {
      toast({ title: "取餐完成！", description: "訂單已標記為完成並付款。" });
      setFoundOrder(prev => prev ? { ...prev, status: "completed", paymentStatus: "paid" } : null);
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "操作失敗", description: err.message }),
  });

  function reset() {
    setCode("");
    setFoundOrder(null);
    setSearchError("");
  }

  const alreadyCompleted = foundOrder?.status === "completed";

  return (
    <VendorPortalLayout>
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <Search className="w-5 h-5 text-orange-500" /> 核對取餐
      </h2>

      {/* 查詢區 */}
      <Card className="mb-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">輸入顧客取餐編號</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="取餐編號（如：AB3F9K2M）"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === "Enter") handleSearch(); }}
              className="font-mono tracking-widest"
              maxLength={10}
            />
            <Button
              className="shrink-0"
              onClick={handleSearch}
              disabled={!code.trim() || isSearching || !myVendor}
            >
              {isSearching ? "查詢中..." : "查詢"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">取餐編號顯示於顧客訂單確認頁（8 碼英數）</p>

          {searchError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{searchError}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 查詢結果 */}
      {foundOrder && (
        <Card>
          <CardHeader className="pb-2 flex flex-row items-start justify-between">
            <div>
              <CardTitle className="text-base">訂單資訊</CardTitle>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                #{foundOrder.orderId.slice(-8).toUpperCase()}
              </p>
            </div>
            <Badge className={`text-xs border ${STATUS_MAP[foundOrder.status]?.color ?? ""}`}>
              {STATUS_MAP[foundOrder.status]?.label ?? foundOrder.status}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {/* 顧客資訊 */}
            <div className="rounded-lg bg-muted p-3 space-y-1">
              <div className="font-semibold text-base">{foundOrder.customerName}</div>
              {foundOrder.department && (
                <div className="text-xs text-muted-foreground">{foundOrder.department}</div>
              )}
              <div className="text-xs text-muted-foreground">
                取餐：{format(foundOrder.pickupDate, "M/d (EEE)", { locale: zhTW })}
                · {foundOrder.pickupLocation}
              </div>
            </div>

            {/* 品項 */}
            <div className="space-y-1">
              {foundOrder.items.map((item, idx) => (
                <div key={idx} className="flex justify-between text-muted-foreground">
                  <span>{item.name}</span>
                  <span>× {item.quantity}　NT$ {item.unitPrice * item.quantity}</span>
                </div>
              ))}
            </div>

            <Separator />

            <div className="flex justify-between font-bold">
              <span>應付金額</span>
              <span className="text-orange-600">NT$ {foundOrder.finalAmount}</span>
            </div>

            {/* 操作按鈕 */}
            {alreadyCompleted ? (
              <div className="space-y-2">
                <div className="flex items-center justify-center gap-2 py-3 rounded-lg bg-green-50 text-green-700 font-medium">
                  <CheckCircle2 className="w-5 h-5" /> 已完成取餐
                </div>
                <Button variant="outline" className="w-full" onClick={reset}>
                  查詢下一筆
                </Button>
              </div>
            ) : (
              <div className="space-y-2 pt-1">
                {foundOrder.status === "cancelled" ? (
                  <div className="flex items-center gap-2 rounded-lg bg-red-50 text-red-700 p-3 text-sm">
                    <AlertCircle className="w-4 h-4 shrink-0" /> 此訂單已取消，無法取餐
                  </div>
                ) : (
                  <Button
                    className="w-full bg-green-500 hover:bg-green-600 text-white"
                    disabled={completeMutation.isPending}
                    onClick={() => completeMutation.mutate(foundOrder.orderId)}
                  >
                    <CheckCircle2 className="w-4 h-4 mr-1.5" />
                    {completeMutation.isPending ? "處理中..." : "確認取餐 & 收款"}
                  </Button>
                )}
                <Button variant="outline" className="w-full" onClick={reset}>
                  重新查詢
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </VendorPortalLayout>
  );
}
