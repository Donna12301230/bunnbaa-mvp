import { cn } from "@/lib/utils";

// Shared look for native <select> (2026-10-09 consistency pass): keeps the system picker on mobile; border, background and focus match Input.
// md = form field (h-10), sm = small select in lists (h-8); layout classes (w-full, flex-1) are added by the caller
const SELECT_BASE =
  "rounded-md border border-input bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export function selectClass(size: "md" | "sm" = "md", extra?: string): string {
  return cn(SELECT_BASE, size === "md" ? "h-10 px-2 text-sm" : "h-8 px-1.5 text-xs", extra);
}
