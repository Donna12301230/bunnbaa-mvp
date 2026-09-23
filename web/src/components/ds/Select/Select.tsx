import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from '../_shared/cx';
import { Field, fieldDescribedBy, hasFieldError } from '../Field';
import { Spinner } from '../Spinner';
import './Select.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: ReactNode;
  helperText?: ReactNode;
  error?: ReactNode;
  /** 選項；也可以直接傳 <option> children */
  options?: SelectOption[];
  /** 未選取時顯示的提示文字 */
  placeholder?: string;
  leftIcon?: ReactNode;
  /** 選項載入中：顯示 spinner 並停用 */
  loading?: boolean;
  size?: 'md' | 'lg';
  containerClassName?: string;
  /** 僅供預覽頁強制呈現狀態 */
  forceState?: 'hover' | 'focus';
}

/** 原生 <select> 客製外觀：保留手機原生選單與鍵盤行為。 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    id: idProp,
    label,
    helperText,
    error,
    options,
    placeholder,
    leftIcon,
    loading = false,
    size = 'md',
    disabled,
    required,
    containerClassName,
    className,
    forceState,
    children,
    value,
    defaultValue,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const invalid = hasFieldError(error);
  const isDisabled = disabled || loading;
  // 有 placeholder、非受控且沒給 defaultValue 時，預設停在 placeholder
  const initial = value === undefined && defaultValue === undefined && placeholder ? '' : defaultValue;

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
          isDisabled && 'is-disabled',
          forceState && `is-${forceState}`,
        )}
      >
        {leftIcon && (
          <span className="bb-control__icon bb-control__icon--lead" aria-hidden="true">
            {leftIcon}
          </span>
        )}
        <select
          ref={ref}
          id={id}
          disabled={isDisabled}
          required={required}
          value={value}
          defaultValue={initial}
          aria-invalid={invalid || undefined}
          aria-busy={loading || undefined}
          aria-describedby={fieldDescribedBy(id, !!helperText, invalid)}
          className={cx('bb-control__native', 'bb-select__native', className)}
          {...rest}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options?.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
          {children}
        </select>
        <span className="bb-control__icon bb-select__chevron" aria-hidden="true">
          {loading ? <Spinner size={16} label={null} /> : <ChevronDown size={20} />}
        </span>
      </div>
    </Field>
  );
});
