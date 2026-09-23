import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../_shared/cx';
import { Spinner } from '../Spinner';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'text' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary 橘底白字（主行動）、secondary 淡橘底、outline、text、danger。預設 primary */
  variant?: ButtonVariant;
  /** sm 36px / md 44px / lg 52px。sm 會自動擴大點擊區至 44px。預設 md */
  size?: ButtonSize;
  /** 文字前的 icon（lucide-react 元件） */
  leftIcon?: ReactNode;
  /** 文字後的 icon */
  rightIcon?: ReactNode;
  /** 只放 icon 的正方形按鈕：icon 放在 children，務必同時提供 aria-label */
  iconOnly?: boolean;
  /** 載入中：顯示 spinner、禁止點擊，並設 aria-busy */
  loading?: boolean;
  /** 撐滿父容器寬度 */
  fullWidth?: boolean;
}

const ICON_SIZE: Record<ButtonSize, 16 | 20> = { sm: 16, md: 20, lg: 20 };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    leftIcon,
    rightIcon,
    iconOnly = false,
    loading = false,
    fullWidth = false,
    disabled,
    type = 'button',
    className,
    children,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cx(
        'bb-btn',
        `bb-btn--${variant}`,
        `bb-btn--${size}`,
        iconOnly && 'bb-btn--icon-only',
        fullWidth && 'bb-btn--full',
        loading && 'is-loading',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Spinner size={ICON_SIZE[size]} label={null} />
      ) : (
        leftIcon && <span className="bb-btn__icon" aria-hidden="true">{leftIcon}</span>
      )}
      {iconOnly
        ? !loading && (
            <span className="bb-btn__icon" aria-hidden="true">
              {children}
            </span>
          )
        : children != null && <span className="bb-btn__label">{children}</span>}
      {!loading && rightIcon && <span className="bb-btn__icon" aria-hidden="true">{rightIcon}</span>}
    </button>
  );
});
