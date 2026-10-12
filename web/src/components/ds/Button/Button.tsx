import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../_shared/cx';
import { Spinner } from '../Spinner';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'text' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: orange with white text (main action), secondary: light orange, outline, text, danger. Default primary */
  variant?: ButtonVariant;
  /** sm 36px / md 44px / lg 52px. sm automatically enlarges the hit area to 44px. Default md */
  size?: ButtonSize;
  /** Icon before the text (lucide-react component) */
  leftIcon?: ReactNode;
  /** Icon after the text */
  rightIcon?: ReactNode;
  /** Square icon-only button: put the icon in children and always provide aria-label */
  iconOnly?: boolean;
  /** Loading: shows a spinner, blocks clicks, and sets aria-busy */
  loading?: boolean;
  /** Fill the parent's width */
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
