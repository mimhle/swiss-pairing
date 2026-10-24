'use client';

import { formatBoardNumber, getScoreDigits } from './scoreboardData';
import styles from './scoreboard.module.css';

function getMetaText(player) {
    return [player.federation].filter(Boolean).join(' · ');
}

function formatPlayerId(id) {
    const value = String(id ?? '').trim();
    return value;
}

function PlayerRow({ player, side, winner }) {
    const isWhite = side === 'white';
    const metaText = getMetaText(player);
    const playerId = formatPlayerId(player.id);
    const stateClass = winner === side ? styles.winner : winner ? styles.loser : '';

    return (
        <div className={`${styles.matchRow} ${stateClass}`}>
            {playerId && <span className={styles.playerId}>{playerId}</span>}
            <span className={`${styles.piece} ${isWhite ? styles.pieceWhite : styles.pieceBlack}`} aria-hidden="true" />
            {player.title && <span className={styles.titleBadge}>{player.title}</span>}
            <span className={styles.playerName}>{player.name}</span>
            {metaText && <span className={styles.playerMeta}>{metaText}</span>}
        </div>
    );
}

export default function BoardCard({
    board,
    heldBoard,
    index,
    maxPlayerIdLength,
    isFlashing,
    flashNonce,
}) {
    const shownBoard = heldBoard || board;
    const idDigits = Math.min(4, Math.max(2, Number(maxPlayerIdLength) || 2));
    const meta = shownBoard.meta;
    const winner = meta.winner;
    const isPending = meta.kind === 'pending';
    const singlePlayer = shownBoard.isBye || meta.kind === 'forfeit';
    const accentClass = winner === 'white'
        ? styles.accentWinWhite
        : winner === 'black'
            ? styles.accentWinBlack
            : meta.kind === 'draw'
                ? styles.accentDraw
                : '';
    const cardClass = [
        styles.boardCard,
        shownBoard.isBye ? styles.boardCardBye : '',
        isFlashing ? styles.boardCardFlashing : '',
    ].filter(Boolean).join(' ');
    const ariaLabel = singlePlayer
        ? `${board.white.name}. ${board.meta.label}.`
        : `Board ${board.boardNumber}. ${board.white.name} versus ${board.black.name}. ${board.meta.label}.`;
    const digits = getScoreDigits(shownBoard.raw);
    const digitClass = side => (
        winner === side
            ? styles.matchDigitWin
            : winner
                ? styles.matchDigitMuted
                : meta.kind === 'draw'
                    ? styles.matchDigitDraw
                    : ''
    );

    const boardTag = (
        <span className={styles.boardTag} aria-hidden="true">
            <span className={styles.boardTab}>{formatBoardNumber(shownBoard.boardNumber)}</span>
            {shownBoard.group && <span className={styles.boardGroup}>{shownBoard.group}</span>}
        </span>
    );

    return (
        <article
            className={cardClass}
            data-id-digits={idDigits}
            style={{ '--i': String(Math.min(index, 24)) }}
            aria-label={ariaLabel}
        >
            {singlePlayer ? (
                <div className={styles.byeBody}>
                    <PlayerRow player={shownBoard.white} side="white" winner={winner} />
                    <div className={styles.byeScore}>
                        <span className={styles.byeLabel}>{meta.label}</span>
                        {meta.points !== null && <span className={styles.byePoints}>{meta.points} PT</span>}
                    </div>
                </div>
            ) : (
                <div className={styles.matchBody}>
                    <div className={styles.matchPlayers}>
                        <PlayerRow player={shownBoard.white} side="white" winner={winner} />
                        <PlayerRow player={shownBoard.black} side="black" winner={winner} />
                    </div>

                    <div className={`${styles.matchScore} ${isPending ? styles.matchScorePending : ''}`}>
                        {boardTag}
                        {isPending ? (
                            <span className={styles.pendingDots} aria-hidden="true">
                                <i />
                                <i />
                                <i />
                            </span>
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

            {isFlashing && (
                <>
                    <span key={`wipe-${flashNonce}`} className={styles.scoreWipe} aria-hidden="true">
                        <span className={styles.scoreWipeLine} />
                    </span>
                    <span key={`ring-${flashNonce}`} className={styles.flashRing} />
                </>
            )}
        </article>
    );
}
