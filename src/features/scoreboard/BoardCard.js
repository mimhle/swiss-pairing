'use client';

import { formatBoardNumber, getStatusLabel, getStatusTone } from './scoreboardData';
import styles from './scoreboard.module.css';

function getMetaText(player) {
    return [player.rating, player.federation].filter(Boolean).join(' · ');
}

function PlayerSide({ player, side, winner }) {
    const isWhite = side === 'white';
    const metaText = getMetaText(player);
    const stateClass = winner === side ? styles.winner : winner ? styles.loser : '';

    return (
        <div className={`${styles.player} ${isWhite ? styles.playerWhite : styles.playerBlack} ${stateClass}`}>
            <div className={styles.playerNameRow}>
                {!isWhite && <span className={`${styles.piece} ${styles.pieceBlack}`} aria-hidden="true" />}
                {player.title && <span className={styles.titleBadge}>{player.title}</span>}
                <span className={styles.playerName}>{player.name}</span>
                {isWhite && <span className={`${styles.piece} ${styles.pieceWhite}`} aria-hidden="true" />}
            </div>
            {metaText && <span className={styles.playerMeta}>{metaText}</span>}
        </div>
    );
}

function ByePlayer({ player, winner }) {
    const metaText = getMetaText(player);

    return (
        <div className={`${styles.player} ${styles.byePlayer} ${winner === 'white' ? styles.winner : ''}`}>
            <div className={styles.playerNameRow}>
                <span className={`${styles.piece} ${styles.pieceWhite}`} aria-hidden="true" />
                {player.title && <span className={styles.titleBadge}>{player.title}</span>}
                <span className={styles.playerName}>{player.name}</span>
            </div>
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
    const scoreToneClass = isPending
        ? styles.scorePending
        : meta.kind === 'win' || meta.kind === 'forfeit-win' || meta.kind === 'forfeit-loss'
            ? styles.scoreWin
            : meta.kind === 'draw'
                ? styles.scoreDraw
                : meta.kind === 'bye' || meta.kind === 'skip' || meta.kind === 'forfeit'
                    ? styles.scoreSpecial
                    : styles.scoreFinal;
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
                    <ByePlayer player={board.white} winner={winner} />
                    <div className={styles.byeScore}>
                        <span className={styles.byeLabel}>{meta.label}</span>
                        {meta.points !== null && <span className={styles.byePoints}>{meta.points} PT</span>}
                    </div>
                </div>
            ) : (
                <div className={styles.cardBody}>
                    <PlayerSide player={board.white} side="white" winner={winner} />

                    <div className={styles.scoreBox}>
                        {isFlashing && <span key={`flash-${flashNonce}`} className={styles.scoreFlash} />}
                        <span
                            key={isFlashing ? `score-${flashNonce}` : 'score'}
                            className={`${styles.score} ${scoreToneClass}`}
                        >
                            {meta.label}
                        </span>
                        {isPending && (
                            <span className={styles.pendingDots} aria-hidden="true">
                                <i />
                                <i />
                                <i />
                            </span>
                        )}
                    </div>

                    <PlayerSide player={board.black} side="black" winner={winner} />
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
