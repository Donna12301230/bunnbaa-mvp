import type { ReactNode } from "react";
import { useInView } from "@/hooks/useInView";
import { cn } from "@/lib/utils";

// 捲到畫面內才淡入＋上移，純 CSS transition（.bb-theme 全站已經有
// prefers-reduced-motion 的全域規則，會自動把 transition-duration 壓到
// 接近 0，這裡不用另外處理）。delay 用來做卡片依序淡入的錯開效果。
export default function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={cn(
        "transition-all duration-700 ease-out",
        inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
        className
      )}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}
