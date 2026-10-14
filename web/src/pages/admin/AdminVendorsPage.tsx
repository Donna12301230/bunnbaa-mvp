import { loc, tr } from "@/lib/i18n";
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
import PortalPageHeader from "@/components/PortalPageHeader";
import { EmptyState } from "@/components/ds";

interface VendorApplication {
  id: string; // = applicant's uid
  store_name: string;
  phone: string;
  email: string;
  status: "pending" | "approved" | "rejected";
}

const NEW_VENDOR = "__new__";

// Ported from BunnBaa Parse_Ref's client/src/pages/admin/vendors.tsx (vendor management tab).
// Wired to real Firestore:
//   - Pending applications are read from vendor_applications (written by the "Vendor application" form in LoginPage, doc id = applicant uid)
//   - Approve = set vendors/{id}.owner_uid to the applicant uid (a new vendor, or bound to an existing vendor,
//     e.g. the seed data's cafe-renheya-demo); this is the "vendor account binding" in the ISO27001 docs
//   - Every decision is written in the same batch as admin_audit_logs (ISO 27001 A.8.15)
//   - Vendor subscriptions have no payment flow: after confirming the monthly fee was received, the admin presses "Renew 30 days" (lib/subscription.ts)
// Vendor disabling / certification badges are in AdminSettingsPage.
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
        title: vars.approved ? tr("已核准並綁定店家", "Approved and linked") : tr("已拒絕申請", "Application rejected"),
        description: vars.approved ? tr("對方重新整理或重新登入後就會看到店家後台。", "They'll see the vendor portal after refreshing or signing in again.") : undefined,
      });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: tr("操作失敗", "Action failed"), description: err.message }),
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
      toast({ title: tr("已解除綁定", "Unlinked") });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: tr("操作失敗", "Action failed"), description: err.message }),
  });

  async function handleUnbind(vendor: Vendor) {
    const ok = await confirm({
      title: tr(`解除「${vendor.name}」的帳號綁定？`, `Unlink the account for ${loc(vendor, "name")}?`),
      description: tr("解除後原本的店家帳號就進不了店家後台，也看不到撥款與校準報告。", "The vendor account will lose access to the vendor portal, payouts and calibration reports."),
      confirmLabel: tr("解除綁定", "Unlink"),
      destructive: true,
    });
    if (ok) unbindMutation.mutate(vendor);
  }

  return (
    <AdminLayout>
      <PortalPageHeader icon={Store} title={<>{tr("待審核的店家申請", "Pending vendor applications")} ({applications.length})</>} />
      {loadingApps ? (
        <SkeletonBlocks count={2} height={96} className="space-y-3 mb-8" />
      ) : applications.length === 0 ? (
        <EmptyState size="compact" className="mb-8" icon={<Store size={32} />} title={tr("目前沒有待審核的申請", "No pending applications")} />
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
                <Badge className="bg-warning-soft text-warning-text border-0">{tr("待審核", "Pending")}</Badge>
              </CardHeader>
              <CardContent className="text-sm flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
                <Select
                  value={targetByApp[app.id] ?? NEW_VENDOR}
                  onValueChange={(v) => setTargetByApp((prev) => ({ ...prev, [app.id]: v }))}
                >
                  <SelectTrigger className="sm:w-64 h-8 text-xs" aria-label={tr("核准後綁定到", "Link to after approval")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW_VENDOR}>{tr(`建立新店家「${app.store_name}」`, `Create new vendor "${app.store_name}"`)}</SelectItem>
                    {unboundVendors.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{tr("綁定到既有店家：", "Link to existing vendor: ")}{loc(v, "name")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-2 flex-shrink-0">
                  <Button
                    size="sm"
                    className="h-7 text-xs bg-success-strong hover:bg-success-strong/90 text-white"
                    disabled={decideMutation.isPending}
                    onClick={() => decideMutation.mutate({ app, approved: true })}
                  >
                    <CheckCircle className="w-3.5 h-3.5 mr-1" /> {tr("核准", "Approve")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs text-danger-text"
                    disabled={decideMutation.isPending}
                    onClick={() => decideMutation.mutate({ app, approved: false })}
                  >
                    <XCircle className="w-3.5 h-3.5 mr-1" /> {tr("拒絕", "Reject")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <h2 className="text-lg font-bold mb-3">{tr("所有店家", "All vendors")} ({vendors.length})</h2>
      {loadingVendors ? (
        <SkeletonBlocks count={3} height={72} className="space-y-3" />
      ) : vendors.length === 0 ? (
        <EmptyState size="compact" icon={<Store size={32} />} title={tr("目前沒有店家", "No vendors yet")} />
      ) : (
        <div className="space-y-3">
          {vendors.map((vendor) => (
            <Card key={vendor.id}>
              <CardContent className="py-3 text-sm flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{loc(vendor, "name")}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {vendor.id}{vendor.status === "disabled" ? tr(" · 已停用", " · disabled") : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                  {vendor.owner_uid ? (
                    <>
                      <Badge className="bg-success-soft text-success-text border-0">{tr("已綁定帳號", "Account linked")}</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={unbindMutation.isPending}
                        onClick={() => handleUnbind(vendor)}
                      >
                        <Link2Off className="w-3.5 h-3.5 mr-1" /> {tr("解除", "Unlink")}
                      </Button>
                    </>
                  ) : (
                    <Badge className="bg-muted text-muted-foreground border-0">{tr("未綁定", "Not linked")}</Badge>
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
