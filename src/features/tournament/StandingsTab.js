"use client";

import { useMemo, useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { useTournament } from '@/context/TournamentContext';
import { Table, Trophy, Medal, Award, User, Building2, Globe, GraduationCap, Users, Settings, FileDown, ChevronDown } from 'lucide-react';
import { Tooltip, Portal, Menu } from '@skeletonlabs/skeleton-react';
import { calculateStandings, calculateTeamStandings, normalizeTeamStandingOptions } from '@/lib/standingsLogic';
import { loadPlayers } from '@/lib/tournamentStore';
import TeamStandingConfigModal from '@/components/modals/TeamStandingConfigModal';
import PlayerRoundHistoryModal from '@/components/modals/PlayerRoundHistoryModal';

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

const TEAM_SHEET_NAME = 'Team Standings';
const TEAM_TITLE_STYLE_ID = 1;
const TEAM_HEADER_STYLE_ID = 2;
const TEAM_ROW_LEFT_STYLE_ID = 3;
const TEAM_ROW_RIGHT_STYLE_ID = 4;
const TEAM_PRIORITY_RIGHT_STYLE_ID = 5;

const TEAM_EXPORT_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">
<fonts count="4" x14ac:knownFonts="1">
<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><b/><sz val="16"/><color rgb="FF1F2937"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><b/><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
</fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right><top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;

const DEFAULT_TOURNAMENT_CONFIG = {
    numRounds: 5,
    pairingMode: 'all',
    tiebreaks: ['bh', 'sb', 'wins'],
};

const formatNumber = (value) => Number(value || 0).toFixed(1).replace('.0', '');

const safeFilePart = (value) => {
    return String(value || 'tournament')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'tournament';
};

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

const isGroupPairingMode = (config) => config?.pairingMode === 'group';

const getPlayerGroup = (player) => String(player?.group || '').trim();

const buildPlayerGroupLookup = (players = []) => players.reduce((acc, player) => {
    acc[String(player.playerUniqueId)] = getPlayerGroup(player);
    return acc;
}, {});

const getPairingGroup = (pairing, playerGroupLookup = {}) => (
    pairing.group || playerGroupLookup[String(pairing.whiteId)] || playerGroupLookup[String(pairing.blackId)] || ''
);

const getGroupedPlayers = (players = []) => players.reduce((groups, player) => {
    const group = getPlayerGroup(player);
    if (!group) return groups;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(player);
    return groups;
}, new Map());

const filterRoundsForGroup = (rounds = [], group, playerGroupLookup = {}) => rounds.map(round => ({
    ...round,
    pairings: (round.pairings || []).filter(pairing => getPairingGroup(pairing, playerGroupLookup) === group),
}));

export default function StandingsTab() {
    const { activeTournamentId, activeTab, rounds, tournamentConfig, updateTournamentConfig } = useTournament();
    const standingConfig = useMemo(() => ({
        ...DEFAULT_TOURNAMENT_CONFIG,
        ...(tournamentConfig || {}),
        tiebreaks: tournamentConfig?.tiebreaks ?? DEFAULT_TOURNAMENT_CONFIG.tiebreaks,
    }), [tournamentConfig]);
    const [players, setPlayers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [standingMode, setStandingMode] = useState('individual');
    const [showTeamConfigModal, setShowTeamConfigModal] = useState(false);
    const [selectedPlayer, setSelectedPlayer] = useState(null);

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
        const tiebreaks = standingConfig.tiebreaks;
        return calculateStandings(players, rounds, tiebreaks);
    }, [players, rounds, standingConfig]);

    const groupedStandings = useMemo(() => {
        if (!isGroupPairingMode(standingConfig)) return [];

        const tiebreaks = standingConfig.tiebreaks;
        const playerGroupLookup = buildPlayerGroupLookup(players);
        return [...getGroupedPlayers(players).entries()]
            .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
            .map(([group, groupPlayers]) => ({
                group,
                standings: calculateStandings(groupPlayers, filterRoundsForGroup(rounds, group, playerGroupLookup), tiebreaks)
            }));
    }, [players, rounds, standingConfig]);

    const individualStandingRows = useMemo(() => {
        if (!isGroupPairingMode(standingConfig)) {
            return standings.map((player, index) => ({ type: 'player', player, rank: index + 1 }));
        }

        return groupedStandings.flatMap(({ group, standings: groupStandings }) => [
            { type: 'group', group, count: groupStandings.length },
            ...groupStandings.map((player, index) => ({ type: 'player', player, rank: index + 1, group }))
        ]);
    }, [groupedStandings, standings, standingConfig]);

    const teamStandingOptions = useMemo(() => {
        return normalizeTeamStandingOptions(standingConfig.teamStandingOptions);
    }, [standingConfig]);

    const teamStandings = useMemo(() => {
        const tiebreaks = standingConfig.tiebreaks;
        return calculateTeamStandings(players, rounds, tiebreaks, teamStandingOptions);
    }, [players, rounds, standingConfig, teamStandingOptions]);

    const activeTiebreakers = useMemo(() => {
        return standingConfig.tiebreaks;
    }, [standingConfig]);

    const groupedMode = isGroupPairingMode(standingConfig);

    const PlayerInfo = ({ player }) => (
        <Tooltip>
            <Tooltip.Trigger
                element={(attrs) => (
                    <button
                        {...attrs}
                        type="button"
                        onClick={() => setSelectedPlayer(player)}
                        className="flex max-w-full items-center gap-1.5 cursor-pointer group min-w-0 text-left"
                    >
                        <span className="font-bold text-xs leading-tight text-surface-900-100 truncate group-hover:text-primary-500 transition-colors">
                            {player.name}
                        </span>
                    </button>
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
        if (rank === 1) return <Trophy size={14} className="text-yellow-500" />;
        if (rank === 2) return <Medal size={14} className="text-slate-400" />;
        if (rank === 3) return <Award size={14} className="text-amber-600" />;
        return <span className="text-surface-400 font-mono text-[10px]">{rank}</span>;
    };

    const TeamSourceIcon = teamStandingOptions.source === 'club' ? Building2 : Globe;
    const teamSourceLabel = teamStandingOptions.source === 'club' ? 'Club' : 'Fed';
    const teamRankColumns = teamStandingOptions.rankOrder;
    const primaryTeamRankColumn = teamRankColumns[0];

    const handleSaveTeamStandingOptions = (teamStandingOptions) => {
        updateTournamentConfig({
            ...standingConfig,
            teamStandingOptions
        });
    };

    const createSheet = (rows, headers) => {
        return XLSX.utils.json_to_sheet(rows, { header: headers });
    };

    const styleCell = (sheetXml, cellRef, styleId) => {
        const cellPattern = new RegExp(`<c([^>]*\\sr="${cellRef}"[^>]*)>`);
        return sheetXml.replace(cellPattern, (match, attributes) => {
            const nextAttributes = /\ss="\d+"/.test(attributes)
                ? attributes.replace(/\ss="\d+"/, ` s="${styleId}"`)
                : `${attributes} s="${styleId}"`;
            return `<c${nextAttributes}>`;
        });
    };

    const styleRow = (sheetXml, rowNumber, styleId) => {
        const cellPattern = new RegExp(`<c([^>]*\\sr="[A-Z]+${rowNumber}"[^>]*)>`, 'g');
        return sheetXml.replace(cellPattern, (match, attributes) => {
            const nextAttributes = /\ss="\d+"/.test(attributes)
                ? attributes.replace(/\ss="\d+"/, ` s="${styleId}"`)
                : `${attributes} s="${styleId}"`;
            return `<c${nextAttributes}>`;
        });
    };

    const styleCells = (sheetXml, cellRefs, styleId) => (
        cellRefs.reduce((nextXml, cellRef) => styleCell(nextXml, cellRef, styleId), sheetXml)
    );

    const getRowCellRefs = (rowNumber, fromColumn, toColumn) => {
        const refs = [];
        for (let columnIndex = fromColumn; columnIndex <= toColumn; columnIndex += 1) {
            refs.push(`${XLSX.utils.encode_col(columnIndex)}${rowNumber}`);
        }
        return refs;
    };

    const downloadWorkbookBlob = (blob, fileName) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
    };

    const writeStyledStandingsWorkbook = async (workbook, fileName) => {
        const teamSheetIndex = workbook.SheetNames.indexOf(TEAM_SHEET_NAME) + 1;

        if (teamSheetIndex === 0) {
            XLSX.writeFile(workbook, fileName);
            return;
        }

        const workbookBuffer = XLSX.write(workbook, {
            bookType: 'xlsx',
            type: 'array',
            compression: true
        });
        const zip = await JSZip.loadAsync(workbookBuffer);
        const teamSheetPath = `xl/worksheets/sheet${teamSheetIndex}.xml`;
        const teamSheetFile = zip.file(teamSheetPath);

        if (!teamSheetFile) {
            XLSX.writeFile(workbook, fileName);
            return;
        }

        let teamSheetXml = await teamSheetFile.async('string');
        teamSheetXml = styleCell(teamSheetXml, 'A1', TEAM_TITLE_STYLE_ID);
        teamSheetXml = styleRow(teamSheetXml, 2, TEAM_HEADER_STYLE_ID);

        const teamSheetMeta = workbook.Sheets[TEAM_SHEET_NAME]?.['!teamExportMeta'];
        if (teamSheetMeta) {
            const { teamRows = [], firstDataRow = 3, lastDataRow = 2, columnCount = 0 } = teamSheetMeta;

            for (let rowNumber = firstDataRow; rowNumber <= lastDataRow; rowNumber += 1) {
                teamSheetXml = styleCells(teamSheetXml, getRowCellRefs(rowNumber, 0, 0), TEAM_PRIORITY_RIGHT_STYLE_ID);
                if (columnCount > 2) {
                    teamSheetXml = styleCells(teamSheetXml, getRowCellRefs(rowNumber, 2, columnCount - 1), TEAM_PRIORITY_RIGHT_STYLE_ID);
                }
            }

            teamRows.forEach((rowNumber) => {
                teamSheetXml = styleCells(teamSheetXml, getRowCellRefs(rowNumber, 0, 0), TEAM_ROW_RIGHT_STYLE_ID);
                teamSheetXml = styleCells(teamSheetXml, getRowCellRefs(rowNumber, 1, 1), TEAM_ROW_LEFT_STYLE_ID);
                if (columnCount > 2) {
                    teamSheetXml = styleCells(teamSheetXml, getRowCellRefs(rowNumber, 2, columnCount - 1), TEAM_ROW_RIGHT_STYLE_ID);
                }
            });
        }

        zip.file('xl/styles.xml', TEAM_EXPORT_STYLES_XML);
        zip.file(teamSheetPath, teamSheetXml);

        const styledWorkbookBlob = await zip.generateAsync({
            type: 'blob',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        downloadWorkbookBlob(styledWorkbookBlob, fileName);
    };

    const appendIndividualSheet = (workbook) => {
        const tiebreakHeaders = activeTiebreakers.map(tb => TIEBREAK_LABELS[tb] || tb);
        const headers = [groupedMode ? 'Group' : null, 'Rank', 'Id', 'Name', 'Federation', 'Rating', 'Points', ...tiebreakHeaders].filter(Boolean);
        const sourceRows = groupedMode
            ? groupedStandings.flatMap(({ group, standings: groupRows }) => groupRows.map((player, index) => ({ group, player, rank: index + 1 })))
            : standings.map((player, index) => ({ group: '', player, rank: index + 1 }));
        const rows = sourceRows.map(({ group, player, rank }) => {
            const row = {
                ...(groupedMode ? { Group: group } : {}),
                Rank: rank,
                Id: player.playerUniqueId,
                Name: player.name,
                Federation: player.federation,
                Rating: player.rating,
                Points: formatNumber(player.points)
            };

            activeTiebreakers.forEach((tb) => {
                row[TIEBREAK_LABELS[tb] || tb] = formatNumber(player.tiebreakers?.[tb]);
            });

            return row;
        });

        XLSX.utils.book_append_sheet(workbook, createSheet(rows, headers), 'Individual');
    };

    const appendTeamSheets = (workbook) => {
        const headers = ['Rank', 'Team', ...teamRankColumns.map(criterion => TEAM_RANK_LABELS[criterion] || criterion)];
        const rows = [];
        const teamExcelRows = [];
        const rowLevels = [{ hpt: 24 }, { hpt: 18 }];
        const title = `${tournamentConfig?.name || 'Tournament'} - Team Standings`;

        const getPlayerPriorityValue = (player, criterion) => {
            if (criterion === 'score') return formatNumber(player.points);
            if (criterion === 'individualRank' || criterion === 'topRank') return player.individualRank;
            if (criterion === 'count') return player.isGhost ? 0 : 1;
            return '';
        };

        teamStandings.forEach((team, index) => {
            const teamRow = {
                Rank: index + 1,
                Team: team.name
            };

            teamRankColumns.forEach((criterion) => {
                teamRow[TEAM_RANK_LABELS[criterion] || criterion] = formatTeamMetric(team, criterion);
            });

            teamExcelRows.push(rows.length + 3);
            rows.push(teamRow);
            rowLevels.push({});

            team.countedPlayers.forEach((player) => {
                const playerRow = {
                    Rank: '-',
                    Team: `  ${player.name || 'Ghost Player'}`
                };

                teamRankColumns.forEach((criterion) => {
                    playerRow[TEAM_RANK_LABELS[criterion] || criterion] = getPlayerPriorityValue(player, criterion);
                });

                rows.push(playerRow);
                rowLevels.push({ level: 1 });
            });
        });

        const worksheet = XLSX.utils.aoa_to_sheet([[title]]);
        XLSX.utils.sheet_add_json(worksheet, rows, { header: headers, origin: 'A2' });
        worksheet['!cols'] = [
            { wch: 8 },
            { wch: 30 },
            ...teamRankColumns.map(() => ({ wch: 14 }))
        ];
        worksheet['!merges'] = [
            {
                s: { r: 0, c: 0 },
                e: { r: 0, c: headers.length - 1 }
            }
        ];
        worksheet['!rows'] = rowLevels;
        worksheet['!teamExportMeta'] = {
            teamRows: teamExcelRows,
            firstDataRow: 3,
            lastDataRow: rows.length + 2,
            columnCount: headers.length
        };

        if (rows.length > 0) {
            worksheet['!autofilter'] = {
                ref: XLSX.utils.encode_range({
                    s: { r: 1, c: 0 },
                    e: { r: rows.length + 1, c: headers.length - 1 }
                })
            };
        }

        XLSX.utils.book_append_sheet(workbook, worksheet, TEAM_SHEET_NAME);
    };

    const exportStandingsExcel = async (scope) => {
        const workbook = XLSX.utils.book_new();
        const baseFileName = `${safeFilePart(tournamentConfig?.name)}-standings`;

        if (scope === 'individual' || scope === 'both') {
            appendIndividualSheet(workbook);
        }

        if (scope === 'team' || scope === 'both') {
            appendTeamSheets(workbook);
        }

        const suffix = scope === 'both' ? '' : `-${scope}`;
        await writeStyledStandingsWorkbook(workbook, `${baseFileName}${suffix}.xlsx`);
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
                    <Menu onSelect={({ value }) => exportStandingsExcel(value)}>
                        <Menu.Trigger className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded preset-tonal cursor-pointer">
                            <FileDown size={14} />
                            Export
                            <ChevronDown size={12} />
                        </Menu.Trigger>
                        <Portal>
                            <Menu.Positioner>
                                <Menu.Content className="card p-1 preset-filled-surface-100-900 shadow-lg min-w-48">
                                    <Menu.Item value="individual" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                        <Menu.ItemText>Individual Excel</Menu.ItemText>
                                    </Menu.Item>
                                    <Menu.Item value="team" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                        <Menu.ItemText>Team Excel</Menu.ItemText>
                                    </Menu.Item>
                                    <Menu.Item value="both" className="px-3 py-1.5 rounded text-sm cursor-default hover:preset-tonal-primary">
                                        <Menu.ItemText>Both Excel</Menu.ItemText>
                                    </Menu.Item>
                                </Menu.Content>
                            </Menu.Positioner>
                        </Portal>
                    </Menu>
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
                            <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wider text-[9px] text-surface-500 w-10">Rank</th>
                            <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wider text-[9px] text-surface-500 w-10">ID</th>
                            <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wider text-[9px] text-surface-500">Player</th>
                            <th className="px-2 py-1.5 text-center font-semibold uppercase tracking-wider text-[9px] text-surface-500 w-9">Fed</th>
                            <th className="px-2 py-1.5 text-center font-semibold uppercase tracking-wider text-[9px] text-surface-500 w-14">Rating</th>
                            <th className="px-2 py-1.5 text-center font-semibold uppercase tracking-wider text-[9px] text-surface-500 w-14 bg-primary-500/5">Points</th>
                            {activeTiebreakers.map(tb => (
                                <th key={tb} className="px-2 py-1.5 text-center font-semibold uppercase tracking-wider text-[9px] text-surface-500 w-14">
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
                        {individualStandingRows.map((row) => {
                            if (row.type === 'group') {
                                return (
                                    <tr key={`group-${row.group}`} className="bg-surface-50-950/80">
                                        <td colSpan={6 + activeTiebreakers.length} className="px-2 py-2">
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="text-[10px] font-bold uppercase tracking-widest text-primary-500">
                                                    Group {row.group}
                                                </span>
                                                <span className="text-[10px] font-mono text-surface-500">
                                                    {row.count} player{row.count !== 1 ? 's' : ''}
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            }

                            const { player, rank } = row;
                            return (
                                <tr key={`${row.group || 'all'}-${player.playerUniqueId}`} className="hover:bg-surface-200-800/30 transition-colors">
                                    <td className="px-2 py-1.5 text-center">
                                        <div className="flex justify-center">
                                            <RankIcon rank={rank} />
                                        </div>
                                    </td>
                                    <td className="px-2 py-1.5 text-center font-mono text-[10px] text-surface-400">
                                        {player.playerUniqueId}
                                    </td>
                                    <td className="px-2 py-1.5">
                                        <PlayerInfo player={player} />
                                    </td>
                                    <td className="px-2 py-1.5 text-center">
                                        <span className="text-[9px] font-bold text-surface-400 uppercase">{player.federation || '-'}</span>
                                    </td>
                                    <td className="px-2 py-1.5 text-center font-mono text-[10px] text-surface-500">
                                        {player.rating || '-'}
                                    </td>
                                    <td className="px-2 py-1.5 text-center bg-primary-500/5">
                                        <span className="font-bold text-primary-500 text-xs">
                                            {formatNumber(player.points)}
                                        </span>
                                    </td>
                                    {activeTiebreakers.map(tb => (
                                        <td key={tb} className="px-2 py-1.5 text-center font-mono text-[10px] text-surface-600-400">
                                            {formatNumber(player.tiebreakers[tb])}
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                        {individualStandingRows.length === 0 && (
                            <tr>
                                <td colSpan={6 + activeTiebreakers.length} className="px-2 py-10 text-center text-surface-500 italic">
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
                                <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wider text-[9px] text-surface-500 w-10">Rank</th>
                                <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wider text-[9px] text-surface-500">Team</th>
                                <th className="px-2 py-1.5 text-left font-semibold uppercase tracking-wider text-[9px] text-surface-500 min-w-64">Counted Players</th>
                                {teamRankColumns.map((criterion) => (
                                    <th
                                        key={criterion}
                                        className={`px-2 py-1.5 text-center font-semibold uppercase tracking-wider text-[9px] w-14 ${criterion === primaryTeamRankColumn ? 'text-primary-500 bg-primary-500/5' : 'text-surface-500'}`}
                                    >
                                        {TEAM_RANK_LABELS[criterion] || criterion}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-surface-200-800">
                            {teamStandings.map((team, idx) => (
                                <tr key={team.id} className="hover:bg-surface-200-800/30 transition-colors">
                                    <td className="px-2 py-1.5 text-center">
                                        <div className="flex justify-center">
                                            <RankIcon rank={idx + 1} />
                                        </div>
                                    </td>
                                    <td className="px-2 py-1.5">
                                        <div className="flex items-center gap-1.5">
                                            <div className="min-w-0">
                                                <div className="font-bold text-xs leading-tight text-surface-900-100 truncate">{team.name}</div>
                                                <div className="text-[9px] uppercase font-bold text-surface-400 leading-tight">{teamSourceLabel}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-2 py-1.5">
                                        <div className="flex flex-wrap gap-1">
                                            {team.countedPlayers.map(player => (
                                                <button
                                                    key={player.playerUniqueId}
                                                    type="button"
                                                    disabled={player.isGhost}
                                                    onClick={() => !player.isGhost && setSelectedPlayer(player)}
                                                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${player.isGhost ? 'border border-dashed border-surface-300-700 text-surface-500' : 'bg-surface-200-800/60'}`}
                                                    title={player.isGhost ? `Ghost player: Rank ${player.individualRank}, 0 pts` : `Rank ${player.individualRank}, ${formatNumber(player.points)} pts`}
                                                >
                                                    <span className={`font-mono text-[9px] ${player.isGhost ? 'text-surface-400' : 'text-primary-500'}`}>#{player.individualRank}</span>
                                                    <span className="font-medium">{player.name}</span>
                                                    <span className="font-mono text-[9px] text-surface-500">{formatNumber(player.points)}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </td>
                                    {teamRankColumns.map((criterion) => (
                                        <td
                                            key={criterion}
                                            className={`px-2 py-1.5 text-center font-mono ${criterion === primaryTeamRankColumn ? 'bg-primary-500/5 text-primary-500 text-xs font-bold' : 'text-[10px] text-surface-600-400'}`}
                                        >
                                            {formatTeamMetric(team, criterion)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                            {teamStandings.length === 0 && (
                                <tr>
                                    <td colSpan={3 + teamRankColumns.length} className="px-2 py-10 text-center text-surface-500 italic">
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
                config={standingConfig}
                onSave={handleSaveTeamStandingOptions}
            />

            <PlayerRoundHistoryModal
                open={Boolean(selectedPlayer)}
                player={selectedPlayer}
                rounds={rounds}
                players={players}
                onClose={() => setSelectedPlayer(null)}
            />
        </div>
    );
}
