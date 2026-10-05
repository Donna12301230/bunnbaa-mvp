import { collection, deleteField, doc, serverTimestamp, Timestamp, updateDoc, writeBatch } from "firebase/firestore";
import { auth, db } from "./firebase";
import type { Vendor } from "@/types";

// 商家訂閱（首月免費，之後每月 NT$1,999）。狀態存在 vendors/{id}：
//   subscription_status   trial | active | cancelled | expired
//   subscription_end_date 試用到期日／下次續約日／取消後的暫停日
//   cancelled_from        申請取消前的狀態（恢復時還原成它）
// 到期不靠排程 Function：只要 end_date 已過就視為暫停（同 locks 的 lazy expiry 做法）。
// 沒有訂閱金流，所以到期後的續約由平台管理員在 /admin/vendors 手動延長；
// 商家自己只能「申請取消」跟「到期前恢復」，這兩個轉換由 firestore.rules 限制。

export const SUBSCRIPTION_PERIOD_DAYS = 30;
export const PLATFORM_CONTACT_EMAIL = "herzbaa@gmail.com";

export type SubscriptionStatus = "trial" | "active" | "cancelled" | "expired";

export interface SubscriptionState {
  status: SubscriptionStatus;
  endDate: Date | null;
  /** 廠商後台要不要擋住（已到期／取消後已過暫停日） */
  blocked: boolean;
  /** 已申請取消、但還沒到暫停日，可以自己恢復 */
  canUndoCancel: boolean;
  /** 可以自己申請取消 */
  canCancel: boolean;
  /** 舊資料沒有任何訂閱欄位：不擋，但也不能自助操作，等管理員設定 */
  unset: boolean;
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const ts = v as { toDate?: () => Date };
  return ts.toDate ? ts.toDate() : null;
}

export function getSubscriptionState(vendor: Vendor, now = new Date()): SubscriptionState {
  const unset = !vendor.subscription_status;
  const status: SubscriptionStatus = vendor.subscription_status ?? "active";
  const endDate = toDate(vendor.subscription_end_date);
  const pastEnd = !!endDate && endDate <= now;
  const blocked = status === "expired" || pastEnd;
  return {
    status: blocked ? "expired" : status,
    endDate,
    blocked,
    canUndoCancel: status === "cancelled" && !pastEnd,
    canCancel: !unset && !blocked && (status === "trial" || status === "active") && !!endDate,
    unset,
  };
}

export async function requestCancelSubscription(vendor: Vendor) {
  await updateDoc(doc(db, "vendors", vendor.id), {
    subscription_status: "cancelled",
    cancelled_from: vendor.subscription_status,
    cancel_requested_at: serverTimestamp(),
  });
}

export async function undoCancelSubscription(vendor: Vendor) {
  await updateDoc(doc(db, "vendors", vendor.id), {
    subscription_status: vendor.cancelled_from ?? "active",
    cancelled_from: deleteField(),
    cancel_requested_at: deleteField(),
  });
}

/**
 * 新核准的商家：標成首月免費試用，但還不給到期日——規格 §1「自店家第一次上架當天起算 30 天」，
 * 到期日由後端 onMenuItemListed（functions/src/finance.js）在第一個品項上架時寫入。
 * 沒有到期日的 trial 不擋後台、也不會進寬限／暫停。
 */
export function initialTrialFields() {
  return { subscription_status: "trial" as const };
}

/** 試用中、但還沒上架過任何品項（首月還沒開始算） */
export function trialNotStarted(vendor: Vendor): boolean {
  return vendor.subscription_status === "trial" && !vendor.subscription_end_date;
}

/** 管理員確認收到月費後延長 30 天（從目前到期日或今天，取較晚者起算），寫稽核紀錄 */
export async function adminRenewSubscription(vendor: Vendor) {
  const now = new Date();
  const currentEnd = toDate(vendor.subscription_end_date);
  const base = currentEnd && currentEnd > now ? currentEnd : now;
  const newEnd = new Date(base.getTime() + SUBSCRIPTION_PERIOD_DAYS * 86400000);

  const batch = writeBatch(db);
  batch.update(doc(db, "vendors", vendor.id), {
    subscription_status: "active",
    subscription_end_date: Timestamp.fromDate(newEnd),
    cancelled_from: deleteField(),
    cancel_requested_at: deleteField(),
  });
  batch.set(doc(collection(db, "admin_audit_logs")), {
    admin_email: auth.currentUser?.email ?? null,
    action: "renew_vendor_subscription",
    vendor_id: vendor.id,
    from_status: vendor.subscription_status ?? null,
    new_end_date: Timestamp.fromDate(newEnd),
    at: serverTimestamp(),
  });
  await batch.commit();
  return newEnd;
}
