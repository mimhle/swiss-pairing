"use client";

import { X, User, Swords } from 'lucide-react';

const formatScore = (value) => {
    if (value === null || value === undefined || value === '') return '-';
    return Number(value).toFixed(1).replace('.0', '');
};

const getWhitePoints = (result) => {
    if (result === '1-0' || result === '1-0f') return 1;
    if (result === '0.5-0.5') return 0.5;
    return 0;
};

const getBlackPoints = (result) => {
    if (result === '0-1' || result === '0-1f') return 1;
    if (result === '0.5-0.5') return 0.5;
    return 0;
};

const getPlayerRoundScore = (pairing, playerId) => {
    if (!pairing.result) {
        return null;
    }

    const isWhite = String(pairing.whiteId) === playerId;
    return isWhite ? getWhitePoints(pairing.result) : getBlackPoints(pairing.result);
};

const getPairingResultLabel = (pairing) => {
    return pairing.result || 'Pending';
};

const getOpponentLabel = (pairing, playerId, playerMap) => {
    if (pairing.isTournamentForfeit) return 'Forfeit';
    if (pairing.isBye) return pairing.isSkip ? 'Skip' : 'Bye';

    const opponentId = String(pairing.whiteId) === playerId ? pairing.blackId : pairing.whiteId;
    const opponent = playerMap[opponentId];
    return opponent ? `${opponent.name} (#${opponent.playerUniqueId})` : `#${opponentId || '-'}`;
};

const buildHistoryRows = (player, rounds, players) => {
    if (!player) return [];

    const playerId = String(player.playerUniqueId);
    const playerMap = players.reduce((acc, item) => {
        acc[item.playerUniqueId] = item;
        return acc;
    }, {});
    let total = 0;

    return rounds.flatMap((round, roundIndex) => {
        const pairing = (round.pairings || []).find(item => (
            String(item.whiteId) === playerId || String(item.blackId) === playerId
        ));

        if (!pairing) {
            return [{
                roundNumber: round.roundNumber || roundIndex + 1,
                board: '-',
                color: '-',
                opponent: 'Not paired',
                result: '-',
                score: '-',
                total: formatScore(total)
            }];
        }

        const score = getPlayerRoundScore(pairing, playerId);
        if (score !== null) total += score;

        return [{
            roundNumber: round.roundNumber || roundIndex + 1,
            board: (round.pairings || []).indexOf(pairing) + 1,
            color: pairing.isBye ? '-' : (String(pairing.whiteId) === playerId ? 'White' : 'Black'),
            opponent: getOpponentLabel(pairing, playerId, playerMap),
            result: getPairingResultLabel(pairing),
            score: formatScore(score),
            total: formatScore(total)
        }];
    });
};

export default function PlayerRoundHistoryModal({ open, player, rounds = [], players = [], onClose }) {
    if (!open || !player) return null;

    const historyRows = buildHistoryRows(player, rounds, players);
    const finalScore = historyRows.length ? historyRows[historyRows.length - 1].total : '0';

    return (
        <div className="fixed inset-0 z-[220]">
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <div className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none">
                <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-lg border border-surface-200-800 bg-surface-100-900 shadow-xl pointer-events-auto">
                    <div className="flex items-start justify-between gap-4 border-b border-surface-200-800 p-4">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <User size={18} className="text-primary-500 shrink-0" />
                                <h3 className="truncate text-base font-bold text-surface-900-100">{player.name}</h3>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-surface-500">
                                <span>#{player.playerUniqueId}</span>
                                <span>Rating: {player.rating || 'Unrated'}</span>
                                {player.federation && <span>{player.federation}</span>}
                                <span className="font-bold text-primary-500">Total: {finalScore}</span>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded p-1.5 text-surface-500 hover:bg-surface-200-800 hover:text-surface-900-100"
                            aria-label="Close player round history"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    <div className="max-h-[70vh] overflow-auto">
                        {historyRows.length ? (
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-surface-50-950 border-b border-surface-200-800">
                                    <tr>
                                        <th className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-wider text-surface-500">Round</th>
                                        <th className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-wider text-surface-500">Bd</th>
                                        <th className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-wider text-surface-500">Color</th>
                                        <th className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-wider text-surface-500">Opponent</th>
                                        <th className="px-3 py-2 text-center text-[9px] font-semibold uppercase tracking-wider text-surface-500">Result</th>
                                        <th className="px-3 py-2 text-center text-[9px] font-semibold uppercase tracking-wider text-surface-500">Score</th>
                                        <th className="px-3 py-2 text-center text-[9px] font-semibold uppercase tracking-wider text-surface-500">Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-surface-200-800">
                                    {historyRows.map((row) => (
                                        <tr key={row.roundNumber} className="hover:bg-surface-200-800/30">
                                            <td className="px-3 py-2 font-mono text-xs text-surface-600-400">{row.roundNumber}</td>
                                            <td className="px-3 py-2 font-mono text-xs text-surface-500">{row.board}</td>
                                            <td className="px-3 py-2 text-xs text-surface-600-400">{row.color}</td>
                                            <td className="px-3 py-2 text-xs font-medium text-surface-900-100">{row.opponent}</td>
                                            <td className="px-3 py-2 text-center font-mono text-xs text-surface-600-400">{row.result}</td>
                                            <td className="px-3 py-2 text-center font-bold text-primary-500">{row.score}</td>
                                            <td className="px-3 py-2 text-center font-mono text-xs font-bold text-surface-900-100">{row.total}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <div className="flex flex-col items-center justify-center gap-2 p-10 text-center text-surface-500">
                                <Swords size={24} />
                                <p className="text-sm">No rounds have been played by this player.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
