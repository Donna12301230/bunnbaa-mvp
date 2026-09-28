import { tr } from '@/lib/i18n';
import { useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from '../_shared/cx';
import { usePresence } from '../_shared/usePresence';
import { useDialogBehavior } from '../_shared/useDialogBehavior';
import { Portal } from '../ThemeRoot';
import './Modal.css';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** 底部按鈕列；手機寬度會自動改為上下堆疊、撐滿 */
  footer?: ReactNode;
  /** sm 400 / md 520（預設）/ lg 720 */
  size?: 'sm' | 'md' | 'lg';
  /** 點遮罩是否關閉，預設 true；重要確認框建議關掉 */
  closeOnOverlay?: boolean;
  /** 隱藏右上角關閉鈕 */
  hideClose?: boolean;
  /** 送出中：關閉鈕與遮罩暫停作用 */
  loading?: boolean;
  className?: string;
}

const EXIT_MS = 200;

/** 置中對話框。桌機與平板使用；手機上較長的內容請改用 BottomSheet。 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnOverlay = true,
  hideClose = false,
  loading = false,
  className,
}: ModalProps) {
  const { mounted, visible } = usePresence(open, EXIT_MS);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const safeClose = () => {
    if (!loading) onClose();
  };
  // 等面板真的掛載後才啟用（聚焦、焦點鎖、捲動鎖）
  useDialogBehavior(panelRef, open && mounted, safeClose, !loading);

  if (!mounted) return null;

  return (
    <Portal>
      <div className="bb-modal" data-state={visible ? 'open' : 'closed'}>
        <div
          className="bb-modal__overlay"
          aria-hidden="true"
          onClick={closeOnOverlay ? safeClose : undefined}
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
          aria-busy={loading || undefined}
          tabIndex={-1}
          className={cx('bb-modal__panel', `bb-modal__panel--${size}`, className)}
        >
          <div className="bb-modal__header">
            <div className="bb-modal__titles">
              <h2 className="bb-modal__title" id={titleId}>
                {title}
              </h2>
              {description && (
                <p className="bb-modal__desc" id={descId}>
                  {description}
                </p>
              )}
            </div>
            {!hideClose && (
              <button
                type="button"
                className="bb-modal__close"
                onClick={safeClose}
                disabled={loading}
                aria-label={tr('關閉', 'Close')}
              >
                <X size={20} aria-hidden="true" />
              </button>
            )}
          </div>
          {children && <div className="bb-modal__body">{children}</div>}
          {footer && <div className="bb-modal__footer">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}
