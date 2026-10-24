'use client';

import { Maximize2, Minimize2, Swords, Trophy } from 'lucide-react';
import { formatClock } from './scoreboardData';
import styles from './scoreboard.module.css';

export default function ScoreboardHeader({
    tournamentName,
    roundNumber,
    numRounds,
    roundInfo,
    now,
    roundStartedAt,
    status,
    isFinal,
    hideRoundNumber,
    isFullscreen,
    onToggleFullscreen,
}) {
    const elapsed = now && roundStartedAt ? Math.max(0, now - roundStartedAt) : null;
    const clockValue = roundInfo.isComplete
        ? 'FULL TIME'
        : elapsed !== null
            ? formatClock(elapsed)
            : '--:--:--';
    const progressPercent = roundInfo.total > 0
        ? Math.round((roundInfo.decided / roundInfo.total) * 100)
        : 0;
    const progressLabel = roundInfo.total === 0
        ? 'WAITING FOR PAIRINGS'
        : roundInfo.isComplete
            ? isFinal
                ? 'TOURNAMENT COMPLETE'
                : 'ROUND COMPLETE'
            : `${roundInfo.decided} / ${roundInfo.total} BOARDS DECIDED`;
    const liveLabel = status === 'live'
        ? 'LIVE'
        : status === 'reconnecting'
            ? 'RECONNECTING'
            : 'CONNECTING';
    const liveWarn = status !== 'live';

    return (
        <header className={styles.header}>
            <div className={styles.headerRow}>
                <div className={styles.brand}>
                    <Swords className={styles.brandIcon} aria-hidden="true" />
                    <div className={styles.brandText}>
                        <span className={styles.brandKicker}>Swiss Pairing · Live Scoreboard</span>
                        <span className={styles.tournamentName} title={tournamentName}>
                            {tournamentName}
                        </span>
                    </div>
                </div>

                <div className={styles.roundBlock}>
                    <div className={styles.roundText}>
                        <span className={styles.roundLabel}>{isFinal ? 'Final round' : 'Round'}</span>
                        <span className={styles.roundValue}>
                            <span
                                className={`${styles.roundNumber} ${hideRoundNumber ? styles.roundNumberHidden : ''}`}
                                data-scoreboard-round-number
                            >
                                {roundNumber || '—'}
                            </span>
                            {numRounds > 0 && <span className={styles.roundTotal}>/ {numRounds}</span>}
                        </span>
                    </div>
                    {isFinal && <Trophy className={styles.roundFinalIcon} aria-hidden="true" />}
                </div>

                <div className={styles.headerRight}>
                    <div className={styles.clockBlock}>
                        <span className={styles.clockLabel}>{roundInfo.isComplete ? 'Status' : 'Round time'}</span>
                        <span className={`${styles.clock} ${roundInfo.isComplete ? styles.clockFinal : ''}`}>
                            {clockValue}
                        </span>
                    </div>

                    <div className={styles.headerMeta}>
                        <span className={`${styles.liveBadge} ${liveWarn ? styles.liveBadgeWarn : ''}`}>
                            <span className={`${styles.liveDot} ${liveWarn ? styles.liveDotWarn : ''}`} />
                            {liveLabel}
                        </span>
                    </div>

                    <button
                        type="button"
                        onClick={onToggleFullscreen}
                        className={styles.iconButton}
                        title="Toggle fullscreen (F)"
                        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                    >
                        {isFullscreen ? <Minimize2 /> : <Maximize2 />}
                    </button>
                </div>
            </div>

            <div className={styles.progressWrap}>
                <div className={styles.progressTrack}>
                    <div
                        className={`${styles.progressFill} ${roundInfo.isComplete ? styles.progressComplete : ''}`}
                        style={{ '--progress': progressPercent / 100 }}
                    />
                </div>
                <span className={styles.progressLabel}>{progressLabel}</span>
            </div>
        </header>
    );
}
