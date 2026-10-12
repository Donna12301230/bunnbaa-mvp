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
  /** Options; <option> children can also be passed directly */
  options?: SelectOption[];
  /** Hint text shown when nothing is selected */
  placeholder?: string;
  leftIcon?: ReactNode;
  /** Options loading: shows a spinner and disables the select */
  loading?: boolean;
  size?: 'md' | 'lg';
  containerClassName?: string;
  /** Only for forcing states on the preview page */
  forceState?: 'hover' | 'focus';
}

/** Native <select> with a custom look: keeps the native mobile picker and keyboard behavior. */
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
  // With a placeholder, uncontrolled and no defaultValue, start on the placeholder
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
