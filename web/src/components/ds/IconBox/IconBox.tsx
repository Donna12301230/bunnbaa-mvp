import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../_shared/cx';
import './IconBox.css';

export type IconBoxTone = 'brand' | 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface IconBoxProps extends HTMLAttributes<HTMLSpanElement> {
  /** lucide icon；尺寸會依 size 自動套用 */
  children: ReactNode;
  /** sm 32（icon 16）/ md 40（icon 20，預設）/ lg 48（icon 24） */
  size?: 'sm' | 'md' | 'lg';
  tone?: IconBoxTone;
}

/** 功能 icon 方塊：40×40、--radius-lg、淡橘底、橘色 icon。屬裝飾，旁邊需有文字說明。 */
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
