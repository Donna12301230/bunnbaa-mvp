import { Coins } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useWallet } from "@/hooks/useWallet";
import { formatNT } from "@/lib/format";
import { tr } from "@/lib/i18n";

/** 結帳時「用平台點數折抵」；沒有點數就不顯示。回傳的折抵金額由伺服器重算，這裡只是預覽 */
export function usePointsPreview(total: number, enabled: boolean) {
  const { balance } = useWallet();
  const used = enabled ? Math.min(balance, Math.max(0, total)) : 0;
  return { balance, used, pay: Math.max(0, total) - used };
}

export default function UsePointsToggle({ total, checked, onChange }: { total: number; checked: boolean; onChange: (v: boolean) => void }) {
  const { balance, used } = usePointsPreview(total, checked);
  if (balance <= 0) return null;
  return (
    <label className="flex items-center gap-2 rounded-tile border border-border bg-card p-3 cursor-pointer">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} className="shrink-0" />
      <Coins className="w-4 h-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="flex-1 text-sm">
        {tr(`用平台點數折抵（可用 ${balance} 點）`, `Use BunnBaa points (${balance} available)`)}
      </span>
      {checked && used > 0 && <span className="text-sm font-semibold text-success-text">−{formatNT(used)}</span>}
    </label>
  );
}
