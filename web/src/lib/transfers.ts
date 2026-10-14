import { tr } from "@/lib/i18n";
import { arrayUnion, doc, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Lock } from "@/types";

type PriceFields = Pick<Lock, "list_price" | "early_bird_amount" | "adjust_amount" | "locked_price" | "coupon_discount">;

/** Default resale price: early-bird price + add-ons/reductions, before coupons. Used when the seller sets no price */
export function defaultResalePrice(lock: PriceFields): number {
  if (Number.isFinite(lock.list_price) && Number.isFinite(lock.early_bird_amount)) {
    return Math.max(0, lock.list_price! - lock.early_bird_amount! + (lock.adjust_amount ?? 0));
  }
  return Math.max(0, (lock.locked_price ?? 0) + (lock.coupon_discount ?? 0));
}

/** Resale price cap = list price (item price + add-ons/reductions, without early-bird discount): no selling at a markup */
export function resaleCap(lock: PriceFields): number {
  return Number.isFinite(lock.list_price) ? Math.max(0, lock.list_price! + (lock.adjust_amount ?? 0)) : defaultResalePrice(lock);
}

/**
 * Resale price the taker pays: the seller's custom resale_price (0 to list price), or the default resale price if unset
 * (same calculation as resalePriceOf in functions/src/orders.js; the server's amount is authoritative).
 */
export function resalePrice(lock: PriceFields & Pick<Lock, "resale_price">): number {
  if (Number.isInteger(lock.resale_price) && lock.resale_price! >= 0) return Math.min(lock.resale_price!, resaleCap(lock));
  return defaultResalePrice(lock);
}

/** Resale deadline (end of the pickup slot); after that anyone can claim it for free */
export function resaleDeadlineOf(lock: Pick<Lock, "resale_deadline">): Date | null {
  const ts = lock.resale_deadline as { toDate?: () => Date } | undefined;
  return ts?.toDate ? ts.toDate() : null;
}

/**
 * Free ($0) resales: the seller set 0, or nobody took it over in time so it opened for free claiming.
 * These are not shown in the resale market but under the "Nearby charity meals" tab (FreeTransfersSection).
 */
export function isFreeTransfer(lock: PriceFields & Pick<Lock, "resale_price" | "resale_deadline">, now: number = Date.now()): boolean {
  const deadline = resaleDeadlineOf(lock);
  return resalePrice(lock) === 0 || (!!deadline && deadline.getTime() <= now);
}

/** Issue a new proxy pickup token on takeover; the original holder's proxy pickup link / code stops working */
export function newShareToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Amount the original payer gets back after a takeover: the lower of what they paid and the resale price (older records use locked_price for the amount paid).
 * Selling below what they paid, they absorb the difference; selling above, the extra stays with the vendor (LINE Pay refunds cannot exceed the original payment).
 */
export function refundOnTakeover(lock: PriceFields & Pick<Lock, "paid_amount" | "resale_price">, price: number = resalePrice(lock)): number {
  const paid = Number.isFinite(lock.paid_amount) ? lock.paid_amount! : lock.locked_price ?? 0;
  return Math.min(paid, price);
}

// Free claims and gift acceptance write locks directly from the client; on takeover the original holder must be recorded in
// transferred_from_uids (checked by firestore.rules) so "My resales" can still find items that were taken over.
// The original holder has to be read first, so this runs in a transaction to stop someone else grabbing it between the read and the write.
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
