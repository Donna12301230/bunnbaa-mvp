import { useEffect, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";

export interface WalletEntry {
  id: string;
  type: "credit" | "spend" | "release" | "withdraw";
  amount: number;
  reason?: string;
  text?: string;
  text_en?: string; // English item name (Functions writeCredit); older entries only have text
  created_at?: { toDate?: () => Date };
}

/**
 * Platform points (functions/src/wallet.js): balance, points that can be sent back to LINE Pay, recent activity.
 * withdrawable = sum of batches that still have a balance and remember their original payment; other points can only be used at checkout.
 */
export function useWallet(enabled = true) {
  const { user } = useAuth();
  const uid = enabled ? user?.id : undefined;
  const [balance, setBalance] = useState(0);
  const [withdrawable, setWithdrawable] = useState(0);
  const [entries, setEntries] = useState<WalletEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setBalance(0);
      setWithdrawable(0);
      setEntries([]);
      setLoading(false);
      return;
    }
    const u1 = onSnapshot(doc(db, "wallets", uid), (s) => {
      setBalance(Math.max(0, Number(s.data()?.balance) || 0));
      setLoading(false);
    }, () => setLoading(false));
    const u2 = onSnapshot(query(collection(db, "wallets", uid, "lots"), where("remaining", ">", 0)), (s) => {
      setWithdrawable(s.docs.reduce((sum, d) => sum + (d.data().source_tx ? Number(d.data().remaining) || 0 : 0), 0));
    }, () => setWithdrawable(0));
    const u3 = onSnapshot(query(collection(db, "wallets", uid, "entries"), orderBy("created_at", "desc"), limit(30)), (s) => {
      setEntries(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WalletEntry, "id">) })));
    }, () => setEntries([]));
    return () => {
      u1();
      u2();
      u3();
    };
  }, [uid]);

  return { balance, withdrawable, entries, loading };
}
