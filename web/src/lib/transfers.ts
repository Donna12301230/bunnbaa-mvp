import { tr } from "@/lib/i18n";
import { arrayUnion, doc, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Lock } from "@/types";

/**
 * 轉讓市集的接手價（規格 §4.1）：早鳥價＋加減，折價券前。接手者付這個價錢，
 * 原付款人退回他實付的金額（functions/src/orders.js resalePriceOf 同一套算法）。
 */
export function resalePrice(lock: Pick<Lock, "list_price" | "early_bird_amount" | "adjust_amount" | "locked_price" | "coupon_discount">): number {
  if (Number.isFinite(lock.list_price) && Number.isFinite(lock.early_bird_amount)) {
    return Math.max(0, lock.list_price! - lock.early_bird_amount! + (lock.adjust_amount ?? 0));
  }
  return Math.max(0, (lock.locked_price ?? 0) + (lock.coupon_discount ?? 0));
}

/** 原付款人被接手後會拿回的金額（付款人實付；舊資料用 locked_price） */
export function refundOnTakeover(lock: Pick<Lock, "paid_amount" | "locked_price">): number {
  return Number.isFinite(lock.paid_amount) ? lock.paid_amount! : lock.locked_price ?? 0;
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
