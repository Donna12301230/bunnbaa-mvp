import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let scrollLocks = 0;

/**
 * Behavior shared by Modal / BottomSheet:
 * Esc closes, Tab focus is trapped in the panel, the panel is focused on open, focus is restored on close, body scroll is locked.
 */
export function useDialogBehavior(
  panelRef: RefObject<HTMLElement>,
  open: boolean,
  onClose: () => void,
  closeOnEsc = true,
) {
  // Keep the latest callback in a ref so the effect doesn't rerun (and steal focus) when the parent creates a new function each render
  const onCloseRef = useRef(onClose);
  const closeOnEscRef = useRef(closeOnEsc);
  onCloseRef.current = onClose;
  closeOnEscRef.current = closeOnEsc;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Defer focusing until after commit: the portal container may be removed and remounted within one commit (StrictMode), which loses focus
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
