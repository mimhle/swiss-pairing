'use client';

import { useCallback, useEffect, useState } from 'react';

export default function useElementSize() {
    const [element, setElement] = useState(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const ref = useCallback(node => {
        setElement(node);
    }, []);

    useEffect(() => {
        if (!element) return undefined;

        const update = () => {
            const rect = element.getBoundingClientRect();
            setSize(previous => (
                Math.abs(previous.width - rect.width) < 0.5 && Math.abs(previous.height - rect.height) < 0.5
                    ? previous
                    : { width: rect.width, height: rect.height }
            ));
        };

        update();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', update);
            return () => window.removeEventListener('resize', update);
        }

        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    }, [element]);

    return [ref, size];
}
