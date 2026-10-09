import { tr } from "@/lib/i18n";
import { arrayUnion, doc, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Lock } from "@/types";

type PriceFields = Pick<Lock, "list_price" | "early_bird_amount" | "adjust_amount" | "locked_price" | "coupon_discount">;

/** 預設轉讓價（規格 §4.1）：早鳥價＋加減，折價券前。轉讓人沒自訂時用這個 */
export function defaultResalePrice(lock: PriceFields): number {
  if (Number.isFinite(lock.list_price) && Number.isFinite(lock.early_bird_amount)) {
    return Math.max(0, lock.list_price! - lock.early_bird_amount! + (lock.adjust_amount ?? 0));
  }
  return Math.max(0, (lock.locked_price ?? 0) + (lock.coupon_discount ?? 0));
}

/** 轉讓價上限＝原價（品項原價＋加減項，不含早鳥折扣）：不能加價賣 */
export function resaleCap(lock: PriceFields): number {
  return Number.isFinite(lock.list_price) ? Math.max(0, lock.list_price! + (lock.adjust_amount ?? 0)) : defaultResalePrice(lock);
}

/**
 * 接手者要付的轉讓價：轉讓人自訂的 resale_price（0 ～ 原價），沒填用預設轉讓價
 * （functions/src/orders.js resalePriceOf 同一套算法，金額以伺服器為準）。
 */
export function resalePrice(lock: PriceFields & Pick<Lock, "resale_price">): number {
  if (Number.isInteger(lock.resale_price) && lock.resale_price! >= 0) return Math.min(lock.resale_price!, resaleCap(lock));
  return defaultResalePrice(lock);
}

/** 轉讓截止時間（取餐時段結束）；過了任何人都能免費領取 */
export function resaleDeadlineOf(lock: Pick<Lock, "resale_deadline">): Date | null {
  const ts = lock.resale_deadline as { toDate?: () => Date } | undefined;
  return ts?.toDate ? ts.toDate() : null;
}

/**
 * 免費（$0）的轉讓：轉讓人自訂 0 元，或逾時沒人接手開放免費領取。
 * 這些不放在轉讓市集，改列在「附近愛心餐」分頁（FreeTransfersSection）。
 */
export function isFreeTransfer(lock: PriceFields & Pick<Lock, "resale_price" | "resale_deadline">, now: number = Date.now()): boolean {
  const deadline = resaleDeadlineOf(lock);
  return resalePrice(lock) === 0 || (!!deadline && deadline.getTime() <= now);
}

/** 接手後換一組新的代領 token，原持有人手上的代領連結／代領碼一起失效 */
export function newShareToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 原付款人被接手後會拿回的金額：他實付與轉讓價取小的（舊資料實付用 locked_price）。
 * 賣得比實付低，差額自己吸收；賣得比實付高，多的留在店家（LINE Pay 退款不能超過原付款額）。
 */
export function refundOnTakeover(lock: PriceFields & Pick<Lock, "paid_amount" | "resale_price">, price: number = resalePrice(lock)): number {
  const paid = Number.isFinite(lock.paid_amount) ? lock.paid_amount! : lock.locked_price ?? 0;
  return Math.min(paid, price);
}

// 免費領取／接受贈送都是 client 直接寫 locks，接手時要把原持有人記進
// transferred_from_uids（firestore.rules 會檢查），「我的轉讓」才查得回已被接手的
// 項目。原持有人要先讀出來，所以包成 transaction，避免讀完到寫入之間被別人搶走。
export async function takeOverLock(lockId: string, uid: string, extra: Record<string, unknown> = {}) {
  const ref = doc(db, "locks", lockId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error(tr("找不到這筆項目", "This item no longer exists"));
    tx.update(ref, {
      status: "locked",
      buyer_uid: uid,
      transferred_from_uids: arrayUnion(snap.data().buyer_uid),
      ...extra,
    });
  });
}
