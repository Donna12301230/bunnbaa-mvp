import type { HTMLAttributes, ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cx } from '../_shared/cx';
import './EmptyState.css';

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Illustration slot: pass an <img> / SVG; without it a default icon on a circle is shown */
  illustration?: ReactNode;
  /** Icon used when no illustration is given, default Inbox */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Primary action (usually a Button) */
  action?: ReactNode;
  /** Secondary action (e.g. a text button) */
  secondaryAction?: ReactNode;
  /** compact: inside a card or list; default: full-page empty state */
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
