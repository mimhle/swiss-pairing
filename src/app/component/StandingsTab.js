"use client";

import { useMemo, useState, useEffect } from 'react';
import { useTournament } from '@/app/context/TournamentContext';
import { Table, Trophy, Medal, Award, User, Info, Building2, Globe, GraduationCap, Users } from 'lucide-react';
import { Tooltip, Portal } from '@skeletonlabs/skeleton-react';
import { calculateStandings } from '@/app/utilities/standingsLogic';
import { loadPlayers } from './tournamentStore';

const TIEBREAK_LABELS = {
    bh: 'BH',
    bh_cut1: 'BH-C1',
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
    sb: 'Sonneborn-Berger: Sum of scores of defeated opponents plus half of drawn',
    wins: 'Number of Wins: Total games won',
    direct: 'Direct Encounter: Result between tied players',
    progressive: 'Progressive: Sum of cumulative scores after each round',
    wins_black: 'Wins as Black: Number of games won with black pieces',
    games_black: 'Games as Black: Number of rounds played with black pieces'
};

export default function StandingsTab() {
    const { activeTournamentId, activeTab, rounds, tournamentConfig } = useTournament();
    const [players, setPlayers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

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

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <div className="w-8 h-8 border-4 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold flex items-center gap-2">
                    <Table className="text-primary-500" size={24} />
                    Tournament Standings
                </h2>
                <div className="text-sm text-surface-500">
                    After Round {rounds.length}
                </div>
            </div>

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
                                        {player.points}
                                    </span>
                                </td>
                                {activeTiebreakers.map(tb => (
                                    <td key={tb} className="px-4 py-2 text-center font-mono text-xs text-surface-600-400">
                                        {player.tiebreakers[tb]?.toFixed(1).replace('.0', '') || 0}
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
        </div>
    );
}
