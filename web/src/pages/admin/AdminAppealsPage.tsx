import { tr } from "@/lib/i18n";
import { usePrompt } from "@/components/ConfirmDialog";
import { useQuery, useMutation } from "@tanstack/react-query";
import { collection, doc, getDocs, serverTimestamp, writeBatch } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
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

// 消費者端在 ProfilePage.tsx 的 BanAppealSection 提交；這裡讀取 + 核准/拒絕。
// 核准時要一併解除 users/{uid} 的 orderBanned，不然申訴核准了但使用者還是下不了單，
// 所以跟 firestore.rules 一樣把兩個寫入包進同一個 batch，並比照其他管理員覆寫動作
// 補一筆 admin_audit_logs（ISO 27001 A.8.15）。
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

  const prompt = usePrompt();
  const processAppealMutation = useMutation({
    mutationFn: async ({ appeal, approved, adminNote }: { appeal: BanAppeal; approved: boolean; adminNote?: string }) => {
      const batch = writeBatch(db);
      batch.update(doc(db, "ban_appeals", appeal.id), {
        status: approved ? "approved" : "rejected",
        admin_note: adminNote ?? null,
      });
      if (approved) {
        // 一併清乾淨 noPickupCount，不然核准後立刻又因為舊的累計次數被判定已達門檻。
        batch.update(doc(db, "users", appeal.buyer_uid), { orderBanned: false, noPickupCount: 0 });
      }
      batch.set(doc(collection(db, "admin_audit_logs")), {
        admin_email: auth.currentUser?.email ?? null,
        action: approved ? "approve_ban_appeal" : "reject_ban_appeal",
        appeal_id: appeal.id,
        buyer_uid: appeal.buyer_uid,
        note: adminNote ?? null,
        at: serverTimestamp(),
      });
      await batch.commit();
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["adminAppeals"] });
      toast({ title: vars.approved ? tr("已核准解封", "Appeal approved") : tr("已拒絕申訴", "Appeal rejected") });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: tr("操作失敗", "Action failed"), description: err.message }),
  });

  return (
    <>
      <h1 className="font-heading text-3xl md:text-4xl font-semibold mb-3">{tr("解封申訴管理", "Ban appeals")}</h1>
      {isLoading ? (
        <SkeletonBlocks count={2} height={96} className="space-y-3" />
      ) : appeals.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ShieldAlert className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>{tr("目前無申訴案件", "No appeals right now")}</p>
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
                    {tr("申訴時間：", "Submitted: ")}{appeal.created_at?.toDate ? format(appeal.created_at.toDate(), "yyyy/MM/dd HH:mm") : "—"}
                  </div>
                </div>
                <Badge className={
                  appeal.status === "pending" ? "bg-orange-100 text-orange-800 border-0" :
                  appeal.status === "approved" ? "bg-green-100 text-green-800 border-0" :
                  "bg-gray-100 text-gray-600 border-0"
                }>
                  {appeal.status === "pending" ? tr("待審核", "Pending") : appeal.status === "approved" ? tr("已核准", "Approved") : tr("已拒絕", "Rejected")}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-sm bg-gray-50 rounded p-2">
                  <span className="text-xs text-muted-foreground block mb-1">{tr("申訴原因：", "Reason:")}</span>
                  {appeal.reason}
                </div>
                {appeal.admin_note && (
                  <div className="text-xs text-muted-foreground">{tr("管理員備註：", "Admin note: ")}{appeal.admin_note}</div>
                )}
                {appeal.status === "pending" && (
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-green-500 hover:bg-green-600 text-white"
                      disabled={processAppealMutation.isPending}
                      onClick={() => processAppealMutation.mutate({ appeal, approved: true })}
                    >
                      <CheckCircle className="w-3.5 h-3.5 mr-1" /> {tr("核准解封", "Approve")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs text-red-500"
                      disabled={processAppealMutation.isPending}
                      onClick={async () => {
                        const note = await prompt({
                          title: tr("拒絕這筆申訴？", "Reject this appeal?"),
                          inputLabel: tr("拒絕原因（選填，會顯示給使用者看）", "Reason for rejection (optional, shown to the user)"),
                          confirmLabel: tr("拒絕申訴", "Reject"),
                          destructive: true,
                        });
                        if (note === null) return;
                        processAppealMutation.mutate({ appeal, approved: false, adminNote: note.trim() || undefined });
                      }}
                    >
                      <XCircle className="w-3.5 h-3.5 mr-1" /> {tr("拒絕", "Reject")}
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
