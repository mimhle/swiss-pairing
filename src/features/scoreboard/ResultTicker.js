'use client';

import { formatBoardNumber } from './scoreboardData';
import styles from './scoreboard.module.css';

function TickerItem({ item }) {
    const singlePlayer = item.kind === 'bye' || item.kind === 'skip' || item.kind === 'forfeit';

    return (
        <span className={styles.tickerItem}>
            <span className={styles.tickerBoard}>Bd {formatBoardNumber(item.boardNumber)}</span>
            <span className={item.winner === 'white' ? styles.tickerWinner : ''}>{item.whiteName}</span>
            <span className={styles.tickerScore}>{item.label}</span>
            {(item.kind === 'forfeit-win' || item.kind === 'forfeit-loss') && (
                <span className={styles.tickerFlag} title="Forfeit">F</span>
            )}
            {!singlePlayer && (
                <span className={item.winner === 'black' ? styles.tickerWinner : ''}>{item.blackName}</span>
            )}
            <span className={styles.tickerDivider} aria-hidden="true" />
        </span>
    );
}

export default function ResultTicker({ items = [], roundNumber, roundInfo, status }) {
    const hasItems = items.length > 0;
    const duration = Math.max(24, Math.min(90, items.length * 4.5));
    const isLive = status === 'live';

    return (
        <div className={styles.ticker}>
            <div className={styles.tickerLabel}>
                <span className={`${styles.liveDot} ${isLive ? '' : styles.liveDotWarn}`} aria-hidden="true" />
                <span>{isLive ? 'Live' : 'Sync'}</span>
                <span className={styles.tickerRound}>R{roundNumber}</span>
                <span className={styles.tickerCount}>{roundInfo.decided}/{roundInfo.total}</span>
            </div>

            {hasItems ? (
                <div className={styles.tickerViewport}>
                    <div
                        key={items[0]?.key || 'ticker'}
                        className={styles.tickerTrack}
                        style={{ '--ticker-duration': `${duration}s` }}
                    >
                        <div className={styles.tickerGroup}>
                            {items.map(item => <TickerItem key={item.key} item={item} />)}
                        </div>
                        <div className={styles.tickerGroup} aria-hidden="true">
                            {items.map(item => <TickerItem key={`${item.key}-duplicate`} item={item} />)}
                        </div>
                    </div>
                </div>
            ) : (
                <div className={styles.tickerEmpty}>
                    <span>Waiting for the first result</span>
                    <span className={styles.tickerBlink} aria-hidden="true">• • •</span>
                </div>
            )}
        </div>
    );
}
