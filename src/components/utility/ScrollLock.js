"use client";

import { useEffect } from 'react';

let lockCount = 0;
let originalStyle = '';

export default function ScrollLock() {
    useEffect(() => {
        if (lockCount === 0) {
            originalStyle = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
        }
        lockCount++;

        return () => {
            lockCount--;
            if (lockCount === 0) {
                document.body.style.overflow = originalStyle;
            }
        };
    }, []);
    return null;
}
