import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cx } from '../_shared/cx';
import { Field, fieldDescribedBy, hasFieldError } from '../Field';
import { Spinner } from '../Spinner';
import './Input.css';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: ReactNode;
  helperText?: ReactNode;
  /** 錯誤訊息；有值即顯示錯誤樣式並設 aria-invalid */
  error?: ReactNode;
  /** 欄位前的 icon */
  leftIcon?: ReactNode;
  /** 欄位尾端的自訂內容（單位等）；type="password" 時會改為眼睛切換鈕 */
  rightSlot?: ReactNode;
  /** 右側顯示 spinner（例如非同步驗證中） */
  loading?: boolean;
  /** md 44px（預設）/ lg 52px */
  size?: 'md' | 'lg';
  /** 外層（含 label）的 className；className 則套在 <input> */
  containerClassName?: string;
  /** 僅供預覽頁強制呈現狀態 */
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
            <Spinner size={16} label="驗證中" />
          </span>
        )}
        {isPassword ? (
          <button
            type="button"
            className="bb-input__reveal"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? '隱藏密碼' : '顯示密碼'}
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
