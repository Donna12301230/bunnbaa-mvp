import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { cx } from '../_shared/cx';
import { useControllableState } from '../_shared/useControllableState';
import '../Checkbox/Checkbox.css';
import './Radio.css';

interface RadioGroupContextValue {
  name: string;
  value: string | undefined;
  disabled?: boolean;
  setValue: (v: string) => void;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size' | 'value'> {
  value: string;
  label?: ReactNode;
  description?: ReactNode;
  /** Only for forcing states on the preview page */
  forceState?: 'hover' | 'focus';
}

/** Single radio option. Inside a <RadioGroup>, name / checked / onChange are managed by the group. */
export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { value, label, description, disabled, className, forceState, checked, onChange, name, ...rest },
  ref,
) {
  const group = useContext(RadioGroupContext);
  const isDisabled = disabled || group?.disabled;

  return (
    <label
      className={cx('bb-choice', 'bb-radio', isDisabled && 'is-disabled', forceState && `is-${forceState}`, className)}
    >
      <span className="bb-choice__control">
        <input
          ref={ref}
          type="radio"
          className="bb-choice__input"
          value={value}
          name={group?.name ?? name}
          checked={group ? group.value === value : checked}
          onChange={(e) => {
            group?.setValue(value);
            onChange?.(e);
          }}
          disabled={isDisabled}
          {...rest}
        />
        <span className="bb-choice__box bb-radio__box" aria-hidden="true" />
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

export interface RadioGroupProps {
  /** Group title (rendered as the <legend>) */
  label?: ReactNode;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  /** Layout direction, default vertical */
  orientation?: 'vertical' | 'horizontal';
  className?: string;
  children: ReactNode;
}

export function RadioGroup({
  label,
  name,
  value,
  defaultValue,
  onValueChange,
  disabled,
  orientation = 'vertical',
  className,
  children,
}: RadioGroupProps) {
  const autoName = useId();
  const [current, setCurrent] = useControllableState<string | undefined>(value, defaultValue, (v) => {
    if (v !== undefined) onValueChange?.(v);
  });

  return (
    <RadioGroupContext.Provider value={{ name: name ?? autoName, value: current, disabled, setValue: setCurrent }}>
      <fieldset className={cx('bb-radio-group', `bb-radio-group--${orientation}`, className)} disabled={disabled}>
        {label && <legend className="bb-radio-group__legend">{label}</legend>}
        <div className="bb-radio-group__items">{children}</div>
      </fieldset>
    </RadioGroupContext.Provider>
  );
}
