'use client';

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
    return (
        <div className={styles.takeover} aria-hidden="true">
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
