import { useEffect, useRef, useState } from "react";

// Fires once the first time the element scrolls into view (scrolling out again doesn't reset it). Used only for
// fade-in on enter; it's not for data loading, unlike continuous observers such as useIntersection.
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
