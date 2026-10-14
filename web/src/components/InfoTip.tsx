import { useEffect, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Help text tucked behind ⓘ: the page shows only the title, and the help appears on tapping ⓘ. Click rather than hover so it works on phones.
 */
export default function InfoTip({ children, className }: { children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <span ref={ref} className={cn("relative inline-flex align-middle print:hidden", className)}>
      <button
        type="button"
        className="inline-flex items-center justify-center w-6 h-6 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={tr("說明", "Info")}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Info className="w-4 h-4" />
      </button>
      {open && (
        <span role="note" className="absolute left-0 top-7 z-30 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-3 text-xs font-normal leading-relaxed text-foreground shadow-lg">
          {children}
        </span>
      )}
    </span>
  );
}
