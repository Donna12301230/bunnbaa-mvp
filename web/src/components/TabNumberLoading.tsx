import { Skeleton } from "@/components/ds";
import { tr } from "@/lib/i18n";

/** 分頁卡上的大數字還在讀取時的占位（訂單取餐、報表與洞察共用） */
export default function TabNumberLoading() {
  return (
    <span className="inline-block align-middle" aria-busy="true">
      <Skeleton variant="text" width={56} height={24} />
      <span className="sr-only">{tr("載入中", "Loading")}</span>
    </span>
  );
}
