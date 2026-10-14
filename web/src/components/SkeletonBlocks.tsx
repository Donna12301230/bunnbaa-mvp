import { tr } from "@/lib/i18n";
import { Skeleton } from "@/components/ds";

// Skeleton for loading lists / cards: the container sets aria-busy and gives screen readers a "Loading" message (design-system Skeleton guideline)
export function SkeletonBlocks({
  count = 1,
  height,
  className,
}: {
  count?: number;
  height: number;
  className?: string;
}) {
  return (
    <div className={className} aria-busy="true">
      <span className="bb-sr-only">{tr("載入中", "Loading")}</span>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} variant="rect" height={height} radius="lg" />
      ))}
    </div>
  );
}
