import { tr } from '@/lib/i18n';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { cx } from '../_shared/cx';
import { Portal } from '../ThemeRoot';
import './Toast.css';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface ToastOptions {
  tone?: ToastTone;
  title: ReactNode;
  description?: ReactNode;
  /** Action button, e.g. "Undo" */
  action?: { label: string; onClick: () => void };
  /** Milliseconds; 0 = don't auto-dismiss. Default 4000, 6000 for error */
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  id: number;
  leaving?: boolean;
}

const ICONS: Record<ToastTone, typeof Info> = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
  warning: TriangleAlert,
};

export interface ToastProps extends ToastOptions {
  onClose?: () => void;
  /** Playing the exit animation */
  leaving?: boolean;
  /** Pausing the timer on hover is handled by the Provider; this prop is for static display on the preview page */
  className?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

/** Look of a single notification. Normally use useToast(); this component is mainly for the preview page and customization. */
export function Toast({
  tone = 'info',
  title,
  description,
  action,
  onClose,
  leaving,
  className,
  onMouseEnter,
  onMouseLeave,
}: ToastProps) {
  const Icon = ICONS[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={cx('bb-toast', `bb-toast--${tone}`, leaving && 'is-leaving', className)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <span className="bb-toast__icon" aria-hidden="true">
        <Icon size={20} />
      </span>
      <div className="bb-toast__content">
        <p className="bb-toast__title">{title}</p>
        {description && <p className="bb-toast__desc">{description}</p>}
      </div>
      {action && (
        <button
          type="button"
          className="bb-toast__action"
          onClick={() => {
            action.onClick();
            onClose?.();
          }}
        >
          {action.label}
        </button>
      )}
      {onClose && (
        <button type="button" className="bb-toast__close" onClick={onClose} aria-label={tr('關閉通知', 'Dismiss notification')}>
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

interface ToastContextValue {
  toast: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Show a notification: const { toast } = useToast(); toast({ tone: 'success', title: 'Added to cart' }) */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast() 必須在 <ToastProvider> 之內使用');
  return ctx;
}

const LEAVE_MS = 200;

function ToastItem({ record, onDismiss }: { record: ToastRecord; onDismiss: (id: number) => void }) {
  const duration = record.duration ?? (record.tone === 'error' ? 6000 : 4000);
  const timer = useRef<number>();
  const remaining = useRef(duration);
  const startedAt = useRef(0);

  const start = useCallback(() => {
    if (duration <= 0) return;
    startedAt.current = Date.now();
    timer.current = window.setTimeout(() => onDismiss(record.id), remaining.current);
  }, [duration, onDismiss, record.id]);

  const pause = useCallback(() => {
    window.clearTimeout(timer.current);
    remaining.current -= Date.now() - startedAt.current;
  }, []);

  useEffect(() => {
    start();
    return () => window.clearTimeout(timer.current);
  }, [start]);

  return (
    <Toast
      {...record}
      onClose={() => onDismiss(record.id)}
      onMouseEnter={pause}
      onMouseLeave={start}
    />
  );
}

export interface ToastProviderProps {
  children: ReactNode;
  /** Maximum number shown at once, default 3 */
  max?: number;
}

/** Place inside <ThemeRoot>. Shown top-center on mobile, bottom-right at ≥768px. */
export function ToastProvider({ children, max = 3 }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), LEAVE_MS);
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      setToasts((list) => [...list, { ...options, id }].slice(-max));
      return id;
    },
    [max],
  );

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Portal>
        <div className="bb-toast-viewport">
          {toasts.map((t) => (
            <ToastItem key={t.id} record={t} onDismiss={dismiss} />
          ))}
        </div>
      </Portal>
    </ToastContext.Provider>
  );
}
