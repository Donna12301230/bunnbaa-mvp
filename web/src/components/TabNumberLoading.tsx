import { Skeleton } from "@/components/ds";
import { tr } from "@/lib/i18n";

/** Placeholder while the big number on a tab card is loading (shared by order pickup, reports and insights) */
export default function TabNumberLoading() {
  return (
    <span className="inline-block align-middle" aria-busy="true">
      <Skeleton variant="text" width={56} height={24} />
      <span className="sr-only">{tr("載入中", "Loading")}</span>
    </span>
  );
}
