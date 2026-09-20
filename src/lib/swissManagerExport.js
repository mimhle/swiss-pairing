/**
 * Utility library for exporting tournament pairings and results in Swiss-Manager format.
 *
 * Swiss-Manager format specification:
 * Header: Ván;Bàn;ID-T;ID-Đ;SốT;SốĐ;Kq T;Kq Đ;Vắng;Kquả;Đsố;Kq RtgT;Kq RtgĐ
 * Delimiter: ; (semicolon)
 * Line terminator: \r\n (CRLF)
 */

export const SWISS_MANAGER_HEADERS = {
    vi: 'Ván;Bàn;ID-T;ID-Đ;SốT;SốĐ;Kq T;Kq Đ;Vắng;Kquả;Đsố;Kq RtgT;Kq RtgĐ',
    en: 'Round;Board;ID-W;ID-B;NoW;NoB;ResW;ResB;Forfeit;Res;Mno;ResRtgW;ResRtgS',
};

export const SWISS_MANAGER_HEADER = SWISS_MANAGER_HEADERS.vi;

/**
 * Checks if a pairing has a played/final result.
 */
export function isPairingCompleted(pairing) {
    if (!pairing) return false;
    if (pairing.isTournamentForfeit) return false;
    if (pairing.isBye) {
        return !pairing.isSkip && (pairing.result === '1-0' || pairing.result === '0.5-0.5');
    }
    return Boolean(pairing.result && pairing.result !== '0-0');
}

/**
 * Checks whether a round contains at least one completed game.
 */
export function roundHasPlayedGames(round) {
    if (!round?.pairings) return false;
    return round.pairings.some(p => !p.isBye && Boolean(p.result && p.result !== '0-0'));
}

/**
 * Formats a single pairing row into the 13 Swiss-Manager columns.
 */
export function formatSwissManagerPairing({
    roundNumber,
    boardNumber,
    pairing,
    whitePlayer,
    blackPlayer,
    isRoundPlayed = true,
    options = {}
}) {
    const {
        decimalSeparator = ',',
        idType = 'zero', // 'zero' or 'fideId'
        awardByeIfRoundPending = false,
    } = options;

    const half = decimalSeparator === '.' ? '0.5' : '0,5';

    // Player IDs: 0 by default, or fideId if option selected and available
    const idWhite = (idType === 'fideId' && whitePlayer?.fideId) ? String(whitePlayer.fideId).trim() : '0';
    const idBlack = (!pairing.isBye && idType === 'fideId' && blackPlayer?.fideId) ? String(blackPlayer.fideId).trim() : '0';

    // Player Numbers / Starting Ranks:
    const numWhite = String(pairing.whiteId ?? whitePlayer?.playerUniqueId ?? '');
    const numBlack = pairing.isBye ? '-1' : String(pairing.blackId ?? blackPlayer?.playerUniqueId ?? '');

    let kqT = '0';
    let kqBlack = '0';
    let vang = '';
    let kqua = '0:0';
    const dso = '0';
    const kqRtgT = '';
    const kqRtgD = '';

    if (pairing.isBye) {
        if (pairing.isSkip || pairing.isTournamentForfeit) {
            kqT = '0';
            kqBlack = '0';
            kqua = '0:0';
        } else if (pairing.result === '0.5-0.5') {
            kqT = half;
            kqBlack = half;
            kqua = `${half}:${half}`;
        } else if (pairing.result === '0-0') {
            kqT = '0';
            kqBlack = '0';
            kqua = '0:0';
        } else {
            // Full-point bye
            // If the round has no played games yet, and not explicitly forced to award:
            const shouldAward = isRoundPlayed || awardByeIfRoundPending || Boolean(pairing.result && pairing.result !== '');
            if (shouldAward && isRoundPlayed) {
                kqT = '1';
                kqBlack = '1';
                kqua = '1:1';
            } else if (shouldAward && !isRoundPlayed && pairing.result === '1-0') {
                // If explicitly set
                kqT = awardByeIfRoundPending ? '1' : '0';
                kqBlack = awardByeIfRoundPending ? '1' : '0';
                kqua = awardByeIfRoundPending ? '1:1' : '0:0';
            } else {
                kqT = '0';
                kqBlack = '0';
                kqua = '0:0';
            }
        }
    } else {
        const result = pairing.result || '';
        switch (result) {
            case '1-0':
                kqT = '1';
                kqBlack = '0';
                kqua = '1:0';
                break;
            case '0-1':
                kqT = '0';
                kqBlack = '1';
                kqua = '0:1';
                break;
            case '0.5-0.5':
                kqT = half;
                kqBlack = half;
                kqua = `${half}:${half}`;
                break;
            case '1-0f':
                kqT = '1';
                kqBlack = '0';
                kqua = '+:-';
                break;
            case '0-1f':
                kqT = '0';
                kqBlack = '1';
                kqua = '-:+';
                break;
            case '0-0':
            case '0-0f':
                kqT = '0';
                kqBlack = '0';
                kqua = '0:0';
                break;
            default:
                // Pending / unplayed match
                kqT = '0';
                kqBlack = '0';
                kqua = '0:0';
                break;
        }
    }

    return [
        roundNumber,
        boardNumber,
        idWhite,
        idBlack,
        numWhite,
        numBlack,
        kqT,
        kqBlack,
        vang,
        kqua,
        dso,
        kqRtgT,
        kqRtgD
    ].join(';');
}

/**
 * Builds a lookup map of playerUniqueId -> player object.
 */
export function buildPlayerMap(players = []) {
    const map = {};
    players.forEach(p => {
        if (p?.playerUniqueId !== undefined && p?.playerUniqueId !== null) {
            map[String(p.playerUniqueId)] = p;
        }
    });
    return map;
}

/**
 * Builds player -> group lookup.
 */
export function buildGroupLookup(players = []) {
    const lookup = {};
    players.forEach(p => {
        if (p?.playerUniqueId) {
            lookup[String(p.playerUniqueId)] = p.group || '';
        }
    });
    return lookup;
}

/**
 * Extracts group for a pairing.
 */
export function getPairingGroup(pairing, groupLookup = {}) {
    return pairing.group ||
        groupLookup[String(pairing.whiteId)] ||
        groupLookup[String(pairing.blackId)] ||
        '';
}

/**
 * Generates Swiss-Manager text for specified rounds and options.
 */
export function generateSwissManagerText(rounds = [], players = [], options = {}) {
    const {
        locale = 'vi',
        selectedRoundNumbers = null, // array of round numbers (e.g. [1, 2, 3]), or null for all
        includePending = true,        // whether to include games with pending/empty results
        group = null,                 // specific group name or null for all
        groupPairingMode = false,     // if true and group is set, re-index board numbers within group
        decimalSeparator = (locale === 'en' ? '.' : ','),
        idType = 'zero',
        awardByeIfRoundPending = false,
    } = options;

    const playerMap = buildPlayerMap(players);
    const groupLookup = buildGroupLookup(players);

    // Filter rounds
    const roundsToProcess = rounds.filter((round, idx) => {
        const roundNum = round.roundNumber ?? idx + 1;
        if (selectedRoundNumbers && selectedRoundNumbers.length > 0) {
            return selectedRoundNumbers.includes(roundNum);
        }
        return true;
    });

    const header = SWISS_MANAGER_HEADERS[locale] || SWISS_MANAGER_HEADERS.vi;
    const rows = [header];

    roundsToProcess.forEach((round, roundIdx) => {
        const roundNum = round.roundNumber ?? (roundIdx + 1);
        const hasPlayed = roundHasPlayedGames(round);
        const pairings = round.pairings || [];

        let currentBoard = 1;

        pairings.forEach((pairing, pairingIdx) => {
            const pairingGroup = getPairingGroup(pairing, groupLookup);

            // If filtering by specific group
            if (group && String(pairingGroup) !== String(group)) {
                return;
            }

            // If completed games only
            if (!includePending && !isPairingCompleted(pairing)) {
                return;
            }

            const whitePlayer = playerMap[String(pairing.whiteId)];
            const blackPlayer = playerMap[String(pairing.blackId)];

            const boardNumber = groupPairingMode ? currentBoard : (pairingIdx + 1);
            currentBoard += 1;

            const rowStr = formatSwissManagerPairing({
                roundNumber: roundNum,
                boardNumber,
                pairing,
                whitePlayer,
                blackPlayer,
                isRoundPlayed: hasPlayed,
                options: {
                    decimalSeparator,
                    idType,
                    awardByeIfRoundPending,
                }
            });

            rows.push(rowStr);
        });
    });

    return rows.join('\r\n') + '\r\n';
}

/**
 * Triggers a browser download of text content.
 */
export function downloadTextFile(content, filename, mimeType = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
