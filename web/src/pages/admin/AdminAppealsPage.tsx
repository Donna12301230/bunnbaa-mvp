import { useQuery, useMutation } from "@tanstack/react-query";
import { mockBanAppeals, mockProcessBanAppeal } from "@/lib/mockData";
import AdminLayout from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";

// Ported from BunnBaa Parse_Ref's client/src/pages/admin/vendors.tsx (解封申訴 tab).
// TODO(firebase): reads mockBanAppeals instead of Parse.Query("BanAppeal") and
// calls mockProcessBanAppeal instead of Parse.Cloud.run("processBanAppeal") —
// swap for Firestore + Cloud Functions once the backend is wired up.
export default function AdminAppealsPage() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();

  const { data: appeals = [], isLoading } = useQuery({
    queryKey: ["adminAppeals"],
    queryFn: async () => [...mockBanAppeals].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    enabled: isAdmin,
  });

  const processAppealMutation = useMutation({
    mutationFn: async ({ appealId, approved }: { appealId: string; approved: boolean }) => mockProcessBanAppeal(appealId, approved),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["adminAppeals"] });
      toast({ title: vars.approved ? "已核准解封" : "已拒絕申訴" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "操作失敗", description: err.message }),
  });

  return (
    <AdminLayout>
      <h2 className="text-lg font-bold mb-3">解封申訴管理</h2>
      {isLoading ? (
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
    </AdminLayout>
  );
}
