import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cx } from '../_shared/cx';
import './Tooltip.css';

export interface TooltipProps {
  /** Tooltip content: short text, no interactive elements */
  content: ReactNode;
  /** Trigger element: must be a single focusable element (Button, icon button, etc.) */
  children: ReactElement;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** Hover delay before showing (ms), default 300; keyboard focus shows it immediately */
  delay?: number;
  /** Force it open (for the preview page), or fully controlled */
  open?: boolean;
  className?: string;
}

/**
 * Small hint for supplementary info: shown on hover / focus, closed with Esc.
 * Phones have no hover, so don't put important information only in a Tooltip.
 */
export function Tooltip({ content, children, placement = 'top', delay = 300, open, className }: TooltipProps) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const timer = useRef<number>();
  const visible = open ?? shown;

  const show = (immediate = false) => {
    window.clearTimeout(timer.current);
    if (immediate) setShown(true);
    else timer.current = window.setTimeout(() => setShown(true), delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setShown(false);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible]);

  // Always set aria-describedby: screen readers can read it as soon as focus enters, without waiting for a state update
  const trigger = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, { 'aria-describedby': id })
    : children;

  return (
    <span
      className={cx('bb-tooltip', className)}
      onMouseEnter={() => show()}
      onMouseLeave={hide}
      onFocus={() => show(true)}
      onBlur={hide}
    >
      {trigger}
      <span
        role="tooltip"
        id={id}
        className={cx('bb-tooltip__bubble', `bb-tooltip__bubble--${placement}`)}
        data-state={visible ? 'open' : 'closed'}
      >
        {content}
      </span>
    </span>
  );
}
