import { tr } from '@/lib/i18n';
import { useId, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from '../_shared/cx';
import { usePresence } from '../_shared/usePresence';
import { useDialogBehavior } from '../_shared/useDialogBehavior';
import { Portal } from '../ThemeRoot';
import '../Modal/Modal.css'; // 共用 .bb-modal__close
import './BottomSheet.css';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** 固定在底部的按鈕列（會自動加上 safe-area 內距） */
  footer?: ReactNode;
  /** 拖曳把手往下拉超過此距離（px）即關閉，預設 96 */
  dismissThreshold?: number;
  closeOnOverlay?: boolean;
  /** 送出中：暫停關閉 */
  loading?: boolean;
  className?: string;
}

const EXIT_MS = 320;

/** 手機用底部抽屜：從下方滑出，可拖曳把手下拉關閉。≥768px 時置中且限制寬度。 */
export function BottomSheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissThreshold = 96,
  closeOnOverlay = true,
  loading = false,
  className,
}: BottomSheetProps) {
  const { mounted, visible } = usePresence(open, EXIT_MS);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const drag = useRef<{ startY: number; pointerId: number } | null>(null);
  const [dragY, setDragY] = useState(0);

  const safeClose = () => {
    if (!loading) onClose();
  };
  // 等面板真的掛載後才啟用（聚焦、焦點鎖、捲動鎖）
  useDialogBehavior(panelRef, open && mounted, safeClose, !loading);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (loading) return;
    drag.current = { startY: e.clientY, pointerId: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    setDragY(Math.max(0, e.clientY - drag.current.startY));
  }
  function onPointerUp() {
    if (!drag.current) return;
    drag.current = null;
    if (dragY > dismissThreshold) safeClose();
    setDragY(0);
  }

  if (!mounted) return null;

  return (
    <Portal>
      <div className="bb-sheet" data-state={visible ? 'open' : 'closed'}>
        <div
          className="bb-sheet__overlay"
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
          className={cx('bb-sheet__panel', dragY > 0 && 'is-dragging', className)}
          style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
        >
          <div
            className="bb-sheet__handle-area"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            aria-hidden="true"
          >
            <span className="bb-sheet__handle" />
          </div>
          <div className="bb-sheet__header">
            <div className="bb-sheet__titles">
              <h2 className="bb-sheet__title" id={titleId}>
                {title}
              </h2>
              {description && (
                <p className="bb-sheet__desc" id={descId}>
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              className="bb-modal__close bb-sheet__close"
              onClick={safeClose}
              disabled={loading}
              aria-label={tr('關閉', 'Close')}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          {children && <div className="bb-sheet__body">{children}</div>}
          {footer && <div className="bb-sheet__footer">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}
