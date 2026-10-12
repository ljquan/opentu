import { useEffect, useRef, useState } from 'react';

export function useMediaIntersection<T extends HTMLElement = HTMLDivElement>() {
    const ref = useRef<T>(null);
    const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
    useEffect(() => {
        if (!ref.current || typeof IntersectionObserver === 'undefined') return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const observer = new IntersectionObserver(entries => {
            if (timer) clearTimeout(timer);
            if (entries.some(entry => entry.isIntersecting)) setVisible(true);
            else timer = setTimeout(() => setVisible(false), 2000);
        }, { rootMargin: '200px' });
        observer.observe(ref.current);
        return () => { observer.disconnect(); if (timer) clearTimeout(timer); };
    }, []);
    return { ref, visible };
}
