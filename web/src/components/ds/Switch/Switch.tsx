import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../_shared/cx';
import { useControllableState } from '../_shared/useControllableState';
import { Spinner } from '../Spinner';
import './Switch.css';

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value' | 'defaultValue'> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  /** 切換中（例如等待 API 回應）：thumb 顯示 spinner、暫停互動 */
  loading?: boolean;
  /** label 放左側（設定頁常見）或右側（預設） */
  labelPosition?: 'start' | 'end';
  /** 僅供預覽頁強制呈現狀態 */
  forceState?: 'hover' | 'focus' | 'active';
}

/** 即時生效的開關（role="switch"）。需要送出才生效的選項請改用 Checkbox。 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  {
    id: idProp,
    checked,
    defaultChecked = false,
    onCheckedChange,
    label,
    description,
    loading = false,
    labelPosition = 'end',
    disabled,
    className,
    forceState,
    onClick,
    ...rest
  },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const [on, setOn] = useControllableState(checked, defaultChecked, onCheckedChange);
  const isDisabled = disabled || loading;

  return (
    <div
      className={cx(
        'bb-switch',
        labelPosition === 'start' && 'bb-switch--label-start',
        isDisabled && 'is-disabled',
        loading && 'is-loading',
        forceState && `is-${forceState}`,
        className,
      )}
    >
      <button
        ref={ref}
        id={id}
        type="button"
        role="switch"
        aria-checked={on}
        aria-busy={loading || undefined}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={isDisabled}
        className="bb-switch__track"
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) setOn(!on);
        }}
        {...rest}
      >
        <span className="bb-switch__thumb">{loading && <Spinner size={16} label={null} />}</span>
      </button>
      {(label || description) && (
        <span className="bb-switch__text">
          {label && (
            <label className="bb-switch__label" htmlFor={id}>
              {label}
            </label>
          )}
          {description && (
            <span className="bb-switch__desc" id={`${id}-desc`}>
              {description}
            </span>
          )}
        </span>
      )}
    </div>
  );
});
