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
  /** 提示內容：簡短文字，不放互動元素 */
  content: ReactNode;
  /** 觸發元素：必須是可聚焦的單一元素（Button、icon 按鈕等） */
  children: ReactElement;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  /** 滑鼠停留多久後出現（ms），預設 300；鍵盤聚焦立即出現 */
  delay?: number;
  /** 強制顯示（預覽頁用），或完全受控 */
  open?: boolean;
  className?: string;
}

/**
 * 補充說明用的小提示：hover / focus 顯示，Esc 關閉。
 * 手機沒有 hover，重要資訊不要只放在 Tooltip。
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

  // 一律掛上 aria-describedby：焦點進入時螢幕閱讀器就能讀到，不必等 state 更新
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
