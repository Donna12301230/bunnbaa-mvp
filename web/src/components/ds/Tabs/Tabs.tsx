import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../_shared/cx';
import { useControllableState } from '../_shared/useControllableState';
import './Tabs.css';

export interface TabItem {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Tabs share the width equally and fill the container (as in the login page's "Sign in / Sign up") */
  fullWidth?: boolean;
  size?: 'md' | 'lg';
  /** Accessible name of the segmented control, e.g. "Sign-in method" */
  'aria-label'?: string;
  /**
   * id prefix of the matching panels. When set, each tab gets aria-controls=`${idPrefix}-panel-${value}`;
   * give the panel the same id, role="tabpanel" and aria-labelledby=`${idPrefix}-tab-${value}`.
   */
  idPrefix?: string;
  /** Disable the whole group (e.g. while submitting) */
  disabled?: boolean;
  className?: string;
  /** Preview page only: force a given tab into hover / focus */
  forceState?: { value: string; state: 'hover' | 'focus' };
}

/**
 * Pill-style segmented control: light gray container + white selected indicator that slides.
 * Keyboard: ← → to switch, Home / End to jump to the ends (automatic activation).
 */
export function Tabs({
  items,
  value,
  defaultValue,
  onValueChange,
  fullWidth = false,
  size = 'md',
  idPrefix: idPrefixProp,
  disabled = false,
  className,
  forceState,
  ...aria
}: TabsProps) {
  const autoId = useId();
  const idPrefix = idPrefixProp ?? autoId;
  const [current, setCurrent] = useControllableState(value, defaultValue ?? items[0]?.value ?? '', onValueChange);
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = tabRefs.current.get(current);
      if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (listRef.current) ro.observe(listRef.current);
    return () => ro.disconnect();
  }, [current, items]);

  const enabled = items.filter((i) => !i.disabled);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const idx = enabled.findIndex((i) => i.value === current);
    let next: TabItem | undefined;
    if (e.key === 'ArrowRight') next = enabled[(idx + 1) % enabled.length];
    else if (e.key === 'ArrowLeft') next = enabled[(idx - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    setCurrent(next.value);
    tabRefs.current.get(next.value)?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={aria['aria-label']}
      aria-disabled={disabled || undefined}
      className={cx(
        'bb-tabs',
        `bb-tabs--${size}`,
        fullWidth && 'bb-tabs--full',
        disabled && 'is-disabled',
        className,
      )}
      onKeyDown={onKeyDown}
    >
      {indicator && (
        <span
          className="bb-tabs__indicator"
          aria-hidden="true"
          style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
        />
      )}
      {items.map((item) => {
        const selected = item.value === current;
        return (
          <button
            key={item.value}
            ref={(el) => {
              if (el) tabRefs.current.set(item.value, el);
              else tabRefs.current.delete(item.value);
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${item.value}`}
            aria-selected={selected}
            aria-controls={idPrefixProp ? `${idPrefix}-panel-${item.value}` : undefined}
            tabIndex={selected ? 0 : -1}
            disabled={disabled || item.disabled}
            className={cx(
              'bb-tabs__tab',
              forceState?.value === item.value && `is-${forceState.state}`,
            )}
            onClick={() => setCurrent(item.value)}
          >
            {item.icon && (
              <span className="bb-tabs__icon" aria-hidden="true">
                {item.icon}
              </span>
            )}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
