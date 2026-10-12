import { tr } from '@/lib/i18n';
import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cx } from '../_shared/cx';
import { Field, fieldDescribedBy, hasFieldError } from '../Field';
import { Spinner } from '../Spinner';
import './Input.css';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: ReactNode;
  helperText?: ReactNode;
  /** Error message; any value shows the error style and sets aria-invalid */
  error?: ReactNode;
  /** Icon before the field */
  leftIcon?: ReactNode;
  /** Custom content at the end of the field (units, etc.); becomes the eye toggle when type="password" */
  rightSlot?: ReactNode;
  /** Show a spinner on the right (e.g. during async validation) */
  loading?: boolean;
  /** md 44px (default) / lg 52px */
  size?: 'md' | 'lg';
  /** className for the wrapper (including the label); className goes on the <input> */
  containerClassName?: string;
  /** Only for forcing states on the preview page */
  forceState?: 'hover' | 'focus';
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    id: idProp,
    label,
    helperText,
    error,
    leftIcon,
    rightSlot,
    loading = false,
    size = 'md',
    type = 'text',
    disabled,
    required,
    containerClassName,
    className,
    forceState,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const invalid = hasFieldError(error);
  const [reveal, setReveal] = useState(false);
  const isPassword = type === 'password';

  return (
    <Field
      id={id}
      label={label}
      helperText={helperText}
      error={error}
      required={required}
      className={containerClassName}
    >
      <div
        className={cx(
          'bb-control',
          `bb-control--${size}`,
          invalid && 'is-invalid',
          disabled && 'is-disabled',
          forceState && `is-${forceState}`,
        )}
      >
        {leftIcon && (
          <span className="bb-control__icon bb-control__icon--lead" aria-hidden="true">
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          id={id}
          type={isPassword && reveal ? 'text' : type}
          disabled={disabled}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={fieldDescribedBy(id, !!helperText, invalid)}
          className={cx('bb-control__native', className)}
          {...rest}
        />
        {loading && (
          <span className="bb-control__icon">
            <Spinner size={16} label={tr('驗證中', 'Validating')} />
          </span>
        )}
        {isPassword ? (
          <button
            type="button"
            className="bb-input__reveal"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? tr('隱藏密碼', 'Hide password') : tr('顯示密碼', 'Show password')}
            aria-pressed={reveal}
            aria-controls={id}
            disabled={disabled}
          >
            {reveal ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
          </button>
        ) : (
          rightSlot && <span className="bb-input__right">{rightSlot}</span>
        )}
      </div>
    </Field>
  );
});
