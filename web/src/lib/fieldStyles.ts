import { cn } from "@/lib/utils";

// 原生 <select> 的共用外觀（2026-10-09 一致性整理）：手機上保留系統選單，外框、底色、focus 跟 Input 一致。
// md＝表單欄位（h-10），sm＝列表裡的小選單（h-8）；版面相關（w-full、flex-1）由呼叫端加
const SELECT_BASE =
  "rounded-md border border-input bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export function selectClass(size: "md" | "sm" = "md", extra?: string): string {
  return cn(SELECT_BASE, size === "md" ? "h-10 px-2 text-sm" : "h-8 px-1.5 text-xs", extra);
}
