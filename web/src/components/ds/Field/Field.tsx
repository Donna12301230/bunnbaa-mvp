import type { ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { cx } from '../_shared/cx';
import './Field.css';

export interface FieldProps {
  /** id of the associated control (the label's htmlFor) */
  id: string;
  label?: ReactNode;
  /** Helper text; replaced by the error message when there is an error */
  helperText?: ReactNode;
  /** Error message; any value means the error state */
  error?: ReactNode;
  required?: boolean;
  /** Note in the top-right corner, e.g. a character count */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function hasFieldError(error: ReactNode): boolean {
  return error != null && error !== false && error !== '';
}

/** id the control uses for aria-describedby */
export function fieldDescribedBy(id: string, hasHelper: boolean, hasError: boolean): string | undefined {
  if (hasError) return `${id}-error`;
  if (hasHelper) return `${id}-helper`;
  return undefined;
}

/** Form field frame: label + control + helper / error. Shared by Input, Select and Textarea. */
export function Field({ id, label, helperText, error, required, aside, className, children }: FieldProps) {
  return (
    <div className={cx('bb-field', className)}>
      {(label || aside) && (
        <div className="bb-field__top">
          {label && (
            <label className="bb-field__label" htmlFor={id}>
              {label}
              {required && (
                <span className="bb-field__required" aria-hidden="true">
                  *
                </span>
              )}
            </label>
          )}
          {aside && <span className="bb-field__aside">{aside}</span>}
        </div>
      )}
      {children}
      {hasFieldError(error) ? (
        <p className="bb-field__message bb-field__message--error" id={`${id}-error`}>
          <CircleAlert size={14} aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : (
        helperText && (
          <p className="bb-field__message" id={`${id}-helper`}>
            {helperText}
          </p>
        )
      )}
    </div>
  );
}
