const RESULT_LABELS = {
    '1-0': '1 – 0',
    '0-1': '0 – 1',
    '0.5-0.5': '½ – ½',
    '0-0': '0 – 0',
    '1-0f': '1F – 0',
    '0-1f': '0 – 1F',
    '1-1f': '1F – 1F',
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

export function isPairingDecided(pairing) {
    return Boolean(pairing?.isBye || pairing?.isTournamentForfeit || pairing?.result);
}

// Tournament forfeits are not live games: the scoreboard ignores them entirely
// (cards and board counts).
export function getDisplayPairings(round) {
    const pairings = Array.isArray(round?.pairings) ? round.pairings : [];
    return pairings.filter(pairing => !pairing?.isTournamentForfeit);
}

export function getRoundInfo(round) {
    const pairings = getDisplayPairings(round);
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

    if (result === '1-1f' || result === '1f-1f') {
        return { kind: 'double-forfeit', label: RESULT_LABELS['1-1f'], winner: null, decided: true, points: null };
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

    if (result === '1-0') return { white: '1', black: '0' };
    if (result === '0-1') return { white: '0', black: '1' };
    if (result === '1-0f') return { white: '1F', black: '0' };
    if (result === '0-1f') return { white: '0', black: '1F' };
    if (result === '1-1f' || result === '1f-1f') return { white: '1F', black: '1F' };
    if (result === '0.5-0.5') return { white: '½', black: '½' };
    if (result === '0-0') return { white: '0', black: '0' };
    return null;
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
    const pairings = getDisplayPairings(round);

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

const NAME_BUDGET = 20;

export function computeFit(count, width, height, maxGap = 12, maxNameLength = 15, maxIdLength = 2) {
    const total = Math.max(0, Math.floor(Number(count) || 0));
    // Size the row for a typical 3-4 word name. Names longer than the budget
    // are allowed to truncate; letting one outlier shrink every board made the
    // whole scoreboard too small.
    const nameLength = Math.min(NAME_BUDGET, Math.max(15, Math.floor(Number(maxNameLength) || 15)));
    const idLength = Math.min(4, Math.max(2, Math.floor(Number(maxIdLength) || 2)));
    // Width taken by one player's ID column, in line-font em (2-4 digits).
    const idWidth = 1 + 0.45 * idLength;

    if (total <= 0) {
        return { columns: 1, rows: 1, fontSize: 0, gap: maxGap };
    }

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        const columns = total >= 9 ? 2 : Math.min(total, 2);
        return {
            columns,
            rows: Math.ceil(total / columns),
            fontSize: 0,
            gap: maxGap,
        };
    }

    // Two columns is the scoreboard's shape for a normal field: it gives each
    // board a wide single row, and the extra cell width roughly doubles the
    // fitted name font compared with three columns (the name is width-limited,
    // not height-limited). Three columns stay available as a fallback for very
    // large fields, where two columns would need more rows than the height can
    // carry. Very small fields (fewer than nine boards) may use one column.
    const minColumns = total >= 9 ? 2 : 1;
    const maxColumns = Math.min(total, total >= 9 ? 3 : 2);
    const candidates = [];

    for (let columns = minColumns; columns <= maxColumns; columns += 1) {
        const rows = Math.ceil(total / columns);
        // The gap scales with the row height instead of being a fixed pixel
        // value: the cards shrink with the screen, so a constant gap goes from
        // ~10% of a row on a 1080p wall to a third of it on a small laptop.
        const gap = Math.round(Math.min(maxGap, Math.max(3, (height / rows) * 0.12)));
        const cellWidth = (width - gap * (columns - 1)) / columns;
        const cellHeight = (height - gap * (rows - 1)) / rows;

        if (cellWidth <= 0 || cellHeight <= 0) continue;

        // One-line card: the name is a single row, so it can take half the card
        // height instead of the 16% a stacked two-row card used.
        const fontCap = Math.min(cellWidth * 0.034, cellHeight * 0.5, 40);
        // A line spends width on the board chip, both IDs, pieces, titles, the
        // score column and federations. Only the halves that are left hold the
        // two names, and the longest name sets the requirement. Both the space
        // spent and the name size scale with the font, so solve directly.
        const widthLimitedFont = (cellWidth * 0.5) / (6.75 + idWidth + nameLength * 0.56);
        const fittedFont = Math.min(fontCap, widthLimitedFont);

        candidates.push({ columns, rows, gap, score: fittedFont });
    }

    if (candidates.length === 0) {
        const columns = total >= 9 ? 2 : Math.min(total, 2);
        return { columns, rows: Math.ceil(total / columns), fontSize: 0, gap: maxGap };
    }

    // Use the layout with the largest names. Any layout within 5% of the best
    // name size is good enough, and there two columns wins: it is the
    // scoreboard's default shape and leaves less empty space around each line.
    // Three columns only comes back when it fits the names meaningfully better,
    // which happens with large fields on a short screen.
    const bestScore = Math.max(...candidates.map(candidate => candidate.score));
    const best = candidates
        .filter(candidate => candidate.score >= bestScore * 0.95)
        .reduce((current, candidate) => (
            candidate.columns < current.columns ? candidate : current
        ));

    return {
        columns: best.columns,
        rows: best.rows,
        fontSize: Math.round(best.score * 10) / 10,
        gap: best.gap,
    };
}

// The previous two-row card fit, kept for the "Two rows" scoreboard layout.
// It sizes the name at roughly 16% of card height and usually lands on 4-6
// columns; the card itself uses its old container-query sizing.
export function computeStackedFit(count, width, height, gap = 10, maxNameLength = 15) {
    const total = Math.max(0, Math.floor(Number(count) || 0));
    const nameLength = Math.max(15, Math.floor(Number(maxNameLength) || 15));

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

    for (let columns = 1; columns <= maxColumns; columns += 1) {
        const rows = Math.ceil(total / columns);
        const cellWidth = (width - gap * (columns - 1)) / columns;
        const cellHeight = (height - gap * (rows - 1)) / rows;

        if (cellWidth <= 0 || cellHeight <= 0) continue;

        const font = Math.min(cellWidth * 0.05, cellHeight * 0.16, 24);
        const nameArea = cellWidth * 0.56;
        const required = nameLength * font * 0.52;
        const fill = nameArea > 0 ? Math.min(1, required / nameArea) : 1;
        const score = font * fill;

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
