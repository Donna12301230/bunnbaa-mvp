import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../_shared/cx';
import './AnimatedNumber.css';

export interface AnimatedNumberProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'prefix'> {
  value: number;
  /** roll：數字滾動到新值（價格、累計）；fade：淡入新值（折扣、倒數） */
  animation?: 'roll' | 'fade';
  /** 滾動時長（ms），預設 600 */
  duration?: number;
  /** 顯示格式，預設千分位整數 */
  format?: (n: number) => string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  /** 值改變時是否讓螢幕閱讀器朗讀（aria-live="polite"） */
  announce?: boolean;
}

const defaultFormat = (n: number) => Math.round(n).toLocaleString('zh-TW');

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 價格、折扣、倒數等數字：tabular-nums + 變化動畫；尊重 prefers-reduced-motion。 */
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
  // 目前畫面上的值：動畫中途收到新值時，從這裡接續滾動而非跳回
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
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic，收尾柔和
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
