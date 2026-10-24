'use client';

import { useEffect, useRef } from 'react';
import { Trophy } from 'lucide-react';
import styles from './scoreboard.module.css';

function textRect(element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect();
}

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

            // Centre the text, not the boxes: the hero sets line-height 0.78 and
            // the header 0.92, so the two boxes centre on different points while
            // the glyphs share one. Box centres leave the number a few pixels off
            // when it lands, which is what makes the hand-off read as a copy.
            const sourceBox = source.getBoundingClientRect();
            const sourceText = textRect(source);
            const targetText = textRect(target);
            const sourceFont = parseFloat(window.getComputedStyle(source).fontSize);
            const targetFont = parseFloat(window.getComputedStyle(target).fontSize);
            if (!sourceBox.width || !sourceText.width || !targetText.width || !sourceFont || !targetFont) return;

            const sourceX = sourceText.left + sourceText.width / 2;
            const sourceY = sourceText.top + sourceText.height / 2;
            const targetX = targetText.left + targetText.width / 2;
            const targetY = targetText.top + targetText.height / 2;

            // Scale about the glyph centre so the landing lands on the header's
            // own glyphs, then move glyph centre onto glyph centre.
            source.style.transformOrigin = `${sourceX - sourceBox.left}px ${sourceY - sourceBox.top}px`;
            source.style.setProperty('--flight-x', `${targetX - sourceX}px`);
            source.style.setProperty('--flight-y', `${targetY - sourceY}px`);
            source.style.setProperty('--flight-scale', String(targetFont / sourceFont));
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
