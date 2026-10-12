import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Coupon, RewardTicket } from "@/types";

const millis = (ts: unknown) => (ts as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;

/** The current user's coupons (coupons, readable by the owner), live */
export function useMyCoupons(uid: string | null | undefined) {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  useEffect(() => {
    if (!uid) {
      setCoupons([]);
      return;
    }
    return onSnapshot(query(collection(db, "coupons"), where("user_id", "==", uid), limit(200)), (snap) => {
      setCoupons(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Coupon).sort((a, b) => millis(a.expires_at) - millis(b.expires_at)));
    }, () => setCoupons([]));
  }, [uid]);
  const usable = coupons.filter((c) => c.status === "owned" && millis(c.expires_at) > Date.now());
  return { coupons, usable };
}

/** The current user's draw tickets */
export function useMyTickets(uid: string | null | undefined) {
  const [tickets, setTickets] = useState<RewardTicket[]>([]);
  useEffect(() => {
    if (!uid) {
      setTickets([]);
      return;
    }
    return onSnapshot(query(collection(db, "rewardTickets"), where("user_id", "==", uid), limit(500)), (snap) => {
      setTickets(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RewardTicket));
    }, () => setTickets([]));
  }, [uid]);
  return tickets;
}

export { millis };
