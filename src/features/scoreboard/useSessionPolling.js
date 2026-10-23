'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_INTERVAL = 2000;
const MAX_BACKOFF = 15000;

export default function useSessionPolling(sessionId) {
    const [session, setSession] = useState(null);
    const [status, setStatus] = useState('loading');
    const [error, setError] = useState('');
    const [lastSync, setLastSync] = useState(0);

    const timerRef = useRef(null);
    const abortRef = useRef(null);
    const mountedRef = useRef(false);
    const visibleRef = useRef(true);
    const attemptRef = useRef(0);
    const hasDataRef = useRef(false);
    const pollRef = useRef(null);

    const clearTimer = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const schedule = useCallback((delay) => {
        clearTimer();
        if (!mountedRef.current || !visibleRef.current) return;
        timerRef.current = setTimeout(() => {
            pollRef.current?.();
        }, delay);
    }, [clearTimer]);

    const poll = useCallback(async () => {
        if (!mountedRef.current || !visibleRef.current) return;

        if (!sessionId) {
            setStatus('closed');
            setError('No scoreboard session was provided.');
            return;
        }

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const response = await fetch(`/api/arbiter/session/${encodeURIComponent(sessionId)}?latest=1`, {
                cache: 'no-store',
                signal: controller.signal,
            });

            if (!response.ok) {
                if (response.status === 404) {
                    hasDataRef.current = false;
                    setStatus('closed');
                    setError('This scoreboard session has ended.');
                    clearTimer();
                    return;
                }

                let message = 'Could not reach the live scoring data.';
                try {
                    const body = await response.json();
                    if (body?.error) message = body.error;
                } catch (_) {
                    // Keep the generic message.
                }

                setError(message);
                setStatus(hasDataRef.current ? 'reconnecting' : 'error');
                attemptRef.current += 1;
                schedule(Math.min(MAX_BACKOFF, POLL_INTERVAL * (2 ** Math.min(attemptRef.current, 3))));
                return;
            }

            let data = await response.json();
            if (typeof data === 'string') {
                data = JSON.parse(data);
            }
            if (!data || typeof data !== 'object') {
                throw new Error('Invalid scoreboard data.');
            }

            hasDataRef.current = true;
            attemptRef.current = 0;
            setSession(data);
            setStatus(data.status === 'closed' ? 'closed' : 'live');
            setError('');
            setLastSync(Date.now());

            if (data.status === 'closed') {
                clearTimer();
                return;
            }

            schedule(POLL_INTERVAL);
        } catch (err) {
            if (err?.name === 'AbortError') return;

            setError(err?.message || 'Could not reach the live scoring data.');
            setStatus(hasDataRef.current ? 'reconnecting' : 'error');
            attemptRef.current += 1;
            schedule(Math.min(MAX_BACKOFF, POLL_INTERVAL * (2 ** Math.min(attemptRef.current, 3))));
        }
    }, [clearTimer, schedule, sessionId]);

    useEffect(() => {
        pollRef.current = poll;
    }, [poll]);

    useEffect(() => {
        mountedRef.current = true;
        visibleRef.current = typeof document === 'undefined' || document.visibilityState === 'visible';
        attemptRef.current = 0;
        hasDataRef.current = false;
        setSession(null);
        setStatus('loading');
        setError('');
        setLastSync(0);
        poll();

        return () => {
            mountedRef.current = false;
            clearTimer();
            abortRef.current?.abort();
        };
    }, [clearTimer, poll]);

    useEffect(() => {
        const handleVisibility = () => {
            visibleRef.current = document.visibilityState === 'visible';

            if (visibleRef.current) {
                pollRef.current?.();
            } else {
                clearTimer();
                abortRef.current?.abort();
            }
        };

        document.addEventListener('visibilitychange', handleVisibility);
        return () => document.removeEventListener('visibilitychange', handleVisibility);
    }, [clearTimer]);

    return { session, status, error, lastSync };
}
