import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let scrollLocks = 0;

/**
 * Modal / BottomSheet 共用行為：
 * Esc 關閉、Tab 焦點鎖在面板內、開啟時聚焦面板、關閉後還原焦點、鎖定 body 捲動。
 */
export function useDialogBehavior(
  panelRef: RefObject<HTMLElement>,
  open: boolean,
  onClose: () => void,
  closeOnEsc = true,
) {
  // 以 ref 保存最新的 callback，避免父層每次 render 產生新函式時重跑 effect（會搶焦點）
  const onCloseRef = useRef(onClose);
  const closeOnEscRef = useRef(closeOnEsc);
  onCloseRef.current = onClose;
  closeOnEscRef.current = closeOnEsc;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // 延到 commit 之後再聚焦：Portal 容器在同一個 commit 內可能被移除再掛回（StrictMode），會把焦點弄丟
    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel;
      first?.focus({ preventScroll: true });
    });

    scrollLocks += 1;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && closeOnEscRef.current) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = nodes[0];
      const lastEl = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === firstEl || document.activeElement === panelRef.current)) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      scrollLocks -= 1;
      if (scrollLocks === 0) document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [open, panelRef]);
}
