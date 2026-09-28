import { tr } from '@/lib/i18n';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from '../_shared/cx';
import './Badge.css';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** soft 淡底深字（預設）/ solid 實心（僅 brand、danger 建議使用） */
  variant?: 'soft' | 'solid';
  size?: 'sm' | 'md';
  /** 前置 icon（16px 以下） */
  icon?: ReactNode;
  /** 前置圓點，用於狀態標示 */
  dot?: boolean;
  /** rounded 標籤（--radius-sm，預設）/ pill 膠囊 */
  shape?: 'rounded' | 'pill';
}

/** 唯讀的狀態/分類標記。 */
export function Badge({
  tone = 'neutral',
  variant = 'soft',
  size = 'md',
  icon,
  dot = false,
  shape = 'rounded',
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      {...rest}
      className={cx(
        'bb-badge',
        `bb-badge--${tone}`,
        `bb-badge--${variant}`,
        `bb-badge--${size}`,
        shape === 'pill' && 'bb-badge--pill',
        className,
      )}
    >
      {dot && <span className="bb-badge__dot" aria-hidden="true" />}
      {icon && (
        <span className="bb-badge__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}

export interface TagProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  /** 可選取的篩選標籤（aria-pressed） */
  selected?: boolean;
  icon?: ReactNode;
  /** 提供時顯示移除鈕 */
  onRemove?: () => void;
  /** 僅供預覽頁強制呈現狀態 */
  forceState?: 'hover' | 'active' | 'focus';
}

/** 可互動的膠囊標籤：篩選條件、已選項目。 */
export function Tag({
  selected = false,
  icon,
  onRemove,
  disabled,
  className,
  forceState,
  children,
  ...rest
}: TagProps) {
  return (
    <span
      className={cx(
        'bb-tag',
        selected && 'is-selected',
        disabled && 'is-disabled',
        onRemove && 'bb-tag--removable',
        forceState && `is-${forceState}`,
        className,
      )}
    >
      <button type="button" className="bb-tag__main" aria-pressed={selected} disabled={disabled} {...rest}>
        {icon && (
          <span className="bb-badge__icon" aria-hidden="true">
            {icon}
          </span>
        )}
        {children}
      </button>
      {onRemove && (
        <button
          type="button"
          className="bb-tag__remove"
          onClick={onRemove}
          disabled={disabled}
          aria-label={tr(`移除 ${typeof children === 'string' ? children : ''}`, `Remove ${typeof children === 'string' ? children : ''}`).trim()}
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
