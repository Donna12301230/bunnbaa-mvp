import { Skeleton } from "@/components/ds";

// 列表／卡片載入中的骨架：容器設 aria-busy，並給螢幕閱讀器一段「載入中」（設計系統 Skeleton 規範）
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
      <span className="bb-sr-only">載入中</span>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} variant="rect" height={height} radius="lg" />
      ))}
    </div>
  );
}
