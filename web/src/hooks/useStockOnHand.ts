import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { mondayOf, todayStr } from "@/lib/pickupSlots";

export interface StockOnHand {
  /** ingredient_id → 現有量（原物料自己的單位） */
  stock: Record<string, number>;
  /** 本週有盤點（否則全是理論值） */
  counted: boolean;
  loaded: boolean;
}

/**
 * 某天開工前的現有庫存，跟 functions/src/orders.js 的 shortageFor 同一套算法（缺料警示用的也是這個數字）：
 * 該週盤點值 ＋ 該週叫貨單到貨量 − 該週在這天之前的備料用量（prepPlans.raw_needs）。
 */
export function useStockOnHand(vendorId: string | undefined, date: string = todayStr()): StockOnHand {
  const week = mondayOf(date);
  const [inv, setInv] = useState<{ counts: Record<string, number>; counted: boolean } | null>(null);
  const [delivered, setDelivered] = useState<Record<string, number>>({});
  const [used, setUsed] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    if (!vendorId) return;
    setLoaded(0);
    const done = () => setLoaded((n) => n + 1);
    const u1 = onSnapshot(doc(db, "vendors", vendorId, "inventory", week), (s) => {
      setInv(s.exists() ? { counts: s.data().counts ?? {}, counted: !!s.data().counted } : null);
      done();
    }, done);
    const u2 = onSnapshot(doc(db, "vendors", vendorId, "purchaseLists", `weekly_${week}`), (s) => {
      const out: Record<string, number> = {};
      for (const l of (s.exists() ? s.data().lines : []) ?? []) out[l.ingredient_id] = (out[l.ingredient_id] || 0) + (l.order_amount || 0);
      setDelivered(out);
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

  const stock: Record<string, number> = {};
  for (const id of new Set([...Object.keys(inv?.counts ?? {}), ...Object.keys(delivered), ...Object.keys(used)])) {
    stock[id] = Math.max(0, (inv?.counts?.[id] || 0) + (delivered[id] || 0) - (used[id] || 0));
  }
  return { stock, counted: !!inv?.counted, loaded: loaded >= 3 };
}
