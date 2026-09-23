import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../_shared/cx';
import './Divider.css';

export interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
  /** 中間文字，例如「或」 */
  label?: ReactNode;
  variant?: 'solid' | 'dashed';
  /** 上下（或左右）外距：none 0 / sm 8 / md 16（預設）/ lg 24 */
  spacing?: 'none' | 'sm' | 'md' | 'lg';
  /** 純裝飾時設 true（不會被螢幕閱讀器視為分隔） */
  decorative?: boolean;
}

export function Divider({
  orientation = 'horizontal',
  label,
  variant = 'solid',
  spacing = 'md',
  decorative = false,
  className,
  ...rest
}: DividerProps) {
  return (
    <div
      role={decorative ? 'none' : 'separator'}
      aria-orientation={decorative ? undefined : orientation}
      {...rest}
      className={cx(
        'bb-divider',
        `bb-divider--${orientation}`,
        `bb-divider--${variant}`,
        `bb-divider--space-${spacing}`,
        label != null && 'bb-divider--labelled',
        className,
      )}
    >
      {label != null && orientation === 'horizontal' && <span className="bb-divider__label">{label}</span>}
    </div>
  );
}
