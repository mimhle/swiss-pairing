'use client';

import { formatBoardNumber, getScoreDigits, getStatusLabel, getStatusTone } from './scoreboardData';
import styles from './scoreboard.module.css';

function getMetaText(player) {
    return [player.rating, player.federation].filter(Boolean).join(' · ');
}

function PlayerRow({ player, side, winner }) {
    const isWhite = side === 'white';
    const metaText = getMetaText(player);
    const stateClass = winner === side ? styles.winner : winner ? styles.loser : '';

    return (
        <div className={`${styles.matchRow} ${stateClass}`}>
            <span className={`${styles.piece} ${isWhite ? styles.pieceWhite : styles.pieceBlack}`} aria-hidden="true" />
            {player.title && <span className={styles.titleBadge}>{player.title}</span>}
            <span className={styles.playerName}>{player.name}</span>
            {metaText && <span className={styles.playerMeta}>{metaText}</span>}
        </div>
    );
}

export default function BoardCard({
    board,
    index,
    density,
    roundComplete,
    isFlashing,
    flashNonce,
}) {
    const meta = board.meta;
    const winner = meta.winner;
    const isPending = meta.kind === 'pending';
    const singlePlayer = board.isBye || meta.kind === 'forfeit';
    const statusTone = getStatusTone(meta);
    const statusLabel = getStatusLabel(meta, roundComplete);
    const statusClass = {
        live: styles.statusLive,
        final: styles.statusFinal,
        bye: styles.statusBye,
        forfeit: styles.statusForfeit,
        pending: styles.statusPending,
    }[statusTone] || styles.statusPending;
    const dotClass = {
        live: styles.denseStatusLive,
        final: styles.denseStatusFinal,
        bye: styles.denseStatusBye,
        forfeit: styles.denseStatusForfeit,
        pending: styles.denseStatusPending,
    }[statusTone] || styles.denseStatusPending;
    const accentClass = winner === 'white'
        ? styles.accentWinWhite
        : winner === 'black'
            ? styles.accentWinBlack
            : meta.kind === 'draw'
                ? styles.accentDraw
                : '';
    const cardClass = [
        styles.boardCard,
        density === 'roomy' ? styles.boardCardRoomy : density === 'compact' ? styles.boardCardCompact : styles.boardCardDense,
        board.isBye ? styles.boardCardBye : '',
        isFlashing ? styles.boardCardFlashing : '',
    ].filter(Boolean).join(' ');
    const ariaLabel = `Board ${board.boardNumber}. ${board.white.name}${singlePlayer ? '' : ` versus ${board.black.name}`}. ${meta.label}.`;
    const digits = getScoreDigits(board.raw);
    const digitClass = side => (
        winner === side
            ? styles.matchDigitWin
            : winner
                ? styles.matchDigitMuted
                : meta.kind === 'draw'
                    ? styles.matchDigitDraw
                    : ''
    );

    if (density === 'dense') {
        return (
            <article
                className={cardClass}
                style={{ '--i': String(Math.min(index, 24)) }}
                aria-label={ariaLabel}
            >
                <div className={styles.denseRow}>
                    <span className={`${styles.denseStatus} ${dotClass}`} aria-hidden="true" />
                    <span className={styles.denseBoard}>{formatBoardNumber(board.boardNumber)}</span>
                    {singlePlayer ? (
                        <>
                            <span className={`${styles.denseName} ${styles.denseNameSingle}`}>{board.white.name}</span>
                            <span className={`${styles.denseScore} ${styles.denseScoreSpecial}`}>{meta.label}</span>
                            {meta.points !== null && (
                                <span className={styles.denseBye}>{meta.points} PT</span>
                            )}
                        </>
                    ) : (
                        <>
                            <span className={`${styles.denseName} ${styles.denseNameWhite} ${winner === 'white' ? styles.winnerText : winner === 'black' ? styles.loserText : ''}`}>
                                {board.white.name}
                            </span>
                            <span className={`${styles.denseScore} ${isPending ? styles.densePending : ''} ${winner ? styles.denseScoreWin : ''}`}>
                                {meta.label}
                            </span>
                            <span className={`${styles.denseName} ${styles.denseNameBlack} ${winner === 'black' ? styles.winnerText : winner === 'white' ? styles.loserText : ''}`}>
                                {board.black.name}
                            </span>
                            {(meta.kind === 'forfeit-win' || meta.kind === 'forfeit-loss') && (
                                <span className={styles.denseFlag} title="Forfeit">F</span>
                            )}
                        </>
                    )}
                    {isFlashing && <span key={`ring-${flashNonce}`} className={styles.flashRing} />}
                </div>
            </article>
        );
    }

    return (
        <article
            className={cardClass}
            style={{ '--i': String(Math.min(index, 24)) }}
            aria-label={ariaLabel}
        >
            <div className={styles.cardTop}>
                <div className={styles.cardTopLeft}>
                    <span className={styles.boardNo}>Board {formatBoardNumber(board.boardNumber)}</span>
                    {board.group && <span className={styles.groupChip}>{board.group}</span>}
                </div>
                <span className={`${styles.statusPill} ${statusClass}`}>{statusLabel}</span>
            </div>

            {singlePlayer ? (
                <div className={styles.byeBody}>
                    <PlayerRow player={board.white} side="white" winner={winner} />
                    <div className={styles.byeScore}>
                        <span className={styles.byeLabel}>{meta.label}</span>
                        {meta.points !== null && <span className={styles.byePoints}>{meta.points} PT</span>}
                    </div>
                </div>
            ) : (
                <div className={styles.matchBody}>
                    <div className={styles.matchPlayers}>
                        <PlayerRow player={board.white} side="white" winner={winner} />
                        <PlayerRow player={board.black} side="black" winner={winner} />
                    </div>

                    <div className={`${styles.matchScore} ${isPending ? styles.matchScorePending : ''}`}>
                        {isPending ? (
                            <div className={styles.matchVs}>
                                <span>VS</span>
                                <span className={styles.pendingDots} aria-hidden="true">
                                    <i />
                                    <i />
                                    <i />
                                </span>
                            </div>
                        ) : (
                            <>
                                <span className={`${styles.matchDigit} ${digitClass('white')}`}>
                                    {digits?.white ?? '–'}
                                </span>
                                <span className={`${styles.matchDigit} ${digitClass('black')}`}>
                                    {digits?.black ?? '–'}
                                </span>
                            </>
                        )}
                        {isFlashing && <span key={`flash-${flashNonce}`} className={styles.scoreFlash} />}
                    </div>
                </div>
            )}

            <div className={`${styles.cardAccent} ${accentClass}`}>
                <span className={styles.accentWhite} />
                <span className={styles.accentBlack} />
            </div>

            {isFlashing && <span key={`ring-${flashNonce}`} className={styles.flashRing} />}
        </article>
    );
}
