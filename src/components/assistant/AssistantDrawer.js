"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, Send, Settings, Sparkles, Trash2, X } from "lucide-react";
import { useTournament } from "@/context/TournamentContext";
import {
    createAssistantToolContext,
    executeAssistantTool,
} from "@/lib/assistantExecutor";
import {
    clearAssistantConfig,
    loadAssistantConfig,
    saveAssistantConfig,
} from "@/lib/assistantStorage";
import { readAssistantStream } from "@/lib/assistantStream";
import AssistantSettings from "./AssistantSettings";

const MAX_TOOL_TURNS = 12;

const SUGGESTIONS = [
    "Who is leading?",
    "Show the latest round pairings.",
    "Explain the tiebreaks being used.",
    "Add a player named Nguyen Van A, rating 1800.",
];

const TOOL_STATUS_LABELS = {
    get_tournament_summary: "Reading the tournament summary...",
    get_players: "Reading players...",
    get_standings: "Calculating standings...",
    get_rounds: "Reading rounds and results...",
    get_player_history: "Reading player history...",
    get_pairings_preview: "Generating a pairing preview...",
    add_players: "Adding players...",
    update_player: "Updating player...",
    delete_player: "Removing player...",
    apply_column_template: "Applying column template...",
    enter_results: "Saving results...",
};

const TOOL_ACTIVITY_LABELS = {
    get_tournament_summary: "Read tournament summary",
    get_players: "Read players",
    get_standings: "Calculated standings",
    get_rounds: "Read rounds",
    get_player_history: "Read player history",
    get_pairings_preview: "Generated pairing preview",
    add_players: "Added players",
    update_player: "Updated player",
    delete_player: "Removed player",
    apply_column_template: "Applied column template",
    enter_results: "Saved results",
};

function summarizeToolResult(name, result) {
    if (!result) return "No result";
    if (result.error) return result.error;

    switch (name) {
        case "get_tournament_summary":
            return `${result.playerCount} players, ${result.roundCount} rounds`;
        case "get_players":
            return `${result.returnedPlayers} of ${result.totalPlayers}`;
        case "get_standings":
            return `${result.returnedStandings} of ${result.totalPlayers} ranked`;
        case "get_rounds":
            return `${result.returnedRounds} round(s)`;
        case "get_player_history":
            return result.player?.name || "Player history";
        case "get_pairings_preview":
            return `${result.pairings?.length || 0} boards`;
        case "add_players":
            return `${result.addedCount} added; total ${result.totalPlayers}${result.skipped?.length ? `, ${result.skipped.length} skipped` : ""}`;
        case "update_player":
            return result.updated?.name || "Player updated";
        case "delete_player":
            return result.removed?.name || "Player removed";
        case "apply_column_template":
            return result.updatedCount === 0
                ? `No changes in ${result.column}`
                : `${result.updatedCount} of ${result.totalPlayers} in ${result.column}`;
        case "enter_results":
            return `Round ${result.roundNumber}: ${result.updatedCount} updated, ${result.pendingResults} pending${result.skipped?.length ? `, ${result.skipped.length} skipped` : ""}`;
        default:
            return "Done";
    }
}

function formatAssistantContent(content) {
    return String(content || "")
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1");
}

function MessageBubble({ message }) {
    const isUser = message.role === "user";
    const content = isUser ? message.content : formatAssistantContent(message.content);

    return (
        <div className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
            {!isUser && (
                <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-500 text-white">
                    <Sparkles size={14} />
                </div>
            )}
            <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    isUser
                        ? "bg-primary-500 text-white"
                        : "bg-surface-200-800 text-surface-950-50"
                }`}
            >
                {content}
            </div>
        </div>
    );
}

export default function AssistantDrawer() {
    const pathname = usePathname();
    const {
        activeTournamentId,
        tournaments,
        tournamentConfig,
        rounds,
        notifyExternalDataChange,
    } = useTournament();

    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [isSending, setIsSending] = useState(false);
    const [toolStatus, setToolStatus] = useState("");
    const [activityLog, setActivityLog] = useState([]);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [error, setError] = useState("");
    const [aiConfig, setAiConfig] = useState(() => loadAssistantConfig());
    const [serverEnabled, setServerEnabled] = useState(null);
    const [serverModel, setServerModel] = useState("");
    const [configReady, setConfigReady] = useState(false);
    const [showSettings, setShowSettings] = useState(false);

    const scrollRef = useRef(null);
    const inputRef = useRef(null);
    const messagesRef = useRef(messages);
    const sendingRef = useRef(false);
    const abortRef = useRef(null);
    const sendGenerationRef = useRef(0);
    const lastTournamentRef = useRef(activeTournamentId);

    const isConfigured = Boolean(aiConfig?.apiKey) || Boolean(serverEnabled);
    const activeModel = aiConfig?.apiKey ? aiConfig.model : (serverEnabled ? serverModel : "");

    const visibleMessages = useMemo(
        () => messages.filter(message => (
            message.role === "user"
            || (message.role === "assistant" && message.content)
        )),
        [messages]
    );

    useEffect(() => {
        let cancelled = false;

        fetch("/api/assistant")
            .then(response => response.json())
            .then(data => {
                if (cancelled) return;
                setServerEnabled(Boolean(data?.enabled));
                setServerModel(data?.model || "");
                setConfigReady(true);
            })
            .catch(() => {
                if (cancelled) return;
                setServerEnabled(false);
                setConfigReady(true);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!open || showSettings) return;
        const timer = setTimeout(() => inputRef.current?.focus(), 50);
        return () => clearTimeout(timer);
    }, [open, showSettings]);

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = event => {
            if (event.key !== "Escape") return;
            if (showSettings) {
                setShowSettings(false);
                return;
            }
            setOpen(false);
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [open, showSettings]);

    useEffect(() => {
        if (!scrollRef.current) return;
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [visibleMessages, isSending, toolStatus, showSettings]);

    useEffect(() => {
        if (!isSending) {
            setElapsedSeconds(0);
            return;
        }

        const startedAt = Date.now();
        setElapsedSeconds(0);
        const interval = setInterval(() => {
            setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
        }, 1000);

        return () => clearInterval(interval);
    }, [isSending]);

    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    useEffect(() => {
        if (lastTournamentRef.current === activeTournamentId) return;
        lastTournamentRef.current = activeTournamentId;
        sendGenerationRef.current += 1;
        abortRef.current?.abort();
        abortRef.current = null;
        sendingRef.current = false;
        messagesRef.current = [];
        setMessages([]);
        setError("");
        setToolStatus("");
        setActivityLog([]);
        setElapsedSeconds(0);
        setIsSending(false);
    }, [activeTournamentId]);

    const clearChat = useCallback(() => {
        messagesRef.current = [];
        setMessages([]);
        setError("");
        setToolStatus("");
        setActivityLog([]);
        setElapsedSeconds(0);
        setInput("");
    }, []);

    const closeDrawer = useCallback(() => {
        setOpen(false);
        setShowSettings(false);
    }, []);

    const toggleDrawer = () => {
        if (open) {
            closeDrawer();
        } else {
            setOpen(true);
        }
    };

    const handleSaveConfig = useCallback(config => {
        const saved = saveAssistantConfig(config);
        if (!saved) return false;
        setAiConfig(loadAssistantConfig());
        setShowSettings(false);
        setError("");
        return true;
    }, []);

    const handleRemoveConfig = useCallback(() => {
        const removed = clearAssistantConfig();
        if (!removed) return false;
        setAiConfig(null);
        setShowSettings(false);
        setError("");
        return true;
    }, []);

    const sendMessage = useCallback(async (text) => {
        const trimmed = String(text || "").trim();
        if (!trimmed || sendingRef.current) return;

        if (!isConfigured) {
            setError("Add your API key in the assistant settings first.");
            setShowSettings(true);
            return;
        }

        const generation = sendGenerationRef.current;
        const baseMessages = messagesRef.current;
        const userMessage = { role: "user", content: trimmed };
        let conversation = [...baseMessages, userMessage];
        const commit = nextMessages => {
            messagesRef.current = nextMessages;
            setMessages(nextMessages);
        };

        sendingRef.current = true;
        setIsSending(true);
        setError("");
        setInput("");
        setToolStatus("Thinking...");
        setActivityLog([]);
        setElapsedSeconds(0);
        commit(conversation);

        const controller = new AbortController();
        abortRef.current = controller;

        try {
            const toolContext = createAssistantToolContext({
                activeTournamentId,
                tournaments,
                tournamentConfig,
                rounds,
                onDataChanged: notifyExternalDataChange,
            });

            const requestHeaders = { "Content-Type": "application/json" };
            const aiRequestConfig = {};
            if (aiConfig?.apiKey) {
                requestHeaders["x-ai-api-key"] = aiConfig.apiKey;
                aiRequestConfig.aiBaseUrl = aiConfig.baseUrl;
                aiRequestConfig.aiModel = aiConfig.model;
                aiRequestConfig.aiReasoning = aiConfig.reasoning;
            }

            for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
                if (generation !== sendGenerationRef.current) return;

                setToolStatus("Thinking...");

                const response = await fetch("/api/assistant", {
                    method: "POST",
                    headers: requestHeaders,
                    signal: controller.signal,
                    body: JSON.stringify({
                        messages: conversation,
                        stream: true,
                        context: {
                            activeTournamentId,
                            tournaments: tournaments.map(tournament => ({
                                id: tournament.id,
                                name: tournament.name,
                            })),
                            activeTournament: tournaments.find(
                                tournament => tournament.id === activeTournamentId
                            ) || null,
                            config: tournamentConfig ? {
                                name: tournamentConfig.name,
                                numRounds: tournamentConfig.numRounds,
                                pairingMode: tournamentConfig.pairingMode,
                                tiebreaks: tournamentConfig.tiebreaks,
                            } : null,
                            roundCount: toolContext.rounds.length,
                        },
                        ...aiRequestConfig,
                    }),
                });

                if (generation !== sendGenerationRef.current) return;

                if (!response.ok) {
                    let data = null;
                    try {
                        data = await response.json();
                    } catch (_) {
                        data = null;
                    }
                    throw new Error(data?.error || `AI request failed (${response.status}).`);
                }

                const assistantIndex = conversation.length;
                conversation = [...conversation, { role: "assistant", content: "" }];
                commit(conversation);

                let sawDelta = false;
                const updateAssistantContent = content => {
                    conversation = conversation.map((message, index) => (
                        index === assistantIndex
                            ? { ...message, content }
                            : message
                    ));
                    commit(conversation);
                };

                const streamed = await readAssistantStream(response, {
                    onDelta: (_delta, fullContent) => {
                        if (!sawDelta) {
                            sawDelta = true;
                            setToolStatus("Writing answer...");
                        }
                        updateAssistantContent(fullContent);
                    },
                });

                if (generation !== sendGenerationRef.current) return;

                const finalContent = streamed.content || "";
                const toolCalls = streamed.toolCalls || [];
                conversation = conversation.map((message, index) => (
                    index === assistantIndex
                        ? {
                            ...message,
                            content: finalContent,
                            ...(toolCalls.length > 0 ? { toolCalls } : {}),
                        }
                        : message
                ));
                commit(conversation);

                if (toolCalls.length === 0) {
                    setToolStatus("");
                    return;
                }

                const toolMessages = [];
                for (const toolCall of toolCalls) {
                    if (generation !== sendGenerationRef.current) return;

                    const activityId = `${toolCall.id}-${Date.now()}`;
                    setActivityLog(previous => [
                        ...previous,
                        {
                            id: activityId,
                            name: toolCall.name,
                            label: TOOL_ACTIVITY_LABELS[toolCall.name] || toolCall.name,
                            status: "running",
                            detail: "",
                        },
                    ]);
                    setToolStatus(TOOL_STATUS_LABELS[toolCall.name] || "Working...");

                    const result = await executeAssistantTool({
                        name: toolCall.name,
                        arguments: toolCall.arguments,
                        context: toolContext,
                    });

                    if (generation !== sendGenerationRef.current) return;

                    setActivityLog(previous => previous.map(item => (
                        item.id === activityId
                            ? {
                                ...item,
                                status: result?.error ? "error" : "done",
                                detail: summarizeToolResult(toolCall.name, result),
                            }
                            : item
                    )));

                    toolMessages.push({
                        role: "tool",
                        toolCallId: toolCall.id,
                        name: toolCall.name,
                        content: JSON.stringify(result),
                    });
                }

                conversation = [...conversation, ...toolMessages];
                commit(conversation);
                setToolStatus("Thinking...");
            }

            throw new Error("The assistant used too many tool steps. Please try a more specific question.");
        } catch (err) {
            if (generation !== sendGenerationRef.current) return;
            if (err?.name === "AbortError") return;
            commit(baseMessages);
            setError(err?.message || "Something went wrong.");
            setInput(trimmed);
        } finally {
            if (generation === sendGenerationRef.current) {
                sendingRef.current = false;
                setIsSending(false);
                setToolStatus("");
                if (abortRef.current === controller) abortRef.current = null;
            }
        }
    }, [activeTournamentId, tournaments, tournamentConfig, rounds, aiConfig, isConfigured, notifyExternalDataChange]);

    const handleSubmit = event => {
        event.preventDefault();
        sendMessage(input);
    };

    const handleKeyDown = event => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendMessage(input);
        }
    };

    if (pathname?.startsWith("/arbiter")) return null;
    if (process.env.NEXT_PUBLIC_AI_ASSISTANT_ENABLED === "false") return null;

    return (
        <>
            <button
                type="button"
                onClick={toggleDrawer}
                className="fixed bottom-4 right-4 z-[70] flex h-12 w-12 items-center justify-center rounded-full bg-primary-500 text-white shadow-lg transition hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
                aria-label={open ? "Close tournament assistant" : "Open tournament assistant"}
            >
                {open ? <X size={20} /> : <Sparkles size={20} />}
            </button>

            {open && (
                <div
                    role="dialog"
                    aria-label="Tournament assistant"
                    className="fixed bottom-20 right-4 z-[70] flex h-[min(600px,calc(100vh-6rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-surface-200-800 bg-surface-50-950 shadow-2xl"
                >
                    <div className="flex items-center justify-between border-b border-surface-200-800 bg-surface-100-900 px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-500 text-white">
                                <Sparkles size={16} />
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm font-semibold">Tournament Assistant</p>
                                <p className="truncate text-[11px] text-surface-500-400">
                                    {aiConfig?.apiKey
                                        ? `Your key${activeModel ? ` · ${activeModel}` : ""}`
                                        : !configReady
                                            ? "Checking AI settings..."
                                            : serverEnabled
                                                ? `Server key${serverModel ? ` · ${serverModel}` : ""}`
                                                : "Not configured"}
                                </p>
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            {!showSettings && (
                                <button
                                    type="button"
                                    onClick={() => setShowSettings(true)}
                                    className="rounded p-1.5 text-surface-500-400 transition hover:bg-surface-200-800 hover:text-surface-950-50"
                                    aria-label="AI settings"
                                    title="AI settings"
                                >
                                    <Settings size={16} />
                                </button>
                            )}
                            {!showSettings && (
                                <button
                                    type="button"
                                    onClick={clearChat}
                                    className="rounded p-1.5 text-surface-500-400 transition hover:bg-surface-200-800 hover:text-surface-950-50"
                                    aria-label="Clear chat"
                                    title="Clear chat"
                                >
                                    <Trash2 size={16} />
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={closeDrawer}
                                className="rounded p-1.5 text-surface-500-400 transition hover:bg-surface-200-800 hover:text-surface-950-50"
                                aria-label="Close assistant"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>

                    {showSettings ? (
                        <AssistantSettings
                            initialConfig={aiConfig}
                            serverEnabled={Boolean(serverEnabled)}
                            serverModel={serverModel}
                            onSave={handleSaveConfig}
                            onRemove={handleRemoveConfig}
                            onCancel={() => setShowSettings(false)}
                        />
                    ) : (
                        <>
                            <div ref={scrollRef} className="flex-1 min-h-0 space-y-3 overflow-y-auto px-4 py-4">
                                {configReady && !isConfigured && (
                                    <div className="rounded-xl border border-surface-200-800 bg-surface-100-900 p-4 text-sm">
                                        <div className="mb-2 flex items-center gap-2 font-semibold">
                                            <AlertTriangle size={16} className="text-warning-500" />
                                            AI assistant is not configured
                                        </div>
                                        <p className="text-surface-600-400">
                                            Add your API key and model in the assistant settings to enable this assistant.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => setShowSettings(true)}
                                            className="mt-3 rounded-lg bg-primary-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-primary-600"
                                        >
                                            Set up AI
                                        </button>
                                    </div>
                                )}

                                {isConfigured && visibleMessages.length === 0 && (
                                    <div className="space-y-3">
                                        <p className="text-sm text-surface-600-400">
                                            Ask about the active tournament. I can read players, rounds, results, and standings. I can add players, update player fields, remove unpaired players, and enter results. I cannot generate pairings or change settings.
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                            {SUGGESTIONS.map(suggestion => (
                                                <button
                                                    key={suggestion}
                                                    type="button"
                                                    onClick={() => sendMessage(suggestion)}
                                                    className="rounded-full border border-surface-200-800 bg-surface-100-900 px-3 py-1.5 text-xs transition hover:border-primary-500 hover:text-primary-500"
                                                >
                                                    {suggestion}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {visibleMessages.map((message, index) => (
                                    <MessageBubble key={`${message.role}-${index}`} message={message} />
                                ))}

                                {isSending && (
                                    <div className="flex justify-start gap-2">
                                        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-500 text-white">
                                            <Sparkles size={14} />
                                        </div>
                                        <div className="min-w-0 rounded-2xl bg-surface-200-800 px-3 py-2 text-sm text-surface-600-400">
                                            <div className="flex items-center gap-2">
                                                <Loader2 size={14} className="shrink-0 animate-spin" />
                                                <span>
                                                    {`${toolStatus || "Thinking..."}${elapsedSeconds ? ` · ${elapsedSeconds}s` : ""}`}
                                                </span>
                                            </div>
                                            {activityLog.length > 0 && (
                                                <div className="mt-2 space-y-1 border-t border-surface-300-700/50 pt-2 text-xs">
                                                    {activityLog.map(item => (
                                                        <div key={item.id} className="flex items-start gap-2">
                                                            {item.status === "running"
                                                                ? <Loader2 size={12} className="mt-0.5 shrink-0 animate-spin" />
                                                                : item.status === "error"
                                                                    ? <AlertTriangle size={12} className="mt-0.5 shrink-0 text-error-500" />
                                                                    : <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-success-500" />}
                                                            <span className="min-w-0">
                                                                <span className="font-medium">{item.label}</span>
                                                                {item.detail && (
                                                                    <span className="text-surface-500-400"> — {item.detail}</span>
                                                                )}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {error && (
                                    <div className="rounded-xl border border-error-500/40 bg-error-500/10 p-3 text-sm text-error-500">
                                        <div className="mb-1 flex items-center gap-2 font-semibold">
                                            <AlertTriangle size={15} />
                                            Could not answer
                                        </div>
                                        <p className="whitespace-pre-wrap">{error}</p>
                                        <p className="mt-1 text-xs opacity-80">
                                            Your question is back in the input. Press send to try again.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => setShowSettings(true)}
                                            className="mt-2 text-xs font-semibold underline"
                                        >
                                            Open AI settings
                                        </button>
                                    </div>
                                )}
                            </div>

                            <form onSubmit={handleSubmit} className="border-t border-surface-200-800 bg-surface-100-900 p-3">
                                <div className="flex items-end gap-2">
                                    <textarea
                                        ref={inputRef}
                                        value={input}
                                        onChange={event => setInput(event.target.value)}
                                        onKeyDown={handleKeyDown}
                                        rows={1}
                                        placeholder={!configReady
                                            ? "Checking AI settings..."
                                            : !isConfigured
                                                ? "Add your API key in settings"
                                                : "Ask about the tournament..."}
                                        disabled={!configReady || !isConfigured || isSending}
                                        className="max-h-32 min-h-[42px] flex-1 resize-none rounded-xl border border-surface-200-800 bg-surface-50-950 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none disabled:opacity-60"
                                    />
                                    <button
                                        type="submit"
                                        disabled={!configReady || !isConfigured || isSending || !input.trim()}
                                        className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-primary-500 text-white transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
                                        aria-label="Send message"
                                    >
                                        {isSending
                                            ? <Loader2 size={18} className="animate-spin" />
                                            : <Send size={18} />}
                                    </button>
                                </div>
                                <p className="mt-2 text-[10px] text-surface-500-400">
                                    The assistant sends tournament data to the configured AI provider. Your key is stored in this browser. Preview pairings are not saved.
                                </p>
                            </form>
                        </>
                    )}
                </div>
            )}
        </>
    );
}
