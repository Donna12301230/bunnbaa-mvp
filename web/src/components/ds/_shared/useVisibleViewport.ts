import { useEffect, useState } from 'react';

/**
 * While the on-screen keyboard covers part of the page, returns the visible area (top/height in px) so a fixed
 * overlay can fit into it; otherwise null. iOS Safari and Android Chrome 108+ don't shrink the layout viewport
 * for the keyboard, so a bottom-pinned input would sit behind it.
 */
export function useVisibleViewport(active: boolean) {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    const update = () => {
      // Pinch zoom also shrinks the visual viewport; only react at normal scale
      const covered = Math.abs(vv.scale - 1) < 0.01 && window.innerHeight - vv.height > 1;
      setBox(covered ? { top: vv.offsetTop, height: vv.height } : null);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      setBox(null);
    };
  }, [active]);

  return box;
}
