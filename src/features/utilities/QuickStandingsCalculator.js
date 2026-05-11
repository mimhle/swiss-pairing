"use client";

import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { Dialog, Portal, Tooltip } from '@skeletonlabs/skeleton-react';
import { ArrowLeft, ArrowRight, Award, Building2, FileDown, FileUp, Globe, Medal, Settings, Table, Trophy, Upload, User, Users } from 'lucide-react';
import TeamStandingConfigModal from '@/components/modals/TeamStandingConfigModal';
import { calculateTeamStandingsFromRankedPlayers, DEFAULT_TEAM_STANDING_OPTIONS, normalizeTeamStandingOptions } from '@/lib/standingsLogic';

const BASE_FIELDS = [
    { value: '', label: 'Ignore' },
    { value: 'rank', label: 'Rank' },
    { value: 'playerUniqueId', label: 'Id' },
    { value: 'name', label: 'Name' },
    { value: 'federation', label: 'Federation' },
    { value: 'rating', label: 'Rating' },
    { value: 'club', label: 'Club' },
    { value: 'teamUniqueId', label: 'Team Id' },
    { value: 'points', label: 'Points' },
];

const TIEBREAK_FIELD_COUNT = 8;
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

const HEADER_MAP = new Map([
    ['rank', 'rank'],
    ['rk.', 'rank'],
    ['rk', 'rank'],
    ['ranking', 'rank'],
    ['place', 'rank'],
    ['pos', 'rank'],
    ['hạng', 'rank'],
    ['hang', 'rank'],
    ['id', 'playerUniqueId'],
    ['no', 'playerUniqueId'],
    ['number', 'playerUniqueId'],
    ['số', 'playerUniqueId'],
    ['so', 'playerUniqueId'],
    ['số id', 'playerUniqueId'],
    ['player id', 'playerUniqueId'],
    ['playeruniqueid', 'playerUniqueId'],
    ['name', 'name'],
    ['player', 'name'],
    ['tên', 'name'],
    ['ten', 'name'],
    ['fed', 'federation'],
    ['federation', 'federation'],
    ['ld', 'federation'],
    ['lđ', 'federation'],
    ['rating', 'rating'],
    ['rtg', 'rating'],
    ['rat qt', 'rating'],
    ['rat qg', 'rating'],
    ['club', 'club'],
    ['clb', 'club'],
    ['team id', 'teamUniqueId'],
    ['teamid', 'teamUniqueId'],
    ['teamuniqueid', 'teamUniqueId'],
    ['csố', 'teamUniqueId'],
    ['cso', 'teamUniqueId'],
    ['points', 'points'],
    ['pts.', 'points'],
    ['point', 'points'],
    ['pts', 'points'],
    ['score', 'points'],
    ['điểm', 'points'],
    ['diem', 'points'],
]);

const KNOWN_TIEBREAK_HEADERS = new Set([
    'bh', 'buchholz', 'buchholz cut 1', 'bh-c1', 'bh cut1', 'sb', 'sonneborn berger',
    'wins', 'win', 'w', 'de', 'direct', 'prog', 'progressive', 'hs', 'hs1', 'hs2', 'hs3',
    'hs4', 'hs5', 'tb1', 'tb2', 'tb3', 'tb4', 'tb5'
]);

const formatNumber = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return value || '-';
    return n.toFixed(1).replace('.0', '');
};

const normalizeCell = (value) => String(value ?? '').trim();
const normalizeHeader = (value) => normalizeCell(value).normalize('NFC').toLowerCase();
const hasContent = (value) => normalizeCell(value) !== '';
const parseNumber = (value) => {
    const normalized = normalizeCell(value).replace(',', '.');
    if (!normalized) return null;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
};

function splitDelimitedLine(line, delimiter) {
    const cells = [];
    let current = '';
    let quoted = false;

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === '"') {
            if (quoted && line[i + 1] === '"') {
                current += '"';
                i += 1;
            } else {
                quoted = !quoted;
            }
        } else if (char === delimiter && !quoted) {
            cells.push(current);
            current = '';
        } else {
            current += char;
        }
    }

    cells.push(current);
    return cells.map(normalizeCell);
}

function detectDelimiter(lines) {
    const candidates = ['\t', ';', ','];
    return candidates
        .map(delimiter => ({
            delimiter,
            count: lines.reduce((sum, line) => sum + splitDelimitedLine(line, delimiter).length, 0)
        }))
        .sort((a, b) => b.count - a.count)[0]?.delimiter || ',';
}

function parseDelimitedText(text) {
    const lines = String(text || '').split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return null;
    const delimiter = detectDelimiter(lines);
    const data = lines.map(line => splitDelimitedLine(line, delimiter));
    return rowsFromMatrix(data);
}

function parseExcel(arrayBuffer) {
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        .map(row => row.map(normalizeCell));
    return rowsFromMatrix(data);
}

function isKnownHeader(header) {
    const normalized = normalizeHeader(header);
    return HEADER_MAP.has(normalized) || KNOWN_TIEBREAK_HEADERS.has(normalized) || /^hs\d+$/i.test(normalized);
}

function scoreHeaderRow(row) {
    const nonEmpty = row.filter(hasContent);
    if (nonEmpty.length < 2) return 0;
    const known = nonEmpty.filter(isKnownHeader).length;
    const mapped = nonEmpty.filter(cell => HEADER_MAP.has(normalizeHeader(cell))).length;
    if (known < 2 || mapped < 1) return 0;
    return known * 3 + mapped + Math.min(nonEmpty.length, 8);
}

function findHeaderRow(data) {
    return data.reduce((best, row, index) => {
        const score = scoreHeaderRow(row);
        return score > best.score ? { index, score } : best;
    }, { index: 0, score: 0 }).index;
}

function rowsFromMatrix(data) {
    const nonEmptyRows = data.filter(row => row.some(hasContent));
    if (nonEmptyRows.length < 2) return null;
    const headerRowIndex = findHeaderRow(nonEmptyRows);
    const headers = nonEmptyRows[headerRowIndex].map(normalizeCell);
    const rows = nonEmptyRows.slice(headerRowIndex + 1)
        .map(row => {
            const padded = [...row];
            while (padded.length < headers.length) padded.push('');
            return padded.slice(0, headers.length).map(normalizeCell);
        })
        .filter(row => row.some(hasContent));
    if (!rows.length) return null;
    return { headers, rows };
}

function getSuggestedField(header, used, tiebreakIndex) {
    const normalized = normalizeHeader(header);
    const mapped = HEADER_MAP.get(normalized);
    if (mapped && !used.has(mapped)) return { field: mapped, tiebreakIndex };

    const isTiebreak = KNOWN_TIEBREAK_HEADERS.has(normalized) || /^hs\d+$/i.test(normalized) || /^tb\d+$/i.test(normalized);
    if (isTiebreak && tiebreakIndex < TIEBREAK_FIELD_COUNT) {
        return { field: `tiebreak${tiebreakIndex + 1}`, tiebreakIndex: tiebreakIndex + 1 };
    }

    return { field: '', tiebreakIndex };
}

function suggestMapping(headers) {
    const mapping = {};
    const used = new Set();
    let tiebreakIndex = 0;

    headers.forEach((header, index) => {
        const suggested = getSuggestedField(header, used, tiebreakIndex);
        mapping[index] = suggested.field;
        tiebreakIndex = suggested.tiebreakIndex;
        if (suggested.field && !suggested.field.startsWith('tiebreak')) used.add(suggested.field);
    });

    return mapping;
}

function nextUniqueColumnMap(prev, columnIndex, field) {
    const next = { ...prev, [columnIndex]: field };
    if (field && !field.startsWith('tiebreak')) {
        Object.keys(next).forEach(key => {
            if (key !== String(columnIndex) && next[key] === field) next[key] = '';
        });
    }
    return next;
}

function mappingOptionLabel(option, columnMap) {
    return option.value && !option.value.startsWith('tiebreak') && Object.values(columnMap).includes(option.value)
        ? `✓ ${option.label}`
        : option.label;
}

function getTiebreakLabel(field, columnMap, headers) {
    const index = Object.entries(columnMap).find(([, mappedField]) => mappedField === field)?.[0];
    const header = index !== undefined ? normalizeCell(headers[Number(index)]) : '';
    return header || field.replace('tiebreak', 'TB ');
}

function sortImportedPlayers(players, tiebreakFields) {
    return [...players].sort((a, b) => {
        const aRank = Number(a.importedRank);
        const bRank = Number(b.importedRank);
        const aHasRank = Number.isFinite(aRank);
        const bHasRank = Number.isFinite(bRank);
        if (aHasRank && bHasRank && aRank !== bRank) return aRank - bRank;
        if (aHasRank && bHasRank) return a.sourceIndex - b.sourceIndex;
        if (aHasRank !== bHasRank) return aHasRank ? -1 : 1;
        if (b.points !== a.points) return b.points - a.points;
        for (const field of tiebreakFields) {
            const aValue = Number(a.tiebreakers[field]) || 0;
            const bValue = Number(b.tiebreakers[field]) || 0;
            if (bValue !== aValue) return bValue - aValue;
        }
        if ((Number(b.rating) || 0) !== (Number(a.rating) || 0)) return (Number(b.rating) || 0) - (Number(a.rating) || 0);
        return String(a.name || '').localeCompare(String(b.name || ''));
    });
}

function applyMapping(rawData, columnMap) {
    const tiebreakFields = [...new Set(Object.values(columnMap).filter(field => field?.startsWith('tiebreak')))];
    const hasNameColumn = Object.values(columnMap).includes('name');
    const imported = rawData.rows.map((row, rowIndex) => {
        const player = {
            playerUniqueId: rowIndex + 1,
            name: '',
            federation: '',
            rating: '',
            club: '',
            teamUniqueId: '',
            points: 0,
            importedRank: null,
            sourceIndex: rowIndex,
            tiebreakers: {},
        };

        Object.entries(columnMap).forEach(([idxStr, field]) => {
            if (!field) return;
            const value = normalizeCell(row[Number(idxStr)]);
            if (field === 'rank') player.importedRank = parseNumber(value);
            else if (field === 'playerUniqueId') player.playerUniqueId = value || rowIndex + 1;
            else if (field === 'points') player.points = parseNumber(value) ?? 0;
            else if (field === 'rating') player.rating = parseNumber(value) ?? value;
            else if (field.startsWith('tiebreak')) player.tiebreakers[field] = parseNumber(value) ?? 0;
            else if (field in player) player[field] = value;
        });

        player.hasImportedName = normalizeCell(player.name) !== '';
        if (!player.name) player.name = `Player ${player.playerUniqueId}`;
        return player;
    }).filter(player => !hasNameColumn || player.hasImportedName);

    const maxImportedRank = Math.max(0, ...imported.map(player => Number(player.importedRank)).filter(Number.isFinite));
    let unrankedOffset = 0;
    const sorted = sortImportedPlayers(imported, tiebreakFields).map((player, index) => {
        const importedRank = Number(player.importedRank);
        const individualRank = Number.isFinite(importedRank)
            ? importedRank
            : (maxImportedRank ? maxImportedRank + (++unrankedOffset) : index + 1);
        return {
            ...player,
            rank: individualRank,
            individualRank,
        };
    });

    return { players: sorted, tiebreakFields };
}

function getTeamCountModeSummary(options) {
    if (options.countMode === 'maximum') {
        return options.useGhostPlayers
            ? `Maximum ${options.minPlayerCount} players, with ghosts`
            : `Maximum ${options.minPlayerCount} players, incomplete below`;
    }
    return `Exact ${options.minPlayerCount} players`;
}

function formatTeamMetric(team, criterion) {
    if (criterion === 'score') return formatNumber(team.score);
    return team[criterion];
}

function getPlayerPriorityValue(player, criterion) {
    if (criterion === 'score') return formatNumber(player.points);
    if (criterion === 'individualRank' || criterion === 'topRank') return player.individualRank;
    if (criterion === 'count') return player.isGhost ? 0 : 1;
    return '';
}

function styleCell(sheetXml, cellRef, styleId) {
    const cellPattern = new RegExp(`<c([^>]*\\sr="${cellRef}"[^>]*)>`);
    return sheetXml.replace(cellPattern, (match, attributes) => {
        const nextAttributes = /\ss="\d+"/.test(attributes)
            ? attributes.replace(/\ss="\d+"/, ` s="${styleId}"`)
            : `${attributes} s="${styleId}"`;
        return `<c${nextAttributes}>`;
    });
}

function styleRow(sheetXml, rowNumber, styleId) {
    const cellPattern = new RegExp(`<c([^>]*\\sr="[A-Z]+${rowNumber}"[^>]*)>`, 'g');
    return sheetXml.replace(cellPattern, (match, attributes) => {
        const nextAttributes = /\ss="\d+"/.test(attributes)
            ? attributes.replace(/\ss="\d+"/, ` s="${styleId}"`)
            : `${attributes} s="${styleId}"`;
        return `<c${nextAttributes}>`;
    });
}

function styleCells(sheetXml, cellRefs, styleId) {
    return cellRefs.reduce((nextXml, cellRef) => styleCell(nextXml, cellRef, styleId), sheetXml);
}

function getRowCellRefs(rowNumber, fromColumn, toColumn) {
    const refs = [];
    for (let columnIndex = fromColumn; columnIndex <= toColumn; columnIndex += 1) {
        refs.push(`${XLSX.utils.encode_col(columnIndex)}${rowNumber}`);
    }
    return refs;
}

function downloadWorkbookBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
}

async function writeStyledTeamWorkbook(workbook, fileName) {
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

    const { teamRows = [], firstDataRow = 3, lastDataRow = 2, columnCount = 0 } = workbook.Sheets[TEAM_SHEET_NAME]?.['!teamExportMeta'] || {};
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

    zip.file('xl/styles.xml', TEAM_EXPORT_STYLES_XML);
    zip.file(teamSheetPath, teamSheetXml);

    const styledWorkbookBlob = await zip.generateAsync({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    downloadWorkbookBlob(styledWorkbookBlob, fileName);
}

async function exportTeamStandingsExcel(teamStandings, teamRankColumns) {
    const headers = ['Rank', 'Team', ...teamRankColumns.map(criterion => TEAM_RANK_LABELS[criterion] || criterion)];
    const rows = [];
    const teamExcelRows = [];
    const rowLevels = [{ hpt: 24 }, { hpt: 18 }];

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

    const worksheet = XLSX.utils.aoa_to_sheet([['Quick Team Standing - Team Standings']]);
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

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, TEAM_SHEET_NAME);
    await writeStyledTeamWorkbook(workbook, 'quick-team-standing.xlsx');
}

export default function QuickStandingsCalculator() {
    const [importOpen, setImportOpen] = useState(false);
    const [importPhase, setImportPhase] = useState('input');
    const [rawData, setRawData] = useState(null);
    const [columnMap, setColumnMap] = useState({});
    const [importText, setImportText] = useState('');
    const [fileName, setFileName] = useState('');
    const [players, setPlayers] = useState([]);
    const [tiebreakFields, setTiebreakFields] = useState([]);
    const [tiebreakLabels, setTiebreakLabels] = useState({});
    const [standingMode, setStandingMode] = useState('individual');
    const [teamStandingOptions, setTeamStandingOptions] = useState(DEFAULT_TEAM_STANDING_OPTIONS);
    const [showTeamConfigModal, setShowTeamConfigModal] = useState(false);
    const fileInputRef = useRef(null);

    const normalizedTeamOptions = useMemo(() => normalizeTeamStandingOptions(teamStandingOptions), [teamStandingOptions]);
    const teamStandings = useMemo(() => calculateTeamStandingsFromRankedPlayers(players, normalizedTeamOptions), [players, normalizedTeamOptions]);
    const teamRankColumns = normalizedTeamOptions.rankOrder;
    const primaryTeamRankColumn = teamRankColumns[0];
    const TeamSourceIcon = normalizedTeamOptions.source === 'club' ? Building2 : Globe;
    const teamSourceLabel = normalizedTeamOptions.source === 'club' ? 'Club' : 'Fed';

    const targetOptions = useMemo(() => [
        ...BASE_FIELDS,
        ...Array.from({ length: TIEBREAK_FIELD_COUNT }, (_, index) => ({
            value: `tiebreak${index + 1}`,
            label: `Tiebreak ${index + 1}`
        }))
    ], []);

    const advanceToMapping = (data) => {
        setRawData(data);
        setColumnMap(suggestMapping(data.headers));
        setImportPhase('mapping');
    };

    const handleFileSelect = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        setFileName(file.name);
        setImportText('');

        if (/\.(xlsx|xls)$/i.test(file.name)) {
            file.arrayBuffer().then(buffer => {
                const data = parseExcel(buffer);
                if (data) advanceToMapping(data);
            });
        } else {
            const reader = new FileReader();
            reader.onload = (loadEvent) => {
                const text = loadEvent.target.result ?? '';
                setImportText(text);
                const data = parseDelimitedText(text);
                if (data) advanceToMapping(data);
            };
            reader.readAsText(file, 'utf-8');
        }
    };

    const handleMapPastedText = () => {
        const data = parseDelimitedText(importText);
        if (data) advanceToMapping(data);
    };

    const resetImportState = () => {
        setImportPhase('input');
        setRawData(null);
        setColumnMap({});
        setImportText('');
        setFileName('');
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleImport = () => {
        if (!rawData) return;
        const next = applyMapping(rawData, columnMap);
        setPlayers(next.players);
        setTiebreakFields(next.tiebreakFields);
        setTiebreakLabels(Object.fromEntries(next.tiebreakFields.map(field => [field, getTiebreakLabel(field, columnMap, rawData.headers)])));
        setImportOpen(false);
        resetImportState();
    };

    const RankIcon = ({ rank }) => {
        if (rank === 1) return <Trophy size={14} className="text-yellow-500" />;
        if (rank === 2) return <Medal size={14} className="text-slate-400" />;
        if (rank === 3) return <Award size={14} className="text-amber-600" />;
        return <span className="text-surface-400 font-mono text-[10px]">{rank}</span>;
    };

    const PlayerInfo = ({ player }) => (
        <Tooltip>
            <Tooltip.Trigger
                element={(attrs) => (
                    <span {...attrs} className="flex max-w-full items-center gap-1.5 min-w-0 text-left">
                        <span className="font-bold text-xs leading-tight text-surface-900-100 truncate">
                            {player.name}
                        </span>
                    </span>
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
                                {player.teamUniqueId && (
                                    <div className="flex flex-col col-span-2">
                                        <span className="text-[9px] text-surface-500 uppercase font-bold">Team Id</span>
                                        <span className="text-xs font-medium flex items-center gap-1">
                                            <Users size={10} className="text-surface-400" />
                                            {player.teamUniqueId}
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

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Table className="text-primary-500" size={24} />
                        Quick Team Standing
                    </h2>
                    {players.length > 0 && (
                        <p className="text-xs text-surface-500 mt-1">
                            {players.length} player{players.length !== 1 ? 's' : ''} imported, {tiebreakFields.length} tiebreak column{tiebreakFields.length !== 1 ? 's' : ''} mapped.
                        </p>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded preset-tonal cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        disabled={teamStandings.length === 0}
                        onClick={() => exportTeamStandingsExcel(teamStandings, teamRankColumns)}
                    >
                        <FileDown size={14} />
                        Team Excel
                    </button>
                    <Dialog open={importOpen} onOpenChange={(event) => {
                        setImportOpen(event.open);
                        if (!event.open) resetImportState();
                    }}>
                        <Dialog.Trigger className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded preset-filled cursor-pointer">
                            <Upload size={14} />
                            Import
                        </Dialog.Trigger>
                        <Portal>
                            <Dialog.Backdrop className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" />
                            <Dialog.Positioner className="fixed inset-0 z-50 flex items-center justify-center p-4">
                                <Dialog.Content className={`bg-surface-100-900 border border-surface-200-800 rounded-lg p-6 w-full space-y-4 shadow-xl transition-all ${importPhase === 'mapping' ? 'max-w-2xl' : 'max-w-lg'}`}>
                                    {importPhase === 'input' ? (
                                        <>
                                            <Dialog.Title className="text-base font-semibold">Import Score Table</Dialog.Title>
                                            <Dialog.Description className="text-sm text-surface-600-400">
                                                Supports Excel (.xlsx, .xls), CSV, TSV, text, and semicolon-delimited files.
                                            </Dialog.Description>
                                            <label className="flex items-center gap-3 px-3 py-2.5 border border-dashed border-surface-300-700 rounded-lg cursor-pointer hover:bg-surface-50-950 transition-colors">
                                                <FileUp size={18} className="text-surface-500-400 shrink-0" />
                                                <span className="text-sm truncate">
                                                    {fileName
                                                        ? <span className="text-primary-600-400 font-medium">{fileName}</span>
                                                        : <span className="text-surface-500-400">Choose file - .xlsx, .xls, .csv, .tsv, .txt</span>
                                                    }
                                                </span>
                                                <input
                                                    ref={fileInputRef}
                                                    type="file"
                                                    accept=".xlsx,.xls,.csv,.txt,.tsv"
                                                    className="hidden"
                                                    onChange={handleFileSelect}
                                                />
                                            </label>
                                            <div className="space-y-1">
                                                <p className="text-xs text-surface-500-400">or paste text directly</p>
                                                <textarea
                                                    className="w-full h-32 bg-surface-50-950 border border-surface-200-800 rounded p-2 font-mono text-xs outline-none resize-none focus:ring-1 focus:ring-primary-500"
                                                    placeholder={"Hạng;Số ID;Tên;LĐ;CLB;Điểm;HS1;HS2\n1;12;Player One;VIE;Club A;5;18;12\n2;8;Player Two;VIE;Club B;4.5;17;10"}
                                                    value={importText}
                                                    onChange={event => { setImportText(event.target.value); setFileName(''); }}
                                                />
                                            </div>
                                            <div className="flex justify-between">
                                                <Dialog.CloseTrigger className="px-4 py-1.5 text-sm rounded preset-tonal cursor-pointer">
                                                    Cancel
                                                </Dialog.CloseTrigger>
                                                <button
                                                    className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded preset-filled disabled:opacity-40"
                                                    disabled={!importText.trim()}
                                                    onClick={handleMapPastedText}
                                                >
                                                    Map columns
                                                    <ArrowRight size={14} />
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <Dialog.Title className="text-base font-semibold">Map columns</Dialog.Title>
                                            <Dialog.Description className="text-sm text-surface-600-400">
                                                {rawData?.rows.length} rows detected from <span className="font-medium">{fileName || 'pasted text'}</span>.
                                            </Dialog.Description>
                                            <div className="overflow-y-auto max-h-80 border border-surface-200-800 rounded-lg">
                                                <table className="w-full text-sm">
                                                    <thead className="bg-surface-100-900 border-b border-surface-200-800 sticky top-0">
                                                        <tr>
                                                            <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-surface-600-400 w-36">Source column</th>
                                                            <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-surface-600-400">Sample</th>
                                                            <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-surface-600-400 w-40">Maps to</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {rawData?.headers.map((header, index) => {
                                                            const sample = rawData.rows.slice(0, 3).map(row => row[index]).filter(Boolean).join(', ');
                                                            return (
                                                                <tr key={`${header}-${index}`} className="border-b border-surface-200-800 last:border-0">
                                                                    <td className="px-3 py-2 font-medium truncate max-w-36">{header || `Column ${index + 1}`}</td>
                                                                    <td className="px-3 py-2 text-xs text-surface-600-400 truncate max-w-48">
                                                                        {sample.length > 50 ? `${sample.slice(0, 50)}...` : sample || '-'}
                                                                    </td>
                                                                    <td className="px-3 py-2">
                                                                        <select
                                                                            className="w-full text-sm bg-surface-50-950 border border-surface-200-800 rounded px-2 py-1 outline-none cursor-pointer"
                                                                            value={columnMap[index] ?? ''}
                                                                            onChange={event => setColumnMap(prev => nextUniqueColumnMap(prev, index, event.target.value))}
                                                                        >
                                                                            {targetOptions.map(option => (
                                                                                <option key={option.value} value={option.value}>{mappingOptionLabel(option, columnMap)}</option>
                                                                            ))}
                                                                        </select>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <button
                                                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded preset-tonal"
                                                    onClick={() => setImportPhase('input')}
                                                >
                                                    <ArrowLeft size={14} />
                                                    Back
                                                </button>
                                                <div className="flex gap-2">
                                                    <Dialog.CloseTrigger className="px-4 py-1.5 text-sm rounded preset-tonal cursor-pointer">
                                                        Cancel
                                                    </Dialog.CloseTrigger>
                                                    <button
                                                        className="px-4 py-1.5 text-sm rounded preset-filled cursor-pointer disabled:opacity-40"
                                                        disabled={!Object.values(columnMap).includes('points')}
                                                        onClick={handleImport}
                                                    >
                                                        Show Standings
                                                    </button>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </Dialog.Content>
                            </Dialog.Positioner>
                        </Portal>
                    </Dialog>
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
                </div>
            </div>

            {players.length === 0 ? (
                <div className="border border-dashed border-surface-300-700 rounded-xl bg-surface-100-900 p-10 text-center space-y-3">
                    <div className="mx-auto w-12 h-12 rounded-lg bg-primary-500/10 text-primary-500 flex items-center justify-center">
                        <Table size={24} />
                    </div>
                    <div>
                        <h3 className="font-bold text-surface-900-100">Import a score table to begin</h3>
                        <p className="text-sm text-surface-500 mt-1">Use an already-totaled standings table with player names, points, and optional tiebreak columns.</p>
                    </div>
                </div>
            ) : (
                <>
                    {standingMode === 'team' && (
                        <div className="flex flex-wrap items-center gap-2 text-xs text-surface-500">
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-surface-100-900 border border-surface-200-800">
                                <TeamSourceIcon size={12} />
                                Team from {teamSourceLabel}
                            </span>
                            <span className="px-2 py-1 rounded bg-surface-100-900 border border-surface-200-800">
                                {getTeamCountModeSummary(normalizedTeamOptions)}
                            </span>
                            <span className="px-2 py-1 rounded bg-surface-100-900 border border-surface-200-800">
                                Order: {normalizedTeamOptions.rankOrder.map(id => TEAM_RANK_LABELS[id] || id).join(', ')}
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
                                        {tiebreakFields.map(field => (
                                            <th key={field} className="px-2 py-1.5 text-center font-semibold uppercase tracking-wider text-[9px] text-surface-500 w-14">
                                                {tiebreakLabels[field] || field}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-surface-200-800">
                                    {players.map(player => (
                                        <tr key={player.playerUniqueId} className="hover:bg-surface-200-800/30 transition-colors">
                                            <td className="px-2 py-1.5 text-center">
                                                <div className="flex justify-center">
                                                    <RankIcon rank={player.rank} />
                                                </div>
                                            </td>
                                            <td className="px-2 py-1.5 text-center font-mono text-[10px] text-surface-400">{player.playerUniqueId}</td>
                                            <td className="px-2 py-1.5"><PlayerInfo player={player} /></td>
                                            <td className="px-2 py-1.5 text-center">
                                                <span className="text-[9px] font-bold text-surface-400 uppercase">{player.federation || '-'}</span>
                                            </td>
                                            <td className="px-2 py-1.5 text-center font-mono text-[10px] text-surface-500">{player.rating || '-'}</td>
                                            <td className="px-2 py-1.5 text-center bg-primary-500/5">
                                                <span className="font-bold text-primary-500 text-xs">{formatNumber(player.points)}</span>
                                            </td>
                                            {tiebreakFields.map(field => (
                                                <td key={field} className="px-2 py-1.5 text-center font-mono text-[10px] text-surface-600-400">
                                                    {formatNumber(player.tiebreakers[field])}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
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
                                        {teamRankColumns.map(criterion => (
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
                                    {teamStandings.map((team, index) => (
                                        <tr key={team.id} className="hover:bg-surface-200-800/30 transition-colors">
                                            <td className="px-2 py-1.5 text-center">
                                                <div className="flex justify-center">
                                                    <RankIcon rank={index + 1} />
                                                </div>
                                            </td>
                                            <td className="px-2 py-1.5">
                                                <div className="font-bold text-xs leading-tight text-surface-900-100 truncate">{team.name}</div>
                                                <div className="text-[9px] uppercase font-bold text-surface-400 leading-tight">{teamSourceLabel}</div>
                                            </td>
                                            <td className="px-2 py-1.5">
                                                <div className="flex flex-wrap gap-1">
                                                    {team.countedPlayers.map(player => (
                                                        <span
                                                            key={player.playerUniqueId}
                                                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] ${player.isGhost ? 'border border-dashed border-surface-300-700 text-surface-500' : 'bg-surface-200-800/60'}`}
                                                            title={player.isGhost ? `Ghost player: Rank ${player.individualRank}, 0 pts` : `Rank ${player.individualRank}, ${formatNumber(player.points)} pts`}
                                                        >
                                                            <span className={`font-mono text-[9px] ${player.isGhost ? 'text-surface-400' : 'text-primary-500'}`}>#{player.individualRank}</span>
                                                            <span className="font-medium">{player.name}</span>
                                                            <span className="font-mono text-[9px] text-surface-500">{formatNumber(player.points)}</span>
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                            {teamRankColumns.map(criterion => (
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
                </>
            )}

            <TeamStandingConfigModal
                open={showTeamConfigModal}
                onClose={() => setShowTeamConfigModal(false)}
                config={{ teamStandingOptions }}
                onSave={setTeamStandingOptions}
            />
        </div>
    );
}
