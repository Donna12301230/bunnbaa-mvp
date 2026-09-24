import { useQuery, useMutation } from "@tanstack/react-query";
import { collection, doc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import AdminLayout from "@/components/AdminLayout";
import RequireRealAdmin from "@/components/RequireRealAdmin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";

interface BanAppeal {
  id: string;
  buyer_uid: string;
  username: string;
  display_name: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  admin_note: string | null;
  created_at: { toDate?: () => Date };
}

// 只做管理員後台這半邊：讀取 + 核准/拒絕，對應真實 ban_appeals collection
// （firestore.rules 限管理員讀寫）。沒有消費者自動提交申訴的畫面——真實後端
// 目前沒有穩定的使用者帳號體系可以綁定封禁狀態，這半邊功能刻意只到這裡
// （TODO.md 有記錄，見「解封申訴」待辦）。
function AppealsList() {
  const { toast } = useToast();

  const { data: appeals = [], isLoading } = useQuery({
    queryKey: ["adminAppeals"],
    queryFn: async () => {
      const snap = await getDocs(collection(db, "ban_appeals"));
      return snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }) as BanAppeal)
        .sort((a, b) => (b.created_at?.toDate?.().getTime() ?? 0) - (a.created_at?.toDate?.().getTime() ?? 0));
    },
  });

  const processAppealMutation = useMutation({
    mutationFn: async ({ appealId, approved }: { appealId: string; approved: boolean }) =>
      updateDoc(doc(db, "ban_appeals", appealId), { status: approved ? "approved" : "rejected" }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["adminAppeals"] });
      toast({ title: vars.approved ? "已核准解封" : "已拒絕申訴" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "操作失敗", description: err.message }),
  });

  return (
    <>
      <h2 className="text-lg font-bold mb-3">解封申訴管理</h2>
      {isLoading ? (
        <SkeletonBlocks count={2} height={96} className="space-y-3" />
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
                    {appeal.display_name || appeal.username}
                    <span className="text-xs text-muted-foreground font-normal ml-2">@{appeal.username}</span>
                  </CardTitle>
                  <div className="text-xs text-muted-foreground">
                    申訴時間：{appeal.created_at?.toDate ? format(appeal.created_at.toDate(), "yyyy/MM/dd HH:mm") : "—"}
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
                {appeal.admin_note && (
                  <div className="text-xs text-muted-foreground">管理員備註：{appeal.admin_note}</div>
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
    </>
  );
}

export default function AdminAppealsPage() {
  return (
    <AdminLayout>
      <RequireRealAdmin>
        <AppealsList />
      </RequireRealAdmin>
    </AdminLayout>
  );
}
