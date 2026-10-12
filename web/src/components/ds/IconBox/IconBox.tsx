import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../_shared/cx';
import './IconBox.css';

export type IconBoxTone = 'brand' | 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface IconBoxProps extends HTMLAttributes<HTMLSpanElement> {
  /** lucide icon; sized automatically from size */
  children: ReactNode;
  /** sm 32 (icon 16) / md 40 (icon 20, default) / lg 48 (icon 24) */
  size?: 'sm' | 'md' | 'lg';
  tone?: IconBoxTone;
}

/** Feature icon box: 40×40, --radius-lg, light orange background, orange icon. Decorative; needs text next to it. */
export function IconBox({ children, size = 'md', tone = 'brand', className, ...rest }: IconBoxProps) {
  return (
    <span
      aria-hidden="true"
      {...rest}
      className={cx('bb-iconbox', `bb-iconbox--${size}`, `bb-iconbox--${tone}`, className)}
    >
      {children}
    </span>
  );
}
