import { forwardRef, useEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check, Minus } from 'lucide-react';
import { cx } from '../_shared/cx';
import { mergeRefs } from '../_shared/mergeRefs';
import './Checkbox.css';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: ReactNode;
  /** label 下方的補充說明 */
  description?: ReactNode;
  /** 半選（例如「全選」底下只勾了部分） */
  indeterminate?: boolean;
  /** 錯誤狀態（例如必須同意條款） */
  invalid?: boolean;
  /** 僅供預覽頁強制呈現狀態 */
  forceState?: 'hover' | 'focus';
}

/** 原生 checkbox + 自訂外觀；整列 label 皆可點，高度至少 44px。 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, indeterminate = false, invalid = false, disabled, className, forceState, ...rest },
  ref,
) {
  const innerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label
      className={cx(
        'bb-choice',
        'bb-check',
        disabled && 'is-disabled',
        invalid && 'is-invalid',
        forceState && `is-${forceState}`,
        className,
      )}
    >
      <span className="bb-choice__control">
        <input
          ref={mergeRefs(ref, innerRef)}
          type="checkbox"
          className="bb-choice__input"
          disabled={disabled}
          aria-invalid={invalid || undefined}
          {...rest}
        />
        <span className="bb-choice__box bb-check__box" aria-hidden="true">
          <Check className="bb-check__icon bb-check__icon--check" size={14} />
          <Minus className="bb-check__icon bb-check__icon--minus" size={14} />
        </span>
      </span>
      {(label || description) && (
        <span className="bb-choice__text">
          {label && <span className="bb-choice__label">{label}</span>}
          {description && <span className="bb-choice__desc">{description}</span>}
        </span>
      )}
    </label>
  );
});
