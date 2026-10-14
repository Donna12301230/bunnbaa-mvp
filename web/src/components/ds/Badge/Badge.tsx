import { tr } from '@/lib/i18n';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from '../_shared/cx';
import './Badge.css';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** soft: light background, dark text (default) / solid: filled (recommended only for brand and danger) */
  variant?: 'soft' | 'solid';
  size?: 'sm' | 'md';
  /** Leading icon (16px or smaller) */
  icon?: ReactNode;
  /** Leading dot, for status indicators */
  dot?: boolean;
  /** rounded: tag (--radius-sm, default) / pill: capsule */
  shape?: 'rounded' | 'pill';
}

/** Read-only status/category marker. */
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
  /** Selectable filter tag (aria-pressed) */
  selected?: boolean;
  icon?: ReactNode;
  /** When provided, shows a remove button */
  onRemove?: () => void;
  /** Only for forcing states on the preview page */
  forceState?: 'hover' | 'active' | 'focus';
}

/** Interactive pill tag: filter criteria, selected items. */
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
