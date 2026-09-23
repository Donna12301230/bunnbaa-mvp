import { useEffect, useState } from 'react';

/**
 * 讓元件在 open → false 後仍掛載 exitMs，以播放離場動畫。
 * 回傳 mounted（是否渲染）與 visible（是否處於「進場後」狀態，用於 data-state）。
 */
export function usePresence(open: boolean, exitMs: number) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // 下一幀才切 visible，確保進場 transition 有起點
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const t = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(t);
  }, [open, exitMs]);

  return { mounted, visible };
}
