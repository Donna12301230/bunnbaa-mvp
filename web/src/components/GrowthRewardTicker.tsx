import { tr } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { Sparkles } from "lucide-react";
import { db } from "@/lib/firebase";

// 對應 UI草圖 Main.dc.html 新增的跑馬燈——廣播「成長獎勵」抽中 0 元大獎的消費者，
// 呼應商家後台新增的「成長獎勵」分頁（pages/vendor-portal/VendorPortalGrowth.tsx）。
// 2026-09-22 改成訂閱真實 draws collection（price_percent === 0 的中獎紀錄），
// 拿掉假資料——沒有人真的抽過獎之前，這裡就是空的，不補假的中獎名單。
interface BigWin {
  id: string;
  buyer_tag?: string;
  buyer_uid?: string; // 2026-09-24 前的舊紀錄
  item_name?: string | null;
}

export default function GrowthRewardTicker() {
  const [bigWins, setBigWins] = useState<BigWin[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, "draws"), where("price_percent", "==", 0)), (snap) => {
      setBigWins(snap.docs.slice(0, 20).map((d) => ({ id: d.id, ...(d.data() as any) }) as BigWin));
    });
    return () => unsub();
  }, []);

  if (bigWins.length === 0) return null;

  const items = [...bigWins, ...bigWins]; // 重複一次讓 -50% 位移可以無縫循環

  return (
    <div className="overflow-hidden bg-rice py-3 whitespace-nowrap">
      <div className="inline-flex items-center gap-12 animate-marquee">
        {items.map((win, i) => (
          <span key={`${win.id}-${i}`} className="inline-flex items-center gap-2 text-sm md:text-base font-bold text-rice-foreground shrink-0">
            <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-amber-200 shrink-0" />
            {tr(
              `使用者 ${win.buyer_tag ?? win.buyer_uid?.slice(-6) ?? "—"} 剛抽中「${win.item_name ?? "整份餐點"}」整份 0 元大獎！`,
              `User ${win.buyer_tag ?? win.buyer_uid?.slice(-6) ?? "—"} just won a free ${win.item_name ?? "meal"}!`
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
