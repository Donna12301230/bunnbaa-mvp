import type { CSSProperties, HTMLAttributes } from 'react';
import { cx } from '../_shared/cx';
import './Skeleton.css';

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  /** text: one line of text height; rect: block (image, card); circle: avatar */
  variant?: 'text' | 'rect' | 'circle';
  width?: number | string;
  height?: number | string;
  /** Number of lines when variant="text"; the last line is shortened to 60% */
  lines?: number;
  /** Override the border radius */
  radius?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const toSize = (v: number | string | undefined) => (typeof v === 'number' ? `${v}px` : v);

/**
 * Loading skeleton. The skeleton itself is aria-hidden; set aria-busy="true" on the outer container
 * and provide a .bb-sr-only "Loading" text.
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
