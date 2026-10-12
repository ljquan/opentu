import { useEffect, useState, type RefObject } from 'react';

export function useMediaVisibility(
  ref: RefObject<HTMLElement>,
  pinned = false,
  source = ''
) {
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === 'undefined'
  );

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (releaseTimer) clearTimeout(releaseTimer);
        if (entry.isIntersecting) setVisible(true);
        else releaseTimer = setTimeout(() => setVisible(false), 2000);
      },
      { rootMargin: '200px' }
    );
    observer.observe(element.closest('foreignObject') || element);
    return () => {
      observer.disconnect();
      if (releaseTimer) clearTimeout(releaseTimer);
    };
  }, [ref, source]);

  return pinned || visible;
}
