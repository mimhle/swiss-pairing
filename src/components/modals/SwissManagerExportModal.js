"use client";

import { useState, useEffect, useMemo } from 'react';
import { Portal } from '@skeletonlabs/skeleton-react';
import JSZip from 'jszip';
import {
    X,
    Download,
    Copy,
    Check,
    FileText,
    Settings,
    Layers,
    ListFilter,
    CheckSquare,
    Square,
    Globe
} from 'lucide-react';
import ScrollLock from '@/components/utility/ScrollLock';
import {
    generateSwissManagerText,
    downloadTextFile,
    buildGroupLookup
} from '@/lib/swissManagerExport';

export default function SwissManagerExportModal({
    open,
    onClose,
    rounds = [],
    players = [],
    currentRoundIndex = 0,
    tournamentConfig = {},
    showAlert = null,
}) {
    // Mode: 'all' | 'current' | 'custom'
    const [locale, setLocale] = useState('vi'); // 'vi' | 'en'
    const [roundSelectionMode, setRoundSelectionMode] = useState('all');
    const [selectedRoundNumbers, setSelectedRoundNumbers] = useState([]);
    const [includePending, setIncludePending] = useState(true);
    const [groupFilter, setGroupFilter] = useState('');
    const [exportAsZip, setExportAsZip] = useState(false);
    const [decimalSeparator, setDecimalSeparator] = useState(',');
    const [idType, setIdType] = useState('zero');
    const [fileExtension, setFileExtension] = useState('txt');
    const [awardByeIfRoundPending, setAwardByeIfRoundPending] = useState(false);
    const [copied, setCopied] = useState(false);

    // List of all round numbers
    const allRoundNumbers = useMemo(() => {
        return rounds.map((r, idx) => r.roundNumber ?? (idx + 1));
    }, [rounds]);

    // Unique groups from players
    const uniqueGroups = useMemo(() => {
        const groups = new Set();
        players.forEach(p => {
            if (p.group && String(p.group).trim()) {
                groups.add(String(p.group).trim());
            }
        });
        return Array.from(groups).sort();
    }, [players]);

    // Initialize round selections when opened
    useEffect(() => {
        if (open) {
            setSelectedRoundNumbers(allRoundNumbers);
            setCopied(false);
        }
    }, [open, allRoundNumbers]);

    const isGroupMode = tournamentConfig?.pairingMode === 'group' || uniqueGroups.length > 0;

    // Generated text preview
    const previewContent = useMemo(() => {
        if (!open || rounds.length === 0) return '';

        let selectedRounds = null;
        if (roundSelectionMode === 'current') {
            const curRoundNum = rounds[currentRoundIndex]?.roundNumber ?? (currentRoundIndex + 1);
            selectedRounds = [curRoundNum];
        } else if (roundSelectionMode === 'custom') {
            selectedRounds = selectedRoundNumbers;
        }

        return generateSwissManagerText(rounds, players, {
            locale,
            selectedRoundNumbers: selectedRounds,
            includePending,
            group: groupFilter || null,
            groupPairingMode: tournamentConfig?.pairingMode === 'group',
            decimalSeparator,
            idType,
            awardByeIfRoundPending,
        });
    }, [
        open,
        rounds,
        players,
        locale,
        roundSelectionMode,
        currentRoundIndex,
        selectedRoundNumbers,
        includePending,
        groupFilter,
        tournamentConfig,
        decimalSeparator,
        idType,
        awardByeIfRoundPending,
    ]);

    // Pairing / line stats
    const stats = useMemo(() => {
        if (!previewContent) return { lines: 0, pairings: 0 };
        const lines = previewContent.trim().split(/\r?\n/).filter(Boolean);
        const pairings = Math.max(0, lines.length - 1); // exclude header
        return { lines: lines.length, pairings };
    }, [previewContent]);

    const toggleRound = (roundNum) => {
        setSelectedRoundNumbers(prev => {
            if (prev.includes(roundNum)) {
                return prev.filter(n => n !== roundNum);
            } else {
                return [...prev, roundNum].sort((a, b) => a - b);
            }
        });
    };

    const handleSelectAllRounds = () => {
        setSelectedRoundNumbers(allRoundNumbers);
    };

    const handleClearRounds = () => {
        setSelectedRoundNumbers([]);
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(previewContent);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy to clipboard', err);
            if (showAlert) {
                showAlert('Copy Failed', 'Unable to copy text to clipboard.');
            }
        }
    };

    const handleDownload = async () => {
        if (!rounds.length) {
            if (showAlert) showAlert('Export Failed', 'No rounds available to export.');
            return;
        }

        const tournamentName = tournamentConfig?.name || 'Tournament';
        const safeName = tournamentName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'tournament';

        try {
            if (exportAsZip && uniqueGroups.length > 1) {
                const zip = new JSZip();
                uniqueGroups.forEach(grp => {
                    const groupText = generateSwissManagerText(rounds, players, {
                        locale,
                        selectedRoundNumbers: roundSelectionMode === 'current'
                            ? [rounds[currentRoundIndex]?.roundNumber ?? (currentRoundIndex + 1)]
                            : (roundSelectionMode === 'custom' ? selectedRoundNumbers : null),
                        includePending,
                        group: grp,
                        groupPairingMode: true,
                        decimalSeparator,
                        idType,
                        awardByeIfRoundPending,
                    });
                    const grpSafe = String(grp).toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'group';
                    zip.file(`${safeName}-${grpSafe}.${fileExtension}`, groupText);
                });

                const blob = await zip.generateAsync({ type: 'blob' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `${safeName}-swissmanager-groups.zip`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            } else {
                const roundSuffix = roundSelectionMode === 'current'
                    ? `-r${rounds[currentRoundIndex]?.roundNumber ?? (currentRoundIndex + 1)}`
                    : '';
                const groupSuffix = groupFilter
                    ? `-${String(groupFilter).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
                    : '';
                const filename = `${safeName}${groupSuffix}${roundSuffix}-swissmanager.${fileExtension}`;
                downloadTextFile(previewContent, filename);
            }
            onClose();
        } catch (error) {
            console.error('Download failed:', error);
            if (showAlert) showAlert('Export Failed', error?.message || 'Could not export Swiss-Manager file.');
        }
    };

    if (!open) return null;

    const currentRoundNumber = rounds[currentRoundIndex]?.roundNumber ?? (currentRoundIndex + 1);

    return (
        <Portal>
            <ScrollLock />
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]" onClick={onClose} />
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-3 sm:p-4 pointer-events-none">
                <div className="bg-surface-100-900 border border-surface-200-800 rounded-xl p-5 sm:p-6 w-full max-w-2xl space-y-5 shadow-2xl pointer-events-auto max-h-[92vh] flex flex-col">
                    
                    {/* Modal Header */}
                    <div className="flex items-center justify-between border-b border-surface-200-800 pb-3">
                        <div className="flex items-center gap-2.5">
                            <div className="p-2 rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400">
                                <FileText size={20} />
                            </div>
                            <div>
                                <h2 className="text-base sm:text-lg font-bold">Export for Swiss-Manager</h2>
                                <p className="text-xs text-surface-500">
                                    Semicolon-separated format for Swiss-Manager pairing & score import
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-surface-200-800 rounded-lg transition-colors text-surface-500 hover:text-surface-700 dark:hover:text-surface-300"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {/* Modal Body */}
                    <div className="space-y-5 overflow-y-auto pr-1 flex-1">
                        
                        {/* 1. Round Selection */}
                        <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-wider text-surface-500 flex items-center gap-1.5">
                                <Layers size={13} />
                                Rounds to Export
                            </label>
                            <div className="grid grid-cols-3 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setRoundSelectionMode('all')}
                                    className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors text-center ${
                                        roundSelectionMode === 'all'
                                            ? 'bg-primary-500 text-white border-primary-500 shadow-sm'
                                            : 'bg-surface-50-950 border-surface-200-800 text-surface-700-300 hover:bg-surface-200-800'
                                    }`}
                                >
                                    All Rounds ({allRoundNumbers.length})
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setRoundSelectionMode('current')}
                                    className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors text-center ${
                                        roundSelectionMode === 'current'
                                            ? 'bg-primary-500 text-white border-primary-500 shadow-sm'
                                            : 'bg-surface-50-950 border-surface-200-800 text-surface-700-300 hover:bg-surface-200-800'
                                    }`}
                                >
                                    Current (R{currentRoundNumber})
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setRoundSelectionMode('custom')}
                                    className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors text-center ${
                                        roundSelectionMode === 'custom'
                                            ? 'bg-primary-500 text-white border-primary-500 shadow-sm'
                                            : 'bg-surface-50-950 border-surface-200-800 text-surface-700-300 hover:bg-surface-200-800'
                                    }`}
                                >
                                    Custom ({selectedRoundNumbers.length})
                                </button>
                            </div>

                            {/* Custom round checkboxes if custom mode */}
                            {roundSelectionMode === 'custom' && (
                                <div className="p-3 bg-surface-50-950 border border-surface-200-800 rounded-lg space-y-2 mt-2">
                                    <div className="flex items-center justify-between text-xs pb-1 border-b border-surface-200-800">
                                        <span className="text-surface-500">Pick rounds:</span>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={handleSelectAllRounds}
                                                className="text-primary-600-400 hover:underline"
                                            >
                                                Select all
                                            </button>
                                            <span className="text-surface-300">|</span>
                                            <button
                                                type="button"
                                                onClick={handleClearRounds}
                                                className="text-surface-500 hover:underline"
                                            >
                                                Clear
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto pt-1">
                                        {allRoundNumbers.map(roundNum => {
                                            const isChecked = selectedRoundNumbers.includes(roundNum);
                                            return (
                                                <button
                                                    key={roundNum}
                                                    type="button"
                                                    onClick={() => toggleRound(roundNum)}
                                                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border transition-colors ${
                                                        isChecked
                                                            ? 'bg-primary-500/15 border-primary-500/40 text-primary-600 dark:text-primary-300 font-medium'
                                                            : 'border-surface-200-800 bg-surface-100-900 text-surface-500'
                                                    }`}
                                                >
                                                    {isChecked ? <CheckSquare size={13} /> : <Square size={13} />}
                                                    Round {roundNum}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 2. Filters & Grouping */}
                        <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-wider text-surface-500 flex items-center gap-1.5">
                                <ListFilter size={13} />
                                Filter & Pairing Content
                            </label>
                            
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <label className="flex items-center gap-2 p-2.5 rounded-lg border border-surface-200-800 bg-surface-50-950 cursor-pointer hover:bg-surface-200-800/40 transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={includePending}
                                        onChange={(e) => setIncludePending(e.target.checked)}
                                        className="accent-primary-500 rounded"
                                    />
                                    <div className="text-xs">
                                        <p className="font-medium">Include unplayed pairings</p>
                                        <p className="text-surface-500 text-[11px]">Exports pending games as 0:0</p>
                                    </div>
                                </label>

                                {isGroupMode && uniqueGroups.length > 1 && (
                                    <label className="flex items-center gap-2 p-2.5 rounded-lg border border-surface-200-800 bg-surface-50-950 cursor-pointer hover:bg-surface-200-800/40 transition-colors">
                                        <input
                                            type="checkbox"
                                            checked={exportAsZip}
                                            onChange={(e) => {
                                                setExportAsZip(e.target.checked);
                                                if (e.target.checked) setGroupFilter('');
                                            }}
                                            className="accent-primary-500 rounded"
                                        />
                                        <div className="text-xs">
                                            <p className="font-medium">Export separate files (ZIP)</p>
                                            <p className="text-surface-500 text-[11px]">One file per group section</p>
                                        </div>
                                    </label>
                                )}
                            </div>

                            {/* Group filter dropdown if not ZIP */}
                            {isGroupMode && !exportAsZip && uniqueGroups.length > 0 && (
                                <div className="flex items-center gap-2 pt-1">
                                    <span className="text-xs text-surface-500 whitespace-nowrap">Filter by Group:</span>
                                    <select
                                        value={groupFilter}
                                        onChange={(e) => setGroupFilter(e.target.value)}
                                        className="text-xs bg-surface-50-950 border border-surface-200-800 rounded px-2 py-1.5 focus:outline-none focus:border-primary-500"
                                    >
                                        <option value="">All Groups (Combined)</option>
                                        {uniqueGroups.map(grp => (
                                            <option key={grp} value={grp}>{grp}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>

                        {/* 3. Formatting Options */}
                        <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-wider text-surface-500 flex items-center gap-1.5">
                                <Settings size={13} />
                                Swiss-Manager Formatting
                            </label>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                                {/* Language / Locale */}
                                <div className="p-2.5 rounded-lg border border-surface-200-800 bg-surface-50-950 space-y-1">
                                    <span className="text-[11px] text-surface-500 flex items-center gap-1">
                                        <Globe size={11} />
                                        Locale / Language
                                    </span>
                                    <div className="flex flex-col gap-1 text-xs pt-0.5">
                                        <label className="flex items-center gap-1.5 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="locale"
                                                checked={locale === 'vi'}
                                                onChange={() => {
                                                    setLocale('vi');
                                                    setDecimalSeparator(',');
                                                }}
                                                className="accent-primary-500"
                                            />
                                            <span>Vietnamese (Tiếng Việt)</span>
                                        </label>
                                        <label className="flex items-center gap-1.5 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="locale"
                                                checked={locale === 'en'}
                                                onChange={() => {
                                                    setLocale('en');
                                                    setDecimalSeparator('.');
                                                }}
                                                className="accent-primary-500"
                                            />
                                            <span>English (EN)</span>
                                        </label>
                                    </div>
                                </div>

                                {/* Decimal Separator */}
                                <div className="p-2.5 rounded-lg border border-surface-200-800 bg-surface-50-950 space-y-1">
                                    <span className="text-[11px] text-surface-500 block">Decimal Separator</span>
                                    <div className="flex flex-col gap-1 text-xs pt-0.5">
                                        <label className="flex items-center gap-1.5 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="decSep"
                                                checked={decimalSeparator === ','}
                                                onChange={() => setDecimalSeparator(',')}
                                                className="accent-primary-500"
                                            />
                                            <span>Comma (0,5)</span>
                                        </label>
                                        <label className="flex items-center gap-1.5 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="decSep"
                                                checked={decimalSeparator === '.'}
                                                onChange={() => setDecimalSeparator('.')}
                                                className="accent-primary-500"
                                            />
                                            <span>Dot (0.5)</span>
                                        </label>
                                    </div>
                                </div>

                                {/* ID Column Mapping */}
                                <div className="p-2.5 rounded-lg border border-surface-200-800 bg-surface-50-950 space-y-1">
                                    <span className="text-[11px] text-surface-500 block">
                                        {locale === 'en' ? 'ID Column (ID-W / ID-B)' : 'ID Column (ID-T / ID-Đ)'}
                                    </span>
                                    <div className="flex flex-col gap-1 text-xs pt-0.5">
                                        <label className="flex items-center gap-1.5 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="idType"
                                                checked={idType === 'zero'}
                                                onChange={() => setIdType('zero')}
                                                className="accent-primary-500"
                                            />
                                            <span>0 (Standard)</span>
                                        </label>
                                        <label className="flex items-center gap-1.5 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="idType"
                                                checked={idType === 'fideId'}
                                                onChange={() => setIdType('fideId')}
                                                className="accent-primary-500"
                                            />
                                            <span>FIDE ID</span>
                                        </label>
                                    </div>
                                </div>

                                {/* File Extension */}
                                <div className="p-2.5 rounded-lg border border-surface-200-800 bg-surface-50-950 space-y-1">
                                    <span className="text-[11px] text-surface-500 block">File Extension</span>
                                    <div className="flex flex-col gap-1 text-xs pt-0.5">
                                        <label className="flex items-center gap-1.5 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="fileExt"
                                                checked={fileExtension === 'txt'}
                                                onChange={() => setFileExtension('txt')}
                                                className="accent-primary-500"
                                            />
                                            <span>.txt</span>
                                        </label>
                                        <label className="flex items-center gap-1.5 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="fileExt"
                                                checked={fileExtension === 'csv'}
                                                onChange={() => setFileExtension('csv')}
                                                className="accent-primary-500"
                                            />
                                            <span>.csv</span>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 4. Live Preview */}
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold uppercase tracking-wider text-surface-500">
                                    Preview ({stats.pairings} pairings)
                                </span>
                                <span className="text-[11px] text-surface-400 font-mono">
                                    {previewContent.length} bytes
                                </span>
                            </div>
                            <div className="bg-surface-50-950 border border-surface-200-800 rounded-lg p-2.5 font-mono text-[11px] leading-relaxed max-h-36 overflow-x-auto overflow-y-auto select-all text-surface-700-300">
                                <pre className="whitespace-pre">
                                    {previewContent || '(No pairings matched the selected options)'}
                                </pre>
                            </div>
                        </div>

                    </div>

                    {/* Modal Footer */}
                    <div className="border-t border-surface-200-800 pt-3 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-surface-500">
                            Ready to import into Swiss-Manager
                        </span>

                        <div className="flex items-center gap-2 ml-auto">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-3.5 py-1.5 text-xs font-medium rounded-lg preset-tonal hover:bg-surface-200-800 transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                onClick={handleCopy}
                                disabled={!previewContent}
                                className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-all cursor-pointer ${
                                    copied
                                        ? 'bg-success-500/20 text-success-600 dark:text-success-400 border-success-500/40'
                                        : 'preset-tonal border-surface-200-800 hover:preset-tonal-primary'
                                }`}
                            >
                                {copied ? <Check size={14} /> : <Copy size={14} />}
                                {copied ? 'Copied!' : 'Copy to Clipboard'}
                            </button>

                            <button
                                type="button"
                                onClick={handleDownload}
                                disabled={!previewContent}
                                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg bg-primary-500 hover:bg-primary-600 text-white shadow transition-colors cursor-pointer disabled:opacity-50"
                            >
                                <Download size={14} />
                                {exportAsZip ? 'Download ZIP' : `Download .${fileExtension}`}
                            </button>
                        </div>
                    </div>

                </div>
            </div>
        </Portal>
    );
}
