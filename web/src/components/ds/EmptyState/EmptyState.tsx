import type { HTMLAttributes, ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cx } from '../_shared/cx';
import './EmptyState.css';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** 插圖位置：傳入 <img> / SVG；未提供時顯示預設 icon 圓底 */
  illustration?: ReactNode;
  /** 未提供 illustration 時使用的 icon，預設 Inbox */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** 主要行動（通常是一個 Button） */
  action?: ReactNode;
  /** 次要行動（例如 text 按鈕） */
  secondaryAction?: ReactNode;
  /** compact：放在卡片或列表內；default：整頁空狀態 */
  size?: 'compact' | 'default';
}

export function EmptyState({
  illustration,
  icon,
  title,
  description,
  action,
  secondaryAction,
  size = 'default',
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div {...rest} className={cx('bb-empty', `bb-empty--${size}`, className)}>
      <div className="bb-empty__art" aria-hidden="true">
        {illustration ?? <span className="bb-empty__icon">{icon ?? <Inbox size={32} />}</span>}
      </div>
      <h3 className="bb-empty__title">{title}</h3>
      {description && <p className="bb-empty__desc">{description}</p>}
      {(action || secondaryAction) && (
        <div className="bb-empty__actions">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
