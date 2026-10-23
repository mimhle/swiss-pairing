const RESULT_LABELS = {
    '1-0': '1 – 0',
    '0-1': '0 – 1',
    '0.5-0.5': '½ – ½',
    '0-0': '0 – 0',
    '1-0f': '1 – 0',
    '0-1f': '0 – 1',
};

export function formatBoardNumber(value) {
    const number = Number(value);
    return String(Number.isFinite(number) && number > 0 ? Math.floor(number) : 0).padStart(2, '0');
}

export function formatClock(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map(part => String(part).padStart(2, '0')).join(':');
}

export function formatSyncAge(now, lastSync) {
    if (!lastSync) return 'WAITING';
    const seconds = Math.max(0, Math.floor(((Number(now) || 0) - lastSync) / 1000));
    if (seconds < 2) return 'JUST NOW';
    if (seconds < 60) return `${seconds}S AGO`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}M AGO`;
    return `${Math.floor(minutes / 60)}H AGO`;
}

export function isPairingDecided(pairing) {
    return Boolean(pairing?.isBye || pairing?.isTournamentForfeit || pairing?.result);
}

export function getRoundInfo(round) {
    const pairings = Array.isArray(round?.pairings) ? round.pairings : [];
    const total = pairings.length;
    const decided = pairings.reduce((count, pairing) => count + (isPairingDecided(pairing) ? 1 : 0), 0);

    return {
        total,
        decided,
        hasResults: decided > 0,
        isComplete: total > 0 && decided === total,
    };
}

export function getPairingMeta(pairing) {
    const result = String(pairing?.result || '');

    if (pairing?.isTournamentForfeit) {
        return { kind: 'forfeit', label: 'FORFEIT', winner: null, decided: true, points: null };
    }

    if (pairing?.isBye) {
        const isSkip = Boolean(pairing.isSkip);
        const byeResult = result || (isSkip ? '0-0' : '1-0');
        const points = byeResult === '1-0' || byeResult === '1-0f'
            ? 1
            : byeResult === '0.5-0.5'
                ? 0.5
                : 0;

        return {
            kind: isSkip ? 'skip' : 'bye',
            label: isSkip ? 'SKIP' : 'BYE',
            winner: points === 1 ? 'white' : null,
            decided: true,
            points,
        };
    }

    if (!result) {
        return { kind: 'pending', label: 'VS', winner: null, decided: false, points: null };
    }

    if (result === '1-0' || result === '1-0f') {
        return {
            kind: result.endsWith('f') ? 'forfeit-win' : 'win',
            label: RESULT_LABELS[result],
            winner: 'white',
            decided: true,
            points: 1,
        };
    }

    if (result === '0-1' || result === '0-1f') {
        return {
            kind: result.endsWith('f') ? 'forfeit-loss' : 'win',
            label: RESULT_LABELS[result],
            winner: 'black',
            decided: true,
            points: 1,
        };
    }

    if (result === '0.5-0.5') {
        return { kind: 'draw', label: RESULT_LABELS[result], winner: null, decided: true, points: 0.5 };
    }

    if (result === '0-0') {
        return { kind: 'none', label: RESULT_LABELS[result], winner: null, decided: true, points: 0 };
    }

    return { kind: 'unknown', label: result, winner: null, decided: true, points: null };
}

export function getScoreDigits(pairing) {
    const result = String(pairing?.result || '');

    if (result === '1-0' || result === '1-0f') return { white: '1', black: '0' };
    if (result === '0-1' || result === '0-1f') return { white: '0', black: '1' };
    if (result === '0.5-0.5') return { white: '½', black: '½' };
    if (result === '0-0') return { white: '0', black: '0' };
    return null;
}

export function getStatusLabel(meta, roundComplete) {
    if (!meta) return 'PENDING';
    if (meta.kind === 'pending') return roundComplete ? 'PENDING' : 'IN PLAY';
    if (meta.kind === 'bye') return 'BYE';
    if (meta.kind === 'skip') return 'SKIP';
    if (meta.kind === 'forfeit' || meta.kind === 'forfeit-win' || meta.kind === 'forfeit-loss') return 'FORFEIT';
    return 'FINAL';
}

export function getStatusTone(meta) {
    if (!meta) return 'pending';
    if (meta.kind === 'pending') return 'live';
    if (meta.kind === 'bye' || meta.kind === 'skip') return 'bye';
    if (meta.kind === 'forfeit' || meta.kind === 'forfeit-win' || meta.kind === 'forfeit-loss') return 'forfeit';
    return 'final';
}

function getPlayerName(player, fallbackId, fallbackName) {
    const name = String(player?.name || fallbackName || '').trim();
    if (name) return name;
    if (fallbackId !== undefined && fallbackId !== null && fallbackId !== '') {
        return `Player ${fallbackId}`;
    }
    return 'Unknown player';
}

export function normalizeBoard(pairing, index) {
    const whitePlayer = pairing?.whitePlayer || null;
    const blackPlayer = pairing?.blackPlayer || null;
    const whiteId = pairing?.whiteId ?? whitePlayer?.playerUniqueId ?? '';
    const blackId = pairing?.blackId ?? blackPlayer?.playerUniqueId ?? '';
    const meta = getPairingMeta(pairing);
    const boardNumber = Number(pairing?.boardNumber) || index + 1;

    return {
        key: String(pairing?.id || `${whiteId || 'w'}-${blackId || 'b'}-${index}`),
        boardNumber,
        group: String(pairing?.group || '').trim(),
        isBye: Boolean(pairing?.isBye),
        white: {
            id: whiteId,
            name: getPlayerName(whitePlayer, whiteId, pairing?.whiteName),
            title: String(whitePlayer?.title || '').trim(),
            rating: String(whitePlayer?.rating || '').trim(),
            federation: String(whitePlayer?.federation || '').trim(),
            club: String(whitePlayer?.club || '').trim(),
        },
        black: {
            id: blackId,
            name: getPlayerName(blackPlayer, blackId, pairing?.blackName),
            title: String(blackPlayer?.title || '').trim(),
            rating: String(blackPlayer?.rating || '').trim(),
            federation: String(blackPlayer?.federation || '').trim(),
            club: String(blackPlayer?.club || '').trim(),
        },
        meta,
        raw: pairing,
    };
}

export function buildResultMap(round) {
    const map = new Map();
    const pairings = Array.isArray(round?.pairings) ? round.pairings : [];

    pairings.forEach((pairing, index) => {
        const board = normalizeBoard(pairing, index);
        map.set(board.key, {
            key: board.key,
            result: String(pairing?.result || ''),
            status: board.meta.kind,
            decided: board.meta.decided,
            boardNumber: board.boardNumber,
            whiteName: board.white.name,
            blackName: board.isBye ? '' : board.black.name,
            label: board.meta.label,
            winner: board.meta.winner,
            kind: board.meta.kind,
        });
    });

    return map;
}

export function toTickerItem(entry, roundNumber) {
    const singlePlayer = entry.kind === 'bye' || entry.kind === 'skip' || entry.kind === 'forfeit';

    return {
        key: `${roundNumber}-${entry.key}`,
        roundNumber,
        boardNumber: entry.boardNumber,
        whiteName: entry.whiteName,
        blackName: singlePlayer ? '' : entry.blackName,
        label: entry.label,
        winner: entry.winner,
        kind: entry.kind,
    };
}

export function buildRecentResults(rounds, limit = 20) {
    const items = [];

    (Array.isArray(rounds) ? rounds : []).forEach((round, roundIndex) => {
        const roundNumber = Number(round?.roundNumber) || roundIndex + 1;
        const pairings = Array.isArray(round?.pairings) ? round.pairings : [];

        pairings.forEach((pairing, index) => {
            const board = normalizeBoard(pairing, index);
            if (!board.meta.decided) return;

            items.push(toTickerItem({
                key: board.key,
                boardNumber: board.boardNumber,
                whiteName: board.white.name,
                blackName: board.isBye ? '' : board.black.name,
                label: board.meta.label,
                winner: board.meta.winner,
                kind: board.meta.kind,
            }, roundNumber));
        });
    });

    return items.slice(-limit).reverse();
}

export function computeFit(count, width, height, gap = 10) {
    const total = Math.max(0, Math.floor(Number(count) || 0));
    const minCardWidth = 300;
    const minCardHeight = 48;
    const baseCardWidth = 360;
    const baseCardHeight = 180;

    if (total <= 0) {
        return { columns: 1, rows: 1 };
    }

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        const columns = total <= 4 ? total : total <= 9 ? 3 : 4;
        return {
            columns,
            rows: Math.ceil(total / columns),
        };
    }

    const maxColumns = Math.min(total, 10);
    let best = null;

    // Prefer layouts where the card is wide enough for names and tall enough
    // for two player rows. Among those, pick the largest proportional card.
    for (let columns = 1; columns <= maxColumns; columns += 1) {
        const rows = Math.ceil(total / columns);
        const cellWidth = (width - gap * (columns - 1)) / columns;
        const cellHeight = (height - gap * (rows - 1)) / rows;

        if (cellWidth < minCardWidth || cellHeight < minCardHeight) continue;

        const score = Math.min(cellWidth / baseCardWidth, cellHeight / baseCardHeight);
        if (
            !best
            || score > best.score + 0.0001
            || (Math.abs(score - best.score) <= 0.0001 && columns > best.columns)
        ) {
            best = { columns, rows, score };
        }
    }

    if (best) {
        return { columns: best.columns, rows: best.rows };
    }

    // If no layout can keep both minimums, keep every board visible and choose
    // the layout with the largest proportional card.
    best = null;
    for (let columns = 1; columns <= maxColumns; columns += 1) {
        const rows = Math.ceil(total / columns);
        const cellWidth = (width - gap * (columns - 1)) / columns;
        const cellHeight = (height - gap * (rows - 1)) / rows;
        const score = Math.min(cellWidth / minCardWidth, cellHeight / minCardHeight);

        if (
            !best
            || score > best.score + 0.0001
            || (Math.abs(score - best.score) <= 0.0001 && columns > best.columns)
        ) {
            best = { columns, rows, score };
        }
    }

    return { columns: best.columns, rows: best.rows };
}
