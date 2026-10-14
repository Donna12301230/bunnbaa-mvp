import { useEffect, useState } from 'react';

/**
 * Keeps the component mounted for exitMs after open becomes false so the exit animation can play.
 * Returns mounted (whether to render) and visible (whether it is in the "entered" state, used for data-state).
 */
export function usePresence(open: boolean, exitMs: number) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Switch visible on the next frame so the enter transition has a starting point
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const t = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(t);
  }, [open, exitMs]);

  return { mounted, visible };
}
