import { useQuery, useMutation } from "@tanstack/react-query";
import { mockVendors, mockApproveVendor } from "@/lib/mockData";
import AdminLayout from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Store } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";

// Ported from BunnBaa Parse_Ref's client/src/pages/admin/vendors.tsx (廠商管理 tab).
// TODO(firebase): reads mockVendors instead of Parse.Query("Vendor") and calls
// mockApproveVendor instead of Parse.Cloud.run("approveVendor") — swap for
// Firestore + Cloud Functions once the backend is wired up.
export default function AdminVendorsPage() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ["adminVendors"],
    queryFn: async () => [...mockVendors].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    enabled: isAdmin,
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, approved }: { id: string; approved: boolean }) => mockApproveVendor(id, approved),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["adminVendors"] });
      toast({ title: vars.approved ? "已核准" : "已停用" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "操作失敗", description: err.message }),
  });

  return (
    <AdminLayout>
      <h2 className="text-lg font-bold mb-3">所有廠商申請 ({vendors.length})</h2>
      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : vendors.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Store className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>目前無廠商資料</p>
        </div>
      ) : (
        <div className="space-y-3">
          {vendors.map(vendor => (
            <Card key={vendor.id}>
              <CardHeader className="pb-1 flex flex-row items-start justify-between">
                <div>
                  <CardTitle className="text-base">{vendor.name}</CardTitle>
                  <div className="text-xs text-muted-foreground">{vendor.address} · {vendor.phone}</div>
                </div>
                <div className="flex items-center gap-2">
                  {vendor.isApproved
                    ? <Badge className="bg-green-100 text-green-800 border-0">已核准</Badge>
                    : <Badge className="bg-yellow-100 text-yellow-800 border-0">待審核</Badge>
                  }
                </div>
              </CardHeader>
              <CardContent className="text-sm flex items-center justify-between">
                <span className="text-muted-foreground line-clamp-1">{vendor.description}</span>
                <div className="flex gap-2 flex-shrink-0 ml-3">
                  {!vendor.isApproved ? (
                    <Button size="sm" className="h-7 text-xs bg-green-500 hover:bg-green-600 text-white"
                      onClick={() => approveMutation.mutate({ id: vendor.id, approved: true })}>
                      <CheckCircle className="w-3.5 h-3.5 mr-1" /> 核准
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="h-7 text-xs text-red-500"
                      onClick={() => approveMutation.mutate({ id: vendor.id, approved: false })}>
                      <XCircle className="w-3.5 h-3.5 mr-1" /> 停用
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </AdminLayout>
  );
}
