'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BoardCard from './BoardCard';
import ResultTicker from './ResultTicker';
import ScoreboardHeader from './ScoreboardHeader';
import StatusScreen from './StatusScreen';
import { AmbientBackground, CompleteBanner, RoundTakeover } from './ScoreboardOverlays';
import useElementSize from './useElementSize';
import useSessionPolling from './useSessionPolling';
import {
    buildRecentResults,
    buildResultMap,
    computeFit,
    getRoundInfo,
    normalizeBoard,
    toTickerItem,
} from './scoreboardData';
import styles from './scoreboard.module.css';

const RESULT_FLASH_MS = 2200;
const ROUND_TAKEOVER_MS = 2700;
const COMPLETE_BANNER_MS = 4200;
const BOARD_GAP = 10;

function prefersReducedMotion() {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function ScoreboardClient({ sessionId }) {
    const { session, status, error, lastSync } = useSessionPolling(sessionId);
    const [now, setNow] = useState(0);
    const [paneRef, paneSize] = useElementSize();
    const stageRef = useRef(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [roundAnnouncement, setRoundAnnouncement] = useState(null);
    const [revealNonce, setRevealNonce] = useState(0);
    const [flash, setFlash] = useState(null);
    const [completeBanner, setCompleteBanner] = useState(null);
    const [recentResults, setRecentResults] = useState([]);
    const previousRoundRef = useRef(null);
    const previousResultsRef = useRef(null);
    const initializedRef = useRef(false);
    const completeShownRef = useRef(false);

    useEffect(() => {
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const previousBodyOverflow = document.body.style.overflow;
        const previousHtmlOverflow = document.documentElement.style.overflow;
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousBodyOverflow;
            document.documentElement.style.overflow = previousHtmlOverflow;
        };
    }, []);

    useEffect(() => {
        const handleModeChange = (event) => {
            if (event.key === 'mode' && event.newValue) {
                document.documentElement.setAttribute('data-mode', event.newValue);
            }
        };

        window.addEventListener('storage', handleModeChange);
        return () => window.removeEventListener('storage', handleModeChange);
    }, []);

    const toggleFullscreen = useCallback(async () => {
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
            } else if (stageRef.current?.requestFullscreen) {
                await stageRef.current.requestFullscreen();
            }
        } catch (_) {
            // Fullscreen can be rejected by the browser; ignore it.
        }
    }, []);

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(Boolean(document.fullscreenElement));
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        handleFullscreenChange();
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key !== 'f' && event.key !== 'F') return;
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const tag = event.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
            event.preventDefault();
            toggleFullscreen();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [toggleFullscreen]);

    const rounds = useMemo(() => (Array.isArray(session?.rounds) ? session.rounds : []), [session]);
    const currentRound = rounds.length ? rounds[rounds.length - 1] : null;
    const roundNumber = Number(currentRound?.roundNumber) || rounds.length || 0;
    const numRounds = Number(session?.numRounds) || 0;
    const roundInfo = useMemo(() => getRoundInfo(currentRound), [currentRound]);
    const boards = useMemo(() => {
        const pairings = Array.isArray(currentRound?.pairings) ? currentRound.pairings : [];
        return pairings.map((pairing, index) => normalizeBoard(pairing, index));
    }, [currentRound]);
    const fit = useMemo(
        () => computeFit(boards.length, paneSize.width, paneSize.height, BOARD_GAP),
        [boards.length, paneSize.width, paneSize.height],
    );
    const isFinal = Boolean(numRounds && roundNumber >= numRounds);
    const roundStartedAt = Number(currentRound?.timestamp) || Number(session?.createdAt) || 0;
    const tournamentName = String(session?.tournamentName || '').trim() || 'Tournament';

    useEffect(() => {
        if (!session || !currentRound) return;

        const pairings = Array.isArray(currentRound.pairings) ? currentRound.pairings : [];
        if (pairings.length === 0) return;

        const nextResults = buildResultMap(currentRound);
        const info = getRoundInfo(currentRound);

        if (!initializedRef.current) {
            initializedRef.current = true;
            previousRoundRef.current = roundNumber;
            previousResultsRef.current = nextResults;
            setRecentResults(buildRecentResults([currentRound], 20));
            if (!prefersReducedMotion()) {
                setRoundAnnouncement({ roundNumber, nonce: Date.now(), initial: true });
            }
            completeShownRef.current = info.isComplete;
            return;
        }

        if (previousRoundRef.current !== roundNumber) {
            const previousRoundNumber = previousRoundRef.current;
            previousRoundRef.current = roundNumber;
            previousResultsRef.current = nextResults;
            setRecentResults(buildRecentResults([currentRound], 20));

            if (roundNumber > previousRoundNumber && !prefersReducedMotion()) {
                setRoundAnnouncement({ roundNumber, nonce: Date.now(), initial: false });
            }

            setCompleteBanner(null);
            completeShownRef.current = false;
            return;
        }

        const previous = previousResultsRef.current || new Map();
        const changed = [];
        const cleared = [];

        nextResults.forEach((entry, key) => {
            const old = previous.get(key);
            if (entry.decided && (!old || !old.decided || old.result !== entry.result || old.kind !== entry.kind)) {
                changed.push(entry);
            }
            if (!entry.decided && old?.decided) {
                cleared.push(old);
            }
        });

        previous.forEach((old, key) => {
            if (!nextResults.has(key) && old.decided) {
                cleared.push(old);
            }
        });

        previousResultsRef.current = nextResults;

        if (changed.length) {
            const changedTickerKeys = new Set(changed.map(entry => `${roundNumber}-${entry.key}`));
            const nextItems = changed.map(entry => toTickerItem(entry, roundNumber));

            setFlash({ nonce: Date.now(), keys: changed.map(entry => entry.key) });
            setRecentResults(previousItems => (
                [...nextItems, ...previousItems.filter(item => !changedTickerKeys.has(item.key))].slice(0, 20)
            ));
        }

        if (cleared.length) {
            const clearedTickerKeys = new Set(cleared.map(entry => `${roundNumber}-${entry.key}`));
            setRecentResults(previousItems => previousItems.filter(item => !clearedTickerKeys.has(item.key)));
        }

        if (info.isComplete && !completeShownRef.current) {
            completeShownRef.current = true;
            setCompleteBanner({ nonce: Date.now(), final: isFinal });
        } else if (!info.isComplete) {
            completeShownRef.current = false;
        }
    }, [session, currentRound, roundNumber, isFinal]);

    useEffect(() => {
        if (!roundAnnouncement) return undefined;
        const timer = setTimeout(() => {
            setRoundAnnouncement(null);
            setRevealNonce(previous => previous + 1);
        }, ROUND_TAKEOVER_MS);
        return () => clearTimeout(timer);
    }, [roundAnnouncement]);

    useEffect(() => {
        if (!flash) return undefined;
        const timer = setTimeout(() => setFlash(null), RESULT_FLASH_MS);
        return () => clearTimeout(timer);
    }, [flash]);

    useEffect(() => {
        if (!completeBanner) return undefined;
        const timer = setTimeout(() => setCompleteBanner(null), COMPLETE_BANNER_MS);
        return () => clearTimeout(timer);
    }, [completeBanner]);

    const flashKeys = flash ? new Set(flash.keys) : null;

    if (!session && (status === 'loading' || status === 'reconnecting')) {
        return (
            <div className={styles.stage} ref={stageRef}>
                <AmbientBackground />
                <StatusScreen variant="loading" />
            </div>
        );
    }

    if (status === 'closed') {
        return (
            <div className={styles.stage} ref={stageRef}>
                <AmbientBackground />
                <StatusScreen variant="closed" />
            </div>
        );
    }

    if (!session && status === 'error') {
        return (
            <div className={styles.stage} ref={stageRef}>
                <AmbientBackground />
                <StatusScreen variant="error" message={error} />
            </div>
        );
    }

    if (!session) {
        return (
            <div className={styles.stage} ref={stageRef}>
                <AmbientBackground />
                <StatusScreen variant="loading" />
            </div>
        );
    }

    if (!currentRound || boards.length === 0) {
        return (
            <div className={styles.stage} ref={stageRef}>
                <AmbientBackground />
                <StatusScreen
                    variant="waiting"
                    tournamentName={tournamentName}
                    roundNumber={roundNumber}
                />
            </div>
        );
    }

    return (
        <div className={styles.stage} ref={stageRef}>
            <AmbientBackground />

            <div className={styles.layout}>
                <ScoreboardHeader
                    tournamentName={tournamentName}
                    roundNumber={roundNumber}
                    numRounds={numRounds}
                    roundInfo={roundInfo}
                    now={now}
                    roundStartedAt={roundStartedAt}
                    status={status}
                    lastSync={lastSync}
                    isFinal={isFinal}
                    isFullscreen={isFullscreen}
                    onToggleFullscreen={toggleFullscreen}
                />

                <div className={styles.main}>
                    <div className={styles.boardPane} ref={paneRef}>
                        <div
                            key={revealNonce}
                            className={styles.boardGrid}
                            style={{
                                '--cols': String(fit.columns),
                                '--rows': String(fit.rows),
                                '--board-gap': `${BOARD_GAP}px`,
                            }}
                        >
                            {boards.map((board, index) => (
                                <BoardCard
                                    key={board.key}
                                    board={board}
                                    index={index}
                                    roundComplete={roundInfo.isComplete}
                                    isFlashing={Boolean(flashKeys?.has(board.key))}
                                    flashNonce={flash?.nonce || 0}
                                />
                            ))}
                            {Array.from({ length: Math.max(0, fit.columns * fit.rows - boards.length) }, (_, index) => (
                                <div
                                    key={`filler-${index}`}
                                    className={styles.gridFiller}
                                    style={{ '--i': String(Math.min(boards.length + index, 24)) }}
                                    aria-hidden="true"
                                >
                                    <span className={styles.gridFillerPiece}>♞</span>
                                    <span className={styles.gridFillerText}>Swiss Pairing</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <ResultTicker
                    items={recentResults}
                    roundNumber={roundNumber}
                    roundInfo={roundInfo}
                    status={status}
                />
            </div>

            {roundAnnouncement && (
                <RoundTakeover
                    key={roundAnnouncement.nonce}
                    roundNumber={roundAnnouncement.roundNumber}
                    initial={roundAnnouncement.initial}
                />
            )}

            {completeBanner && (
                <CompleteBanner
                    key={completeBanner.nonce}
                    roundNumber={roundNumber}
                    final={completeBanner.final}
                />
            )}
        </div>
    );
}
