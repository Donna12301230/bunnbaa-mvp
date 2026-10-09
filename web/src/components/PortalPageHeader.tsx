import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

// 後台（admin）與店家後台（vendor portal）共用的頁首：標題＋可選說明＋右側動作按鈕。
export default function PortalPageHeader({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-heading text-3xl md:text-4xl font-semibold flex items-center gap-2">
          {Icon && <Icon className="w-5 h-5" aria-hidden="true" />}
          {title}
        </h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
