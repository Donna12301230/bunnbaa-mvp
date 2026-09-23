import { forwardRef, useId, useState, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cx } from '../_shared/cx';
import { Field, fieldDescribedBy, hasFieldError } from '../Field';
import { Spinner } from '../Spinner';
import './Textarea.css';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  helperText?: ReactNode;
  error?: ReactNode;
  /** 在 label 右側顯示「目前字數 / maxLength」 */
  showCount?: boolean;
  /** 右下角顯示 spinner（例如自動儲存中） */
  loading?: boolean;
  containerClassName?: string;
  /** 僅供預覽頁強制呈現狀態 */
  forceState?: 'hover' | 'focus';
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    id: idProp,
    label,
    helperText,
    error,
    showCount = false,
    loading = false,
    maxLength,
    rows = 4,
    disabled,
    required,
    containerClassName,
    className,
    forceState,
    value,
    defaultValue,
    onChange,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const invalid = hasFieldError(error);
  const [innerLength, setInnerLength] = useState(String(defaultValue ?? '').length);
  const length = value !== undefined ? String(value).length : innerLength;

  const counter = showCount ? (
    <span>
      {length}
      {maxLength ? ` / ${maxLength}` : ''}
    </span>
  ) : undefined;

  return (
    <Field
      id={id}
      label={label}
      helperText={helperText}
      error={error}
      required={required}
      aside={counter}
      className={containerClassName}
    >
      <div
        className={cx(
          'bb-control',
          'bb-control--textarea',
          invalid && 'is-invalid',
          disabled && 'is-disabled',
          forceState && `is-${forceState}`,
        )}
      >
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          maxLength={maxLength}
          disabled={disabled}
          required={required}
          value={value}
          defaultValue={defaultValue}
          onChange={(e) => {
            setInnerLength(e.target.value.length);
            onChange?.(e);
          }}
          aria-invalid={invalid || undefined}
          aria-describedby={fieldDescribedBy(id, !!helperText, invalid)}
          className={cx('bb-control__native', 'bb-textarea__native', className)}
          {...rest}
        />
        {loading && (
          <span className="bb-control__icon bb-textarea__spinner">
            <Spinner size={16} label="儲存中" />
          </span>
        )}
      </div>
    </Field>
  );
});
