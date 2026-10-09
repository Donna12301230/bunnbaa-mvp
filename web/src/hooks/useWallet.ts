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
  created_at?: { toDate?: () => Date };
}

/**
 * 平台點數（functions/src/wallet.js）：餘額、可退回 LINE Pay 的點數、最近明細。
 * withdrawable＝還有剩、而且記得原付款交易的批次加總；其他點數只能結帳折抵。
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
