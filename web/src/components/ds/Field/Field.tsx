import type { ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { cx } from '../_shared/cx';
import './Field.css';

export interface FieldProps {
  /** 對應控制項的 id（label 的 htmlFor） */
  id: string;
  label?: ReactNode;
  /** 說明文字；有 error 時會被錯誤訊息取代 */
  helperText?: ReactNode;
  /** 錯誤訊息；有值即代表錯誤狀態 */
  error?: ReactNode;
  required?: boolean;
  /** 右上角附註，例如字數計數 */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function hasFieldError(error: ReactNode): boolean {
  return error != null && error !== false && error !== '';
}

/** 控制項用來串 aria-describedby 的 id */
export function fieldDescribedBy(id: string, hasHelper: boolean, hasError: boolean): string | undefined {
  if (hasError) return `${id}-error`;
  if (hasHelper) return `${id}-helper`;
  return undefined;
}

/** 表單欄位外框：label + 控制項 + helper / error。Input、Select、Textarea 共用。 */
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
