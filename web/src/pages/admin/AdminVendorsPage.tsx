import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { collection, doc, getDocs, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { Vendor } from "@/types";
import AdminLayout from "@/components/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle, XCircle, Store, Link2Off } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";

interface VendorApplication {
  id: string; // = 申請人的 uid
  store_name: string;
  phone: string;
  email: string;
  status: "pending" | "approved" | "rejected";
}

const NEW_VENDOR = "__new__";

// Ported from BunnBaa Parse_Ref's client/src/pages/admin/vendors.tsx (廠商管理 tab).
// 接真 Firestore：
//   - 待審核申請讀 vendor_applications（LoginPage「廠商申請」寫入，doc id = 申請人 uid）
//   - 核准 = 把 vendors/{id}.owner_uid 設成申請人 uid（新建商家，或綁到既有商家，
//     例如種子資料的 cafe-renheya-demo），這就是 ISO27001 文件的「商家帳號綁定」
//   - 每個決定都跟 admin_audit_logs 同一個 batch 寫入（ISO 27001 A.8.15）
// 商家停用／認證徽章在 AdminSettingsPage。
export default function AdminVendorsPage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { isAdmin } = useAuth();
  const [targetByApp, setTargetByApp] = useState<Record<string, string>>({});

  const { data: applications = [], isLoading: loadingApps } = useQuery({
    queryKey: ["adminVendorApplications"],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "vendor_applications"), where("status", "==", "pending")));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VendorApplication);
    },
    enabled: isAdmin,
  });

  const { data: vendors = [], isLoading: loadingVendors } = useQuery({
    queryKey: ["adminVendorsList"],
    queryFn: async () => {
      const snap = await getDocs(collection(db, "vendors"));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as Vendor)
        .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
    },
    enabled: isAdmin,
  });

  const unboundVendors = vendors.filter((v) => !v.owner_uid);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["adminVendorApplications"] });
    queryClient.invalidateQueries({ queryKey: ["adminVendorsList"] });
  }

  function auditLog(batch: ReturnType<typeof writeBatch>, entry: Record<string, unknown>) {
    batch.set(doc(collection(db, "admin_audit_logs")), {
      admin_email: auth.currentUser?.email ?? null,
      ...entry,
      at: serverTimestamp(),
    });
  }

  const decideMutation = useMutation({
    mutationFn: async ({ app, approved }: { app: VendorApplication; approved: boolean }) => {
      const batch = writeBatch(db);
      let vendorId: string | null = null;
      if (approved) {
        const target = targetByApp[app.id] ?? NEW_VENDOR;
        if (target === NEW_VENDOR) {
          const ref = doc(collection(db, "vendors"));
          vendorId = ref.id;
          batch.set(ref, {
            name: app.store_name,
            item_focus: "",
            reliability_tone: "new",
            verified: false,
            phone: app.phone,
            owner_uid: app.id,
            created_at: serverTimestamp(),
          });
        } else {
          vendorId = target;
          batch.update(doc(db, "vendors", target), { owner_uid: app.id });
        }
      }
      batch.update(doc(db, "vendor_applications", app.id), {
        status: approved ? "approved" : "rejected",
        vendor_id: vendorId,
        decided_at: serverTimestamp(),
      });
      auditLog(batch, {
        action: approved ? "approve_vendor_application" : "reject_vendor_application",
        applicant_uid: app.id,
        applicant_email: app.email,
        vendor_id: vendorId,
      });
      await batch.commit();
    },
    onSuccess: (_, vars) => {
      invalidate();
      toast({
        title: vars.approved ? "已核准並綁定商家" : "已拒絕申請",
        description: vars.approved ? "對方重新整理或重新登入後就會看到廠商後台。" : undefined,
      });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "操作失敗", description: err.message }),
  });

  const unbindMutation = useMutation({
    mutationFn: async (vendor: Vendor) => {
      const batch = writeBatch(db);
      batch.update(doc(db, "vendors", vendor.id), { owner_uid: null });
      auditLog(batch, { action: "unbind_vendor_owner", vendor_id: vendor.id, previous_owner_uid: vendor.owner_uid ?? null });
      await batch.commit();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "已解除綁定" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "操作失敗", description: err.message }),
  });

  async function handleUnbind(vendor: Vendor) {
    const ok = await confirm({
      title: `解除「${vendor.name}」的帳號綁定？`,
      description: "解除後原本的商家帳號就進不了廠商後台，也看不到撥款與校準報告。",
      confirmLabel: "解除綁定",
      destructive: true,
    });
    if (ok) unbindMutation.mutate(vendor);
  }

  return (
    <AdminLayout>
      <h2 className="text-lg font-bold mb-3">待審核的廠商申請 ({applications.length})</h2>
      {loadingApps ? (
        <SkeletonBlocks count={2} height={96} className="space-y-3 mb-8" />
      ) : applications.length === 0 ? (
        <div className="text-center py-10 mb-8 text-muted-foreground bg-white rounded-xl border border-border">
          <Store className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">目前沒有待審核的申請</p>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {applications.map((app) => (
            <Card key={app.id}>
              <CardHeader className="pb-1 flex flex-row items-start justify-between">
                <div>
                  <CardTitle className="text-base">{app.store_name}</CardTitle>
                  <div className="text-xs text-muted-foreground">
                    {app.email}{app.phone ? ` · ${app.phone}` : ""}
                  </div>
                </div>
                <Badge className="bg-yellow-100 text-yellow-800 border-0">待審核</Badge>
              </CardHeader>
              <CardContent className="text-sm flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
                <Select
                  value={targetByApp[app.id] ?? NEW_VENDOR}
                  onValueChange={(v) => setTargetByApp((prev) => ({ ...prev, [app.id]: v }))}
                >
                  <SelectTrigger className="sm:w-64 h-8 text-xs" aria-label="核准後綁定到">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW_VENDOR}>建立新商家「{app.store_name}」</SelectItem>
                    {unboundVendors.map((v) => (
                      <SelectItem key={v.id} value={v.id}>綁定到既有商家：{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-2 flex-shrink-0">
                  <Button
                    size="sm"
                    className="h-7 text-xs bg-green-500 hover:bg-green-600 text-white"
                    disabled={decideMutation.isPending}
                    onClick={() => decideMutation.mutate({ app, approved: true })}
                  >
                    <CheckCircle className="w-3.5 h-3.5 mr-1" /> 核准
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs text-red-500"
                    disabled={decideMutation.isPending}
                    onClick={() => decideMutation.mutate({ app, approved: false })}
                  >
                    <XCircle className="w-3.5 h-3.5 mr-1" /> 拒絕
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <h2 className="text-lg font-bold mb-3">所有商家 ({vendors.length})</h2>
      {loadingVendors ? (
        <SkeletonBlocks count={3} height={72} className="space-y-3" />
      ) : (
        <div className="space-y-3">
          {vendors.map((vendor) => (
            <Card key={vendor.id}>
              <CardContent className="py-3 text-sm flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{vendor.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {vendor.id}{vendor.status === "disabled" ? " · 已停用" : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {vendor.owner_uid ? (
                    <>
                      <Badge className="bg-green-100 text-green-800 border-0">已綁定帳號</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={unbindMutation.isPending}
                        onClick={() => handleUnbind(vendor)}
                      >
                        <Link2Off className="w-3.5 h-3.5 mr-1" /> 解除
                      </Button>
                    </>
                  ) : (
                    <Badge className="bg-gray-100 text-gray-600 border-0">未綁定</Badge>
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
