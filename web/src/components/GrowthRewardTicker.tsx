import { Sparkles } from "lucide-react";
import { mockGrowthRewards } from "@/lib/mockData";

// 對應 UI草圖 Main.dc.html 新增的跑馬燈——廣播「成長獎勵」抽中 0 元大獎的消費者，
// 呼應商家後台新增的「成長獎勵」分頁（pages/vendor-portal/VendorPortalGrowth.tsx）。
// TODO(firebase): 目前只挑 mockGrowthRewards.drawHistory 裡 tierPercentOff===0
// 的假資料展示，之後要改成訂閱 draws collection 最新幾筆 0 元中獎紀錄。
export default function GrowthRewardTicker() {
  const bigWins = mockGrowthRewards.drawHistory.filter(d => d.tierPercentOff === 0);
  if (bigWins.length === 0) return null;

  const items = [...bigWins, ...bigWins]; // 重複一次讓 -50% 位移可以無縫循環

  return (
    <div className="overflow-hidden bg-[#2B2620] py-2.5 whitespace-nowrap">
      <div className="inline-flex items-center gap-12 animate-marquee">
        {items.map((win, i) => (
          <span key={`${win.id}-${i}`} className="inline-flex items-center gap-2 text-xs font-bold text-amber-200 shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            {win.consumer} 剛抽中「{win.item}」整份 0 元大獎！
          </span>
        ))}
      </div>
    </div>
  );
}
