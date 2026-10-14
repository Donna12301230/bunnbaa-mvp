import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { addDaysStr, mondayOf, todayStr } from "@/lib/pickupSlots";

export interface StockOnHand {
  /** ingredient_id → quantity on hand (in the ingredient's own unit) */
  stock: Record<string, number>;
  /** Opening stock comes from an actual count (last Saturday); otherwise it uses the supplier order's theoretical stock */
  counted: boolean;
  loaded: boolean;
}

/**
 * Stock on hand before work starts on a given day, using the same calculation as shortageFor in functions/src/orders.js (the shortage warning uses this number too):
 * opening = last Saturday's count (inventory/{last Monday}); without a count, use this week's supplier order lines[].stock,
 * + this week's supplier-order deliveries − this week's prep usage before that day (prepPlans.raw_needs).
 */
export function useStockOnHand(vendorId: string | undefined, date: string = todayStr()): StockOnHand {
  const week = mondayOf(date);
  const [inv, setInv] = useState<{ counts: Record<string, number>; counted: boolean } | null>(null);
  const [list, setList] = useState<{ opening: Record<string, number>; delivered: Record<string, number> }>({ opening: {}, delivered: {} });
  const [used, setUsed] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    if (!vendorId) return;
    setLoaded(0);
    const done = () => setLoaded((n) => n + 1);
    const u1 = onSnapshot(doc(db, "vendors", vendorId, "inventory", addDaysStr(week, -7)), (s) => {
      setInv(s.exists() ? { counts: s.data().counts ?? {}, counted: !!s.data().counted } : null);
      done();
    }, done);
    const u2 = onSnapshot(doc(db, "vendors", vendorId, "purchaseLists", `weekly_${week}`), (s) => {
      const opening: Record<string, number> = {};
      const delivered: Record<string, number> = {};
      for (const l of (s.exists() ? s.data().lines : []) ?? []) {
        opening[l.ingredient_id] = Number(l.stock) || 0;
        delivered[l.ingredient_id] = (delivered[l.ingredient_id] || 0) + (l.order_amount || 0);
      }
      setList({ opening, delivered });
      done();
    }, done);
    const u3 = onSnapshot(query(collection(db, "vendors", vendorId, "prepPlans"), where("week", "==", week)), (snap) => {
      const out: Record<string, number> = {};
      snap.docs.filter((d) => d.id < date).forEach((d) => {
        for (const [id, n] of Object.entries((d.data().raw_needs ?? {}) as Record<string, number>)) out[id] = (out[id] || 0) + n;
      });
      setUsed(out);
      done();
    }, done);
    return () => { u1(); u2(); u3(); };
  }, [vendorId, week, date]);

  const counted = !!inv?.counted;
  const opening = counted ? inv!.counts : list.opening;
  const stock: Record<string, number> = {};
  for (const id of new Set([...Object.keys(opening), ...Object.keys(list.delivered), ...Object.keys(used)])) {
    stock[id] = Math.max(0, (opening[id] || 0) + (list.delivered[id] || 0) - (used[id] || 0));
  }
  return { stock, counted, loaded: loaded >= 3 };
}
