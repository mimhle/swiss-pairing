'use client';

import { AlertTriangle, Loader2, Swords, WifiOff } from 'lucide-react';
import styles from './scoreboard.module.css';

const VARIANTS = {
    loading: {
        icon: Loader2,
        title: 'Connecting',
        text: 'Linking to the live scoring feed…',
        spin: true,
    },
    waiting: {
        icon: Swords,
        title: 'Waiting for pairings',
        text: 'The scoreboard will update automatically when the tournament director starts the round.',
    },
    closed: {
        icon: WifiOff,
        title: 'Session ended',
        text: 'This scoreboard link is no longer active.',
    },
    error: {
        icon: AlertTriangle,
        title: 'Live data unavailable',
        text: 'Could not reach the live scoring data. Retrying automatically…',
    },
};

export default function StatusScreen({ variant = 'loading', tournamentName, roundNumber, message }) {
    const config = VARIANTS[variant] || VARIANTS.loading;
    const Icon = config.icon;
    const text = message || config.text;

    return (
        <div className={styles.statusScreen}>
            <div className={styles.statusCard}>
                <span className={styles.statusKicker}>Swiss Pairing · Live Scoreboard</span>

                <div className={styles.statusIcon} aria-hidden="true">
                    <Icon className={config.spin ? styles.spin : ''} />
                </div>

                <h1 className={styles.statusTitle}>{config.title}</h1>

                {tournamentName && <div className={styles.statusTournament}>{tournamentName}</div>}
                {roundNumber > 0 && <div className={styles.statusRound}>Round {roundNumber}</div>}

                <p className={styles.statusText}>{text}</p>

                {(variant === 'loading' || variant === 'waiting') && (
                    <div className={styles.statusBar} aria-hidden="true">
                        <span />
                    </div>
                )}

                {variant === 'error' && (
                    <span className={styles.statusHint}>Retrying automatically</span>
                )}
            </div>
        </div>
    );
}
