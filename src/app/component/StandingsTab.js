"use client";

import { useMemo, useState, useEffect } from 'react';
import { useTournament } from '@/app/context/TournamentContext';
import { Table, Trophy, Medal, Award, User, Building2, Globe, GraduationCap, Users, Settings } from 'lucide-react';
import { Tooltip, Portal } from '@skeletonlabs/skeleton-react';
import { calculateStandings, calculateTeamStandings, normalizeTeamStandingOptions } from '@/app/utilities/standingsLogic';
import { loadPlayers } from './tournamentStore';
import TeamStandingConfigModal from '@/app/component/TeamStandingConfigModal';

const TIEBREAK_LABELS = {
    bh: 'BH',
    bh_cut1: 'BH-C1',
    bh_virtual_cut1: 'BH-V-C1',
    sb: 'SB',
    wins: 'Wins',
    direct: 'DE',
    progressive: 'Prog',
    wins_black: 'WBlack',
    games_black: 'GBlack'
};

const TIEBREAK_TOOLTIPS = {
    bh: 'Buchholz: Sum of opponents\' scores',
    bh_cut1: 'Buchholz Cut 1: Buchholz minus the lowest opponent score',
    bh_virtual_cut1: 'Buchholz Virtual Cut 1: Unplayed games count as virtual opponents, then the lowest score is excluded',
    sb: 'Sonneborn-Berger: Sum of scores of defeated opponents plus half of drawn',
    wins: 'Number of Wins: Total games won',
    direct: 'Direct Encounter: Result between tied players',
    progressive: 'Progressive: Sum of cumulative scores after each round',
    wins_black: 'Wins as Black: Number of games won with black pieces',
    games_black: 'Games as Black: Number of rounds played with black pieces'
};

const TEAM_RANK_LABELS = {
    individualRank: 'Rank Sum',
    score: 'Score',
    count: 'Count',
    topRank: 'Top Rank'
};

const formatNumber = (value) => Number(value || 0).toFixed(1).replace('.0', '');

const formatTeamMetric = (team, criterion) => {
    if (criterion === 'score') return formatNumber(team.score);
    return team[criterion];
};

const getTeamCountModeSummary = (options) => {
    if (options.countMode === 'maximum') {
        return options.useGhostPlayers
            ? `Maximum ${options.minPlayerCount} players, with ghosts`
            : `Maximum ${options.minPlayerCount} players, incomplete below`;
    }

    return `Exact ${options.minPlayerCount} players`;
};

export default function StandingsTab() {
    const { activeTournamentId, activeTab, rounds, tournamentConfig, updateTournamentConfig } = useTournament();
    const [players, setPlayers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [standingMode, setStandingMode] = useState('individual');
    const [showTeamConfigModal, setShowTeamConfigModal] = useState(false);

    useEffect(() => {
        if (activeTournamentId && activeTab === 'standings') {
            setIsLoading(true);
            loadPlayers(activeTournamentId).then(data => {
                setPlayers(data);
                setIsLoading(false);
            });
        }
    }, [activeTournamentId, activeTab]);

    const standings = useMemo(() => {
        // Use tiebreaks from config if they exist (even if empty array). 
        // Fallback to default only if config is missing or the tiebreaks field is missing.
        const tiebreaks = tournamentConfig?.tiebreaks ?? ['bh', 'sb', 'wins'];
        return calculateStandings(players, rounds, tiebreaks);
    }, [players, rounds, tournamentConfig]);

    const teamStandingOptions = useMemo(() => {
        return normalizeTeamStandingOptions(tournamentConfig?.teamStandingOptions);
    }, [tournamentConfig]);

    const teamStandings = useMemo(() => {
        const tiebreaks = tournamentConfig?.tiebreaks ?? ['bh', 'sb', 'wins'];
        return calculateTeamStandings(players, rounds, tiebreaks, teamStandingOptions);
    }, [players, rounds, tournamentConfig, teamStandingOptions]);

    const activeTiebreakers = useMemo(() => {
        return tournamentConfig?.tiebreaks ?? ['bh', 'sb', 'wins'];
    }, [tournamentConfig]);

    if (!tournamentConfig) return null;

    const PlayerInfo = ({ player }) => (
        <Tooltip>
            <Tooltip.Trigger
                element={(attrs) => (
                    <div {...attrs} className="flex items-center gap-2 cursor-help group">
                        <span className="font-bold text-surface-900-100 group-hover:text-primary-500 transition-colors">
                            {player.name}
                        </span>
                    </div>
                )}
            />
            <Portal>
                <Tooltip.Positioner>
                    <Tooltip.Content className="card p-3 shadow-xl border border-surface-200-800 bg-surface-100-900 text-surface-900-100 min-w-48 z-[200]">
                        <div className="space-y-3">
                            <div className="flex items-center gap-3 pb-2 border-b border-surface-200-800">
                                <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-primary-500/10 text-primary-500 shadow-inner">
                                    <User size={20} />
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-bold text-base leading-tight">{player.name}</span>
                                    <span className="text-xs text-primary-500 font-bold uppercase tracking-wider">Rating: {player.rating || 'Unrated'}</span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                {player.group && (
                                    <div className="flex flex-col">
                                        <span className="text-[9px] text-surface-500 uppercase font-bold">Group</span>
                                        <span className="text-xs font-medium flex items-center gap-1">
                                            <Users size={10} className="text-surface-400" />
                                            {player.group}
                                        </span>
                                    </div>
                                )}
                                {player.title && (
                                    <div className="flex flex-col">
                                        <span className="text-[9px] text-surface-500 uppercase font-bold">Title</span>
                                        <span className="text-xs font-medium flex items-center gap-1">
                                            <GraduationCap size={10} className="text-surface-400" />
                                            {player.title}
                                        </span>
                                    </div>
                                )}
                                {player.club && (
                                    <div className="flex flex-col col-span-2">
                                        <span className="text-[9px] text-surface-500 uppercase font-bold">Club</span>
                                        <span className="text-xs font-medium flex items-center gap-1">
                                            <Building2 size={10} className="text-surface-400" />
                                            {player.club}
                                        </span>
                                    </div>
                                )}
                                {player.federation && (
                                    <div className="flex flex-col col-span-2">
                                        <span className="text-[9px] text-surface-500 uppercase font-bold">Federation</span>
                                        <span className="text-xs font-medium flex items-center gap-1">
                                            <Globe size={10} className="text-surface-400" />
                                            {player.federation}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </Tooltip.Content>
                </Tooltip.Positioner>
            </Portal>
        </Tooltip>
    );

    const RankIcon = ({ rank }) => {
        if (rank === 1) return <Trophy size={16} className="text-yellow-500" />;
        if (rank === 2) return <Medal size={16} className="text-slate-400" />;
        if (rank === 3) return <Award size={16} className="text-amber-600" />;
        return <span className="text-surface-400 font-mono text-xs">{rank}</span>;
    };

    const TeamSourceIcon = teamStandingOptions.source === 'club' ? Building2 : Globe;
    const teamSourceLabel = teamStandingOptions.source === 'club' ? 'Club' : 'Fed';
    const teamRankColumns = teamStandingOptions.rankOrder;
    const primaryTeamRankColumn = teamRankColumns[0];

    const handleSaveTeamStandingOptions = (teamStandingOptions) => {
        updateTournamentConfig({
            ...tournamentConfig,
            teamStandingOptions
        });
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <div className="w-8 h-8 border-4 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-xl font-bold flex items-center gap-2">
                    <Table className="text-primary-500" size={24} />
                    Tournament Standings
                </h2>
                <div className="flex flex-row gap-2 sm:items-end">
                    <div className="flex items-center bg-surface-100-900 border border-surface-200-800 rounded-lg p-1 gap-1">
                        <button
                            onClick={() => setStandingMode('individual')}
                            className={`px-3 py-1.5 text-xs font-bold rounded transition-colors ${standingMode === 'individual' ? 'bg-primary-500 text-white shadow-sm' : 'text-surface-500 hover:text-surface-900-100 hover:bg-surface-200-800'}`}
                        >
                            Individual
                        </button>
                        <button
                            onClick={() => setStandingMode('team')}
                            className={`px-3 py-1.5 text-xs font-bold rounded transition-colors ${standingMode === 'team' ? 'bg-primary-500 text-white shadow-sm' : 'text-surface-500 hover:text-surface-900-100 hover:bg-surface-200-800'}`}
                        >
                            Team
                        </button>
                    </div>
                    <div className="text-sm text-surface-500 m-auto">
                        After Round {rounds.length}
                    </div>
                </div>
            </div>

            {standingMode === 'team' && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-surface-500">
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-surface-100-900 border border-surface-200-800">
                        <TeamSourceIcon size={12} />
                        Team from {teamSourceLabel}
                    </span>
                    <span className="px-2 py-1 rounded bg-surface-100-900 border border-surface-200-800">
                        {getTeamCountModeSummary(teamStandingOptions)}
                    </span>
                    <span className="px-2 py-1 rounded bg-surface-100-900 border border-surface-200-800">
                        Order: {teamStandingOptions.rankOrder.map(id => TEAM_RANK_LABELS[id] || id).join(', ')}
                    </span>
                    <button
                        onClick={() => setShowTeamConfigModal(true)}
                        className="inline-flex items-center justify-center p-1.5 rounded bg-surface-100-900 border border-surface-200-800 hover:bg-surface-200-800 transition-colors text-surface-500 hover:text-primary-500"
                        title="Team standing calculation"
                        aria-label="Configure team standing calculation"
                    >
                        <Settings size={14} />
                    </button>
                </div>
            )}

            {standingMode === 'individual' ? (
                <div className="border border-surface-200-800 rounded-xl overflow-hidden bg-surface-100-900 shadow-sm overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-surface-50-950 border-b border-surface-200-800">
                        <tr>
                            <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-[10px] text-surface-500 w-12">Rank</th>
                            <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-[10px] text-surface-500 w-12">ID</th>
                            <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-[10px] text-surface-500">Player</th>
                            <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-[10px] text-surface-500 w-16">Fed</th>
                            <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-[10px] text-surface-500 w-20">Rating</th>
                            <th className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-[10px] text-surface-500 w-20 bg-primary-500/5">Points</th>
                            {activeTiebreakers.map(tb => (
                                <th key={tb} className="px-4 py-3 text-center font-semibold uppercase tracking-wider text-[10px] text-surface-500 w-20">
                                    <Tooltip>
                                        <Tooltip.Trigger
                                            element={(attrs) => (
                                                <span {...attrs} className="cursor-help border-b border-dotted border-surface-400">
                                                    {TIEBREAK_LABELS[tb] || tb}
                                                </span>
                                            )}
                                        />
                                        <Portal>
                                            <Tooltip.Positioner>
                                                <Tooltip.Content className="bg-surface-800 text-white text-[10px] px-2 py-1 rounded shadow-lg z-[200]">
                                                    {TIEBREAK_TOOLTIPS[tb]}
                                                </Tooltip.Content>
                                            </Tooltip.Positioner>
                                        </Portal>
                                    </Tooltip>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-200-800">
                        {standings.map((player, idx) => (
                            <tr key={player.playerUniqueId} className="hover:bg-surface-200-800/30 transition-colors">
                                <td className="px-4 py-2 text-center">
                                    <div className="flex justify-center">
                                        <RankIcon rank={idx + 1} />
                                    </div>
                                </td>
                                <td className="px-4 py-2 text-center font-mono text-xs text-surface-400">
                                    {player.playerUniqueId}
                                </td>
                                <td className="px-4 py-2">
                                    <PlayerInfo player={player} />
                                </td>
                                <td className="px-4 py-2 text-center">
                                    <span className="text-[10px] font-bold text-surface-400 uppercase">{player.federation || '-'}</span>
                                </td>
                                <td className="px-4 py-2 text-center font-mono text-xs text-surface-500">
                                    {player.rating || '-'}
                                </td>
                                <td className="px-4 py-2 text-center bg-primary-500/5">
                                    <span className="font-bold text-primary-500 text-base">
                                        {formatNumber(player.points)}
                                    </span>
                                </td>
                                {activeTiebreakers.map(tb => (
                                    <td key={tb} className="px-4 py-2 text-center font-mono text-xs text-surface-600-400">
                                        {formatNumber(player.tiebreakers[tb])}
                                    </td>
                                ))}
                            </tr>
                        ))}
                        {standings.length === 0 && (
                            <tr>
                                <td colSpan={6 + activeTiebreakers.length} className="px-4 py-12 text-center text-surface-500 italic">
                                    No players found in this tournament.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
                </div>
            ) : (
                <div className="border border-surface-200-800 rounded-xl overflow-hidden bg-surface-100-900 shadow-sm overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-50-950 border-b border-surface-200-800">
                            <tr>
                                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-[10px] text-surface-500 w-12">Rank</th>
                                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-[10px] text-surface-500">Team</th>
                                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-[10px] text-surface-500 min-w-72">Counted Players</th>
                                {teamRankColumns.map((criterion) => (
                                    <th
                                        key={criterion}
                                        className={`px-4 py-3 text-center font-semibold uppercase tracking-wider text-[10px] w-20 ${criterion === primaryTeamRankColumn ? 'text-primary-500 bg-primary-500/5' : 'text-surface-500'}`}
                                    >
                                        {TEAM_RANK_LABELS[criterion] || criterion}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-surface-200-800">
                            {teamStandings.map((team, idx) => (
                                <tr key={team.id} className="hover:bg-surface-200-800/30 transition-colors">
                                    <td className="px-4 py-2 text-center">
                                        <div className="flex justify-center">
                                            <RankIcon rank={idx + 1} />
                                        </div>
                                    </td>
                                    <td className="px-4 py-2">
                                        <div className="flex items-center gap-2">
                                            <div className="min-w-0">
                                                <div className="font-bold text-surface-900-100 truncate">{team.name}</div>
                                                <div className="text-[10px] uppercase font-bold text-surface-400">{teamSourceLabel}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-2">
                                        <div className="flex flex-wrap gap-1.5">
                                            {team.countedPlayers.map(player => (
                                                <span
                                                    key={player.playerUniqueId}
                                                    className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${player.isGhost ? 'border border-dashed border-surface-300-700 text-surface-500' : 'bg-surface-200-800/60'}`}
                                                    title={player.isGhost ? `Ghost player: Rank ${player.individualRank}, 0 pts` : `Rank ${player.individualRank}, ${formatNumber(player.points)} pts`}
                                                >
                                                    <span className={`font-mono text-[10px] ${player.isGhost ? 'text-surface-400' : 'text-primary-500'}`}>#{player.individualRank}</span>
                                                    <span className="font-medium">{player.name}</span>
                                                    <span className="font-mono text-[10px] text-surface-500">{formatNumber(player.points)}</span>
                                                </span>
                                            ))}
                                        </div>
                                    </td>
                                    {teamRankColumns.map((criterion) => (
                                        <td
                                            key={criterion}
                                            className={`px-4 py-2 text-center font-mono ${criterion === primaryTeamRankColumn ? 'bg-primary-500/5 text-primary-500 text-base font-bold' : 'text-xs text-surface-600-400'}`}
                                        >
                                            {formatTeamMetric(team, criterion)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                            {teamStandings.length === 0 && (
                                <tr>
                                    <td colSpan={3 + teamRankColumns.length} className="px-4 py-12 text-center text-surface-500 italic">
                                        No teams meet the current team standing options.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            <TeamStandingConfigModal
                open={showTeamConfigModal}
                onClose={() => setShowTeamConfigModal(false)}
                config={tournamentConfig}
                onSave={handleSaveTeamStandingOptions}
            />
        </div>
    );
}
