import type { CSSProperties, HTMLAttributes } from 'react';
import { cx } from '../_shared/cx';
import './Skeleton.css';

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  /** text：一行字高度；rect：區塊（圖片、卡片）；circle：頭像 */
  variant?: 'text' | 'rect' | 'circle';
  width?: number | string;
  height?: number | string;
  /** variant="text" 時的行數；最後一行自動縮短為 60% */
  lines?: number;
  /** 覆寫圓角 */
  radius?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const toSize = (v: number | string | undefined) => (typeof v === 'number' ? `${v}px` : v);

/**
 * 載入骨架。骨架本身 aria-hidden；請在外層容器加 aria-busy="true"
 * 並提供一段 .bb-sr-only 的「載入中」文字。
 */
export function Skeleton({
  variant = 'text',
  width,
  height,
  lines = 1,
  radius,
  className,
  style,
  ...rest
}: SkeletonProps) {
  const base = cx('bb-skeleton', `bb-skeleton--${variant}`, radius && `bb-skeleton--r-${radius}`, className);

  if (variant === 'text' && lines > 1) {
    return (
      <span className="bb-skeleton-lines" aria-hidden="true" style={{ width: toSize(width) }}>
        {Array.from({ length: lines }, (_, i) => (
          <span
            key={i}
            className={base}
            style={{ width: i === lines - 1 ? '60%' : '100%', height: toSize(height) }}
          />
        ))}
      </span>
    );
  }

  const sizeStyle: CSSProperties = {
    width: toSize(width),
    height: toSize(variant === 'circle' ? (height ?? width) : height),
    ...style,
  };

  return <span aria-hidden="true" {...rest} className={base} style={sizeStyle} />;
}
