import { useQuery, useMutation } from "@tanstack/react-query";
import { mockVendors, mockBanAppeals, mockApproveVendor, mockProcessBanAppeal } from "@/lib/mockData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, XCircle, Store, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";

// Ported from BunnBaa Parse_Ref's client/src/pages/admin/vendors.tsx.
// TODO(firebase): both queries below read mockData instead of
// Parse.Query("Vendor")/Parse.Query("BanAppeal"), and both mutations call
// mockApproveVendor/mockProcessBanAppeal instead of
// Parse.Cloud.run("approveVendor"/"processBanAppeal") — swap for real
// Firestore reads + Cloud Functions once the backend is wired up.
export default function AdminVendorsPage() {
  const { toast } = useToast();
  const { isAdmin, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();

  if (!authLoading && !isAdmin) {
    navigate("/home");
    return null;
  }

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ["adminVendors"],
    queryFn: async () => [...mockVendors].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    enabled: isAdmin,
  });

  const { data: appeals = [], isLoading: appealsLoading } = useQuery({
    queryKey: ["adminAppeals"],
    queryFn: async () => [...mockBanAppeals].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
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

  const processAppealMutation = useMutation({
    mutationFn: async ({ appealId, approved }: { appealId: string; approved: boolean }) => mockProcessBanAppeal(appealId, approved),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["adminAppeals"] });
      toast({ title: vars.approved ? "已核准解封" : "已拒絕申訴" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "操作失敗", description: err.message }),
  });

  const pendingAppeals = appeals.filter(a => a.status === "pending");

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-primary text-primary-foreground px-4 h-12 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Store className="w-5 h-5" />
          <span className="font-semibold">管理後台</span>
        </div>
        <Link href="/home" className="text-sm opacity-80 hover:opacity-100">回首頁</Link>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        <Tabs defaultValue="vendors">
          <TabsList className="mb-4">
            <TabsTrigger value="vendors">廠商管理 ({vendors.length})</TabsTrigger>
            <TabsTrigger value="appeals" className="relative">
              解封申訴
              {pendingAppeals.length > 0 && (
                <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                  {pendingAppeals.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* 廠商管理 Tab */}
          <TabsContent value="vendors">
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
          </TabsContent>

          {/* 解封申訴 Tab */}
          <TabsContent value="appeals">
            <h2 className="text-lg font-bold mb-3">解封申訴管理</h2>
            {appealsLoading ? (
              <div className="space-y-3">
                {[1,2].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
              </div>
            ) : appeals.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <ShieldAlert className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>目前無申訴案件</p>
              </div>
            ) : (
              <div className="space-y-3">
                {appeals.map(appeal => (
                  <Card key={appeal.id} className={appeal.status === "pending" ? "border-orange-200" : ""}>
                    <CardHeader className="pb-1 flex flex-row items-start justify-between">
                      <div>
                        <CardTitle className="text-base text-sm">
                          {appeal.displayName || appeal.username}
                          <span className="text-xs text-muted-foreground font-normal ml-2">@{appeal.username}</span>
                        </CardTitle>
                        <div className="text-xs text-muted-foreground">
                          申訴時間：{format(appeal.createdAt, "yyyy/MM/dd HH:mm")}
                        </div>
                      </div>
                      <Badge className={
                        appeal.status === "pending" ? "bg-orange-100 text-orange-800 border-0" :
                        appeal.status === "approved" ? "bg-green-100 text-green-800 border-0" :
                        "bg-gray-100 text-gray-600 border-0"
                      }>
                        {appeal.status === "pending" ? "待審核" : appeal.status === "approved" ? "已核准" : "已拒絕"}
                      </Badge>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="text-sm bg-gray-50 rounded p-2">
                        <span className="text-xs text-muted-foreground block mb-1">申訴原因：</span>
                        {appeal.reason}
                      </div>
                      {appeal.adminNote && (
                        <div className="text-xs text-muted-foreground">管理員備註：{appeal.adminNote}</div>
                      )}
                      {appeal.status === "pending" && (
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            className="h-7 text-xs bg-green-500 hover:bg-green-600 text-white"
                            disabled={processAppealMutation.isPending}
                            onClick={() => processAppealMutation.mutate({ appealId: appeal.id, approved: true })}
                          >
                            <CheckCircle className="w-3.5 h-3.5 mr-1" /> 核准解封
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-red-500"
                            disabled={processAppealMutation.isPending}
                            onClick={() => processAppealMutation.mutate({ appealId: appeal.id, approved: false })}
                          >
                            <XCircle className="w-3.5 h-3.5 mr-1" /> 拒絕
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
