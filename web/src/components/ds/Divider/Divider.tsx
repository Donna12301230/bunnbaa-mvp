import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../_shared/cx';
import './Divider.css';

export interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: 'horizontal' | 'vertical';
  /** Text in the middle, e.g. "or" */
  label?: ReactNode;
  variant?: 'solid' | 'dashed';
  /** Vertical (or horizontal) margin: none 0 / sm 8 / md 16 (default) / lg 24 */
  spacing?: 'none' | 'sm' | 'md' | 'lg';
  /** Set true when purely decorative (screen readers won't treat it as a separator) */
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
