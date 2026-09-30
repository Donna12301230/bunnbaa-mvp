import { useEffect, useRef, useState } from "react";

// 元素第一次捲進可視範圍就觸發一次（之後捲出畫面也不會復原），純粹拿來做
// 「進場淡入」用；不是資料載入判斷，跟 useIntersection 之類的無限監聽不同。
export function useInView<T extends HTMLElement>(options?: IntersectionObserverInit) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        io.disconnect();
      }
    }, { threshold: 0.15, ...options });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, inView };
}
