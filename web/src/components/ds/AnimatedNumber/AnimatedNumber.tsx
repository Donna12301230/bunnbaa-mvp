import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../_shared/cx';
import './AnimatedNumber.css';

export interface AnimatedNumberProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'prefix'> {
  value: number;
  /** roll: digits roll to the new value (prices, totals); fade: the new value fades in (discounts, countdowns) */
  animation?: 'roll' | 'fade';
  /** Roll duration (ms), default 600 */
  duration?: number;
  /** Display format, default integer with thousands separators */
  format?: (n: number) => string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  /** Whether screen readers announce value changes (aria-live="polite") */
  announce?: boolean;
}

const defaultFormat = (n: number) => Math.round(n).toLocaleString('zh-TW');

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Prices, discounts, countdowns and other numbers: tabular-nums + change animation; respects prefers-reduced-motion. */
export function AnimatedNumber({
  value,
  animation = 'roll',
  duration = 600,
  format = defaultFormat,
  prefix,
  suffix,
  announce = false,
  className,
  ...rest
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(value);
  const [fadeKey, setFadeKey] = useState(0);
  // Value currently on screen: if a new value arrives mid-animation, keep rolling from here instead of jumping back
  const shownRef = useRef(value);
  const frame = useRef<number>();

  useEffect(() => {
    const from = shownRef.current;
    if (from === value) return;

    if (animation === 'fade' || prefersReducedMotion()) {
      shownRef.current = value;
      setDisplay(value);
      if (animation === 'fade') setFadeKey((k) => k + 1);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic, soft finish
      shownRef.current = from + (value - from) * eased;
      setDisplay(shownRef.current);
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [value, animation, duration]);

  return (
    <span {...rest} className={cx('bb-anum', className)}>
      <span aria-hidden="true" key={fadeKey} className={cx('bb-anum__value', fadeKey > 0 && 'is-fading')}>
        {prefix}
        {format(display)}
        {suffix}
      </span>
      <span className="bb-sr-only" aria-live={announce ? 'polite' : undefined}>
        {prefix}
        {format(value)}
        {suffix}
      </span>
    </span>
  );
}
