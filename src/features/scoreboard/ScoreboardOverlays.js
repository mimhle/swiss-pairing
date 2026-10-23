'use client';

import { useMemo } from 'react';
import { Trophy } from 'lucide-react';
import styles from './scoreboard.module.css';

const CONFETTI_COLORS = [
    'var(--color-primary-500)',
    'var(--color-success-500)',
    'var(--color-warning-500)',
    'var(--color-tertiary-500)',
    'var(--color-secondary-500)',
];

export function AmbientBackground() {
    return (
        <div className={styles.ambient} aria-hidden="true">
            <div className={styles.topAccent} />
            <div className={`${styles.orb} ${styles.orbPrimary}`} />
            <div className={`${styles.orb} ${styles.orbSuccess}`} />
            <div className={`${styles.orb} ${styles.orbTertiary}`} />
            <div className={styles.sweep} />
        </div>
    );
}

export function RoundTakeover({ roundNumber, initial }) {
    return (
        <div className={styles.takeover} aria-hidden="true">
            <div className={styles.takeoverGlow} />
            <div className={`${styles.takeoverContent} ${initial ? styles.takeoverInitial : ''}`}>
                <span className={styles.takeoverKicker}>
                    {initial ? 'Live scoreboard' : 'Now pairing'}
                </span>
                <span className={styles.takeoverRound}>Round {roundNumber}</span>
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

export function CelebrationLayer({ variant = 'result' }) {
    const pieces = useMemo(() => {
        const count = variant === 'complete' ? 40 : variant === 'round' ? 30 : 24;

        return Array.from({ length: count }, (_, index) => ({
            id: index,
            left: Math.random() * 100,
            delay: Math.random() * 0.35,
            duration: 1.2 + Math.random() * 0.8,
            drift: (Math.random() * 2 - 1) * 100,
            rotate: Math.random() * 360,
            size: 6 + Math.random() * 6,
            color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
        }));
    }, [variant]);

    return (
        <div className={styles.celebration} aria-hidden="true">
            {pieces.map(piece => (
                <span
                    key={piece.id}
                    className={styles.confettiPiece}
                    style={{
                        left: `${piece.left}%`,
                        '--confetti-delay': `${piece.delay}s`,
                        '--confetti-duration': `${piece.duration}s`,
                        '--confetti-drift': `${piece.drift}px`,
                        '--confetti-rotate': `${piece.rotate}deg`,
                        '--confetti-size': `${piece.size}px`,
                        '--confetti-color': piece.color,
                    }}
                />
            ))}
        </div>
    );
}
