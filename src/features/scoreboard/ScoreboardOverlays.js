'use client';

import { useEffect, useRef } from 'react';
import { Trophy } from 'lucide-react';
import styles from './scoreboard.module.css';

export function AmbientBackground() {
    return (
        <div className={styles.ambient} aria-hidden="true">
            <div className={styles.topAccent} />
        </div>
    );
}

export function RoundTakeover({ roundNumber, initial }) {
    const numberRef = useRef(null);

    // Measure after the entrance animations settle (the slam is 0.75s) but
    // before the flight starts with the overlay fade-out (2.1s), then fly the
    // big number to the header's round number while the overlay fades out.
    useEffect(() => {
        const timer = window.setTimeout(() => {
            const source = numberRef.current;
            const target = document.querySelector('[data-scoreboard-round-number]');
            if (!source || !target) return;

            const sourceRect = source.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            const sourceFont = parseFloat(window.getComputedStyle(source).fontSize);
            const targetFont = parseFloat(window.getComputedStyle(target).fontSize);
            if (!sourceRect.width || !targetRect.height || !sourceFont || !targetFont) return;

            const scale = targetFont / sourceFont;
            const x = (targetRect.left + targetRect.width / 2) - (sourceRect.left + sourceRect.width / 2);
            const y = (targetRect.top + targetRect.height / 2) - (sourceRect.top + sourceRect.height / 2);

            source.style.setProperty('--flight-x', `${x}px`);
            source.style.setProperty('--flight-y', `${y}px`);
            source.style.setProperty('--flight-scale', String(scale));
        }, 900);

        return () => window.clearTimeout(timer);
    }, []);

    return (
        <div className={styles.takeover} aria-hidden="true">
            <div className={`${styles.takeoverContent} ${initial ? styles.takeoverInitial : ''}`}>
                {!initial && (
                    <span className={styles.takeoverKicker}>Now pairing</span>
                )}
                <span className={styles.takeoverRound}>
                    <span className={styles.takeoverRoundLabel}>Round</span>
                    <span ref={numberRef} className={styles.takeoverRoundNumber}>{roundNumber}</span>
                </span>
                <span className={styles.takeoverLine} />
                <span className={styles.takeoverSub}>
                    {initial ? 'Syncing live results' : 'Boards are live'}
                </span>
            </div>
        </div>
    );
}

export function CompleteBanner({ roundNumber, final }) {
    return (
        <div className={styles.completeBanner} role="status">
            <span className={styles.completeIcon} aria-hidden="true">
                <Trophy />
            </span>
            <div>
                <div className={styles.completeTitle}>
                    {final ? 'Tournament complete' : `Round ${roundNumber} complete`}
                </div>
                <div className={styles.completeSub}>
                    {final ? 'Final results are on the board' : 'All boards have reported'}
                </div>
            </div>
        </div>
    );
}
