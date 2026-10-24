"use client";

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Dialog, Portal } from '@skeletonlabs/skeleton-react';
import {
    Check,
    Copy,
    ExternalLink,
    Loader2,
    Monitor,
    Radio,
    SlidersHorizontal,
    Smartphone,
    X,
} from 'lucide-react';
import ScrollLock from '@/components/utility/ScrollLock';

export default function LiveSessionModal({
    open,
    onClose,
    sessionId,
    tournamentName = '',
    roundNumber = 0,
    numRounds = 0,
    cardLayout = 'line',
    onCardLayoutChange,
    isStarting = false,
    onStartSession,
    onEndSession,
}) {
    const [origin, setOrigin] = useState('');
    const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
    const [copied, setCopied] = useState('');
    const [actionError, setActionError] = useState('');
    const [isEnding, setIsEnding] = useState(false);
    const [isSavingLayout, setIsSavingLayout] = useState(false);

    const isLive = Boolean(sessionId);
    const arbiterUrl = isLive && origin ? `${origin}/arbiter/${sessionId}` : '';
    const scoreboardUrl = isLive && origin ? `${origin}/scoreboard/${sessionId}` : '';
    const roundLabel = roundNumber
        ? (numRounds ? `Round ${roundNumber} of ${numRounds}` : `Round ${roundNumber}`)
        : '';

    useEffect(() => {
        if (typeof window !== 'undefined') {
            setOrigin(window.location.origin);
        }
    }, []);

    useEffect(() => {
        if (!open) {
            setCopied('');
            setActionError('');
            setIsEnding(false);
            setIsSavingLayout(false);
        }
    }, [open]);

    useEffect(() => {
        if (!open || !arbiterUrl) {
            setQrCodeDataUrl('');
            return undefined;
        }

        let cancelled = false;
        QRCode.toDataURL(arbiterUrl, { margin: 1, width: 256 })
            .then(url => {
                if (!cancelled) setQrCodeDataUrl(url);
            })
            .catch(error => {
                console.error('Failed to generate live session QR code:', error);
                if (!cancelled) setQrCodeDataUrl('');
            });

        return () => {
            cancelled = true;
        };
    }, [open, arbiterUrl]);

    const copyLink = async (value, key) => {
        if (!value) return;

        try {
            await navigator.clipboard.writeText(value);
            setCopied(key);
            window.setTimeout(() => {
                setCopied(current => (current === key ? '' : current));
            }, 1600);
        } catch (error) {
            console.error('Failed to copy live session link:', error);
        }
    };

    const handleStart = async () => {
        setActionError('');
        try {
            await onStartSession?.();
        } catch (error) {
            setActionError(error?.message || 'Failed to start the live session.');
        }
    };

    const handleEnd = async () => {
        setActionError('');
        setIsEnding(true);
        try {
            await onEndSession?.();
        } catch (error) {
            setActionError(error?.message || 'Failed to end the live session.');
        } finally {
            setIsEnding(false);
        }
    };

    const handleLayoutChange = async (nextLayout) => {
        if (nextLayout === cardLayout || isSavingLayout) return;
        setActionError('');
        setIsSavingLayout(true);
        try {
            await onCardLayoutChange?.(nextLayout);
        } catch (error) {
            setActionError(error?.message || 'Failed to update the scoreboard layout.');
        } finally {
            setIsSavingLayout(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={({ open: nextOpen }) => {
            if (!nextOpen) onClose?.();
        }}>
            <Portal>
                {open && <ScrollLock />}
                <Dialog.Backdrop className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40" />
                <Dialog.Positioner className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <Dialog.Content className="bg-surface-100-900 border border-surface-200-800 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
                        <div className="flex items-start justify-between gap-4 border-b border-surface-200-800 px-5 py-4">
                            <div className="flex items-start gap-3 min-w-0">
                                <div className="w-10 h-10 rounded-lg bg-primary-500/10 text-primary-500 flex items-center justify-center shrink-0">
                                    <Radio size={20} />
                                </div>
                                <div className="min-w-0">
                                    <Dialog.Title className="text-lg font-bold flex items-center gap-2 flex-wrap">
                                        Live Session
                                        {isLive && (
                                            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-success-700 dark:text-success-400">
                                                <span className="relative flex h-1.5 w-1.5">
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-400 opacity-75" />
                                                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success-500" />
                                                </span>
                                                Live
                                            </span>
                                        )}
                                    </Dialog.Title>
                                    <Dialog.Description className="text-xs text-surface-600-400 mt-0.5">
                                        {isLive
                                            ? 'Control panel for arbiter input and the live scoreboard.'
                                            : 'Start one live session for arbiter input and the live scoreboard.'}
                                    </Dialog.Description>
                                    {isLive && (tournamentName || roundLabel) && (
                                        <p className="text-xs text-surface-500-400 mt-1 truncate">
                                            {[tournamentName, roundLabel].filter(Boolean).join(' · ')}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <Dialog.CloseTrigger className="p-1.5 hover:bg-surface-200-800 rounded text-surface-500 hover:text-surface-900 dark:hover:text-surface-50 transition-colors cursor-pointer shrink-0">
                                <X size={18} />
                            </Dialog.CloseTrigger>
                        </div>

                        {!isLive ? (
                            <>
                                <div className="p-5">
                                    <div className="rounded-xl border border-dashed border-surface-300-700 bg-surface-50-950 p-5 text-center space-y-4">
                                        <div className="w-12 h-12 rounded-full bg-primary-500/10 text-primary-500 flex items-center justify-center mx-auto">
                                            <Radio size={24} />
                                        </div>
                                        <div className="space-y-1">
                                            <h3 className="text-sm font-bold">Not live yet</h3>
                                            <p className="text-xs text-surface-600-400 max-w-sm mx-auto">
                                                Starting a live session creates a 24-hour link for arbiter result entry and a read-only display for the scoreboard.
                                            </p>
                                        </div>
                                        <div className="grid gap-2 sm:grid-cols-2 text-left max-w-md mx-auto">
                                            <div className="rounded-lg border border-surface-200-800 bg-surface-100-900 px-3 py-2.5">
                                                <p className="text-xs font-semibold flex items-center gap-1.5">
                                                    <Smartphone size={14} className="text-primary-500" />
                                                    Arbiter input
                                                </p>
                                                <p className="text-[11px] text-surface-600-400 mt-0.5">
                                                    Scan a QR code to enter results from a phone.
                                                </p>
                                            </div>
                                            <div className="rounded-lg border border-surface-200-800 bg-surface-100-900 px-3 py-2.5">
                                                <p className="text-xs font-semibold flex items-center gap-1.5">
                                                    <Monitor size={14} className="text-primary-500" />
                                                    Live scoreboard
                                                </p>
                                                <p className="text-[11px] text-surface-600-400 mt-0.5">
                                                    Send a read-only display to a second monitor.
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleStart}
                                            disabled={isStarting}
                                            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                                        >
                                            {isStarting ? <Loader2 size={16} className="animate-spin" /> : <Radio size={16} />}
                                            {isStarting ? 'Starting…' : 'Start live session'}
                                        </button>
                                        {actionError && (
                                            <p className="text-xs text-error-500">{actionError}</p>
                                        )}
                                    </div>
                                </div>
                                <div className="border-t border-surface-200-800 px-5 py-3 flex justify-end">
                                    <button type="button" onClick={onClose} className="btn preset-tonal">
                                        Close
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="p-5 space-y-4">
                                    <section className="rounded-xl border border-surface-200-800 bg-surface-50-950 p-4">
                                        <h3 className="text-sm font-semibold flex items-center gap-1.5">
                                            <Smartphone size={15} className="text-primary-500" />
                                            Arbiter input
                                        </h3>
                                        <div className="mt-3 flex flex-col sm:flex-row gap-4">
                                            <div className="w-48 h-48 mx-auto sm:mx-0 shrink-0 rounded-lg bg-white p-2 flex items-center justify-center">
                                                {qrCodeDataUrl ? (
                                                    <img src={qrCodeDataUrl} alt="Arbiter input QR code" className="w-full h-full" />
                                                ) : (
                                                    <Loader2 size={28} className="animate-spin text-surface-500" />
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0 flex flex-col justify-center gap-2">
                                                <p className="text-xs text-surface-600-400">
                                                    Scan the QR code, or share this link with the arbiter. Anyone with the link can enter results.
                                                </p>
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        readOnly
                                                        value={arbiterUrl}
                                                        className="flex-1 min-w-0 border border-surface-300-700 bg-surface-200-800 text-xs px-2 py-1.5 rounded outline-none text-surface-900 dark:text-surface-50"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => copyLink(arbiterUrl, 'arbiter')}
                                                        className="btn preset-tonal text-xs px-2.5 py-1.5 shrink-0 inline-flex items-center gap-1"
                                                    >
                                                        {copied === 'arbiter' ? <Check size={12} /> : <Copy size={12} />}
                                                        {copied === 'arbiter' ? 'Copied' : 'Copy'}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    <section className="rounded-xl border border-surface-200-800 bg-surface-50-950 p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                                                    <Monitor size={15} className="text-primary-500" />
                                                    Live scoreboard
                                                </h3>
                                                <p className="text-xs text-surface-600-400 mt-0.5">
                                                    Read-only display for a second monitor. It shows the latest paired round.
                                                </p>
                                            </div>
                                            <a
                                                href={scoreboardUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="btn preset-tonal-primary text-xs px-3 py-1.5 flex items-center gap-1.5 shrink-0"
                                            >
                                                Open
                                                <ExternalLink size={12} />
                                            </a>
                                        </div>
                                        <div className="flex items-center gap-2 mt-3">
                                            <input
                                                type="text"
                                                readOnly
                                                value={scoreboardUrl}
                                                className="flex-1 min-w-0 border border-surface-300-700 bg-surface-200-800 text-xs px-2 py-1.5 rounded outline-none text-surface-900 dark:text-surface-50"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => copyLink(scoreboardUrl, 'scoreboard')}
                                                className="btn preset-tonal text-xs px-2.5 py-1.5 shrink-0 inline-flex items-center gap-1"
                                            >
                                                {copied === 'scoreboard' ? <Check size={12} /> : <Copy size={12} />}
                                                {copied === 'scoreboard' ? 'Copied' : 'Copy'}
                                            </button>
                                        </div>
                                    </section>

                                    <section className="rounded-xl border border-surface-200-800 bg-surface-50-950 p-4">
                                        <div className="flex items-start gap-3">
                                            <div className="w-9 h-9 rounded-lg bg-primary-500/10 text-primary-500 flex items-center justify-center shrink-0">
                                                <SlidersHorizontal size={17} />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <h3 className="text-sm font-semibold">Scoreboard controls</h3>
                                                    {isSavingLayout && (
                                                        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-surface-500-400">
                                                            <Loader2 size={10} className="animate-spin" />
                                                            Saving
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-surface-600-400 mt-1">
                                                    Choose how each board is displayed on the live scoreboard.
                                                </p>
                                                <div
                                                    className="mt-3 grid gap-2 sm:grid-cols-2"
                                                    role="group"
                                                    aria-label="Scoreboard layout"
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={() => handleLayoutChange('line')}
                                                        disabled={isSavingLayout}
                                                        aria-pressed={cardLayout === 'line'}
                                                        className={`rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${cardLayout === 'line'
                                                            ? 'border-primary-500 bg-primary-500/10'
                                                            : 'border-surface-200-800 hover:bg-surface-200-800'
                                                        }`}
                                                    >
                                                        <span className="flex items-center justify-between gap-2">
                                                            <span className="text-xs font-semibold">One line</span>
                                                            {cardLayout === 'line' && <Check size={14} className="text-primary-500 shrink-0" />}
                                                        </span>
                                                        <span className="block text-[11px] text-surface-600-400 mt-0.5">
                                                            Compact row with the score between the players.
                                                        </span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleLayoutChange('stacked')}
                                                        disabled={isSavingLayout}
                                                        aria-pressed={cardLayout === 'stacked'}
                                                        className={`rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${cardLayout === 'stacked'
                                                            ? 'border-primary-500 bg-primary-500/10'
                                                            : 'border-surface-200-800 hover:bg-surface-200-800'
                                                        }`}
                                                    >
                                                        <span className="flex items-center justify-between gap-2">
                                                            <span className="text-xs font-semibold">Two rows</span>
                                                            {cardLayout === 'stacked' && <Check size={14} className="text-primary-500 shrink-0" />}
                                                        </span>
                                                        <span className="block text-[11px] text-surface-600-400 mt-0.5">
                                                            Classic cards with one player row above the other.
                                                        </span>
                                                    </button>
                                                </div>
                                                <p className="text-[11px] text-surface-500-400 mt-2">
                                                    The scoreboard switches on its next refresh, about 2 seconds.
                                                </p>
                                            </div>
                                        </div>
                                    </section>

                                    {actionError && (
                                        <p className="text-xs text-error-500">{actionError}</p>
                                    )}
                                </div>
                                <div className="border-t border-surface-200-800 px-5 py-3 flex items-center justify-between gap-3">
                                    <button
                                        type="button"
                                        onClick={onClose}
                                        className="btn preset-tonal"
                                        title="Close this panel; the live session stays active"
                                    >
                                        Hide
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleEnd}
                                        disabled={isEnding}
                                        className="btn bg-red-600 text-white hover:bg-red-700 font-semibold shadow-sm inline-flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                                        title="Stop the arbiter input and scoreboard links"
                                    >
                                        {isEnding && <Loader2 size={14} className="animate-spin" />}
                                        {isEnding ? 'Ending…' : 'End session'}
                                    </button>
                                </div>
                            </>
                        )}
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog>
    );
}
