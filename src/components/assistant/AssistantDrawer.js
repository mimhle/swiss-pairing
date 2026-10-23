"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
    AlertTriangle,
    ArrowDown,
    CheckCircle2,
    ImagePlus,
    Loader2,
    MoveDiagonal,
    Send,
    Settings,
    Sparkles,
    Trash2,
    X,
} from "lucide-react";
import { useTournament } from "@/context/TournamentContext";
import {
    createAssistantToolContext,
    executeAssistantTool,
} from "@/lib/assistantExecutor";
import {
    MAX_ATTACHMENTS,
    isSupportedImageFile,
    prepareAssistantImage,
} from "@/lib/assistantImages";
import {
    clearAssistantConfig,
    loadAssistantConfig,
    saveAssistantConfig,
} from "@/lib/assistantStorage";
import { readAssistantStream } from "@/lib/assistantStream";
import AssistantSettings from "./AssistantSettings";

const MAX_TOOL_TURNS = 12;
const PANEL_SIZE_STORAGE_KEY = "swiss_ai_panel_size_v1";
// Minimum width that keeps the composer placeholder on one line at the
// default font size, plus a small safety buffer.
const PANEL_MIN_WIDTH = 490;
const PANEL_MIN_HEIGHT = 320;

function clampPanelSize(size) {
    if (typeof window === "undefined") return size;

    const maxWidth = Math.max(240, window.innerWidth - 32);
    const maxHeight = Math.max(240, window.innerHeight - 96);
    const minWidth = Math.min(PANEL_MIN_WIDTH, maxWidth);
    const minHeight = Math.min(PANEL_MIN_HEIGHT, maxHeight);

    return {
        width: Math.round(Math.min(Math.max(size.width, minWidth), maxWidth)),
        height: Math.round(Math.min(Math.max(size.height, minHeight), maxHeight)),
    };
}

function loadPanelSize() {
    if (typeof window === "undefined") return null;

    try {
        const raw = window.localStorage.getItem(PANEL_SIZE_STORAGE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        const width = Number(parsed?.width);
        const height = Number(parsed?.height);
        if (!Number.isFinite(width) || !Number.isFinite(height)) return null;

        return clampPanelSize({ width, height });
    } catch (_) {
        return null;
    }
}

function savePanelSize(size) {
    if (typeof window === "undefined") return;

    try {
        window.localStorage.setItem(PANEL_SIZE_STORAGE_KEY, JSON.stringify(size));
    } catch (_) {
        // Ignore storage failures; resizing still works for this session.
    }
}

function clearSavedPanelSize() {
    if (typeof window === "undefined") return;

    try {
        window.localStorage.removeItem(PANEL_SIZE_STORAGE_KEY);
    } catch (_) {
        // Ignore storage failures.
    }
}

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

function buildRequestMessages(messages) {
    // Only the newest image-bearing user message is sent. Older images stay in
    // the chat for reference but are dropped from the request to keep payloads
    // small and avoid paying for the same image on every follow-up.
    let lastImageIndex = -1;

    messages.forEach((message, index) => {
        if (message.role === "user" && Array.isArray(message.images) && message.images.length > 0) {
            lastImageIndex = index;
        }
    });

    return messages.map((message, index) => {
        if (!Array.isArray(message.images) || message.images.length === 0) return message;

        if (index !== lastImageIndex) {
            return { ...message, images: [] };
        }

        return {
            ...message,
            images: message.images.map(image => ({ dataUrl: image.dataUrl })),
        };
    });
}

function MessageBubble({ message, onPreviewImage }) {
    const isUser = message.role === "user";
    const content = isUser ? message.content : formatAssistantContent(message.content);
    const images = isUser && Array.isArray(message.images) ? message.images : [];

    return (
        <div className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
            {!isUser && (
                <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-500 text-white">
                    <Sparkles size={14} />
                </div>
            )}
            <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    isUser
                        ? "bg-primary-500 text-white"
                        : "bg-surface-200-800 text-surface-950-50"
                }`}
            >
                {images.length > 0 && (
                    <div className={`grid gap-1 ${images.length > 1 ? "grid-cols-2" : "grid-cols-1"} ${content ? "mb-2" : ""}`}>
                        {images.map((image, imageIndex) => (
                            <button
                                key={image.id || `${imageIndex}-${image.name || "image"}`}
                                type="button"
                                onClick={() => onPreviewImage?.(image)}
                                className="overflow-hidden rounded-lg border border-white/30 focus:outline-none focus:ring-2 focus:ring-white/70"
                                title={image.name || "Attached image"}
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={image.dataUrl}
                                    alt={image.name || "Attached image"}
                                    className="h-28 w-full object-cover"
                                />
                            </button>
                        ))}
                    </div>
                )}
                {content && <div className="whitespace-pre-wrap">{content}</div>}
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
    const [attachments, setAttachments] = useState([]);
    const [attachmentError, setAttachmentError] = useState("");
    const [isPreparingImages, setIsPreparingImages] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [previewImage, setPreviewImage] = useState(null);
    const [isSending, setIsSending] = useState(false);
    const [toolStatus, setToolStatus] = useState("");
    const [activityLog, setActivityLog] = useState([]);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [error, setError] = useState("");
    const [errorDraftKept, setErrorDraftKept] = useState(false);
    const [aiConfig, setAiConfig] = useState(() => loadAssistantConfig());
    const [serverEnabled, setServerEnabled] = useState(null);
    const [serverModel, setServerModel] = useState("");
    const [configReady, setConfigReady] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showScrollToBottom, setShowScrollToBottom] = useState(false);
    const [panelSize, setPanelSize] = useState(null);

    const scrollRef = useRef(null);
    const panelRef = useRef(null);
    const panelSizeRef = useRef(null);
    const resizeRef = useRef(null);
    const atBottomRef = useRef(true);
    const inputRef = useRef(null);
    const fileInputRef = useRef(null);
    const inputValueRef = useRef("");
    const messagesRef = useRef(messages);
    const attachmentsRef = useRef([]);
    const attachmentGenerationRef = useRef(0);
    const preparingRef = useRef(false);
    const dragDepthRef = useRef(0);
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

    const updatePanelSize = useCallback(next => {
        panelSizeRef.current = next;
        setPanelSize(next);
    }, []);

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
            if (previewImage) {
                setPreviewImage(null);
                return;
            }
            if (showSettings) {
                setShowSettings(false);
                return;
            }
            setOpen(false);
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [open, showSettings, previewImage]);

    useEffect(() => {
        const saved = loadPanelSize();
        if (saved) updatePanelSize(saved);
    }, [updatePanelSize]);

    useEffect(() => {
        const handleResize = () => {
            const current = panelSizeRef.current;
            if (!current) return;

            const next = clampPanelSize(current);
            if (next.width !== current.width || next.height !== current.height) {
                updatePanelSize(next);
            }
        };

        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [updatePanelSize]);

    useEffect(() => () => {
        document.body.style.userSelect = "";
    }, []);

    useEffect(() => {
        if (!open) return;

        atBottomRef.current = true;
        setShowScrollToBottom(false);

        const frame = requestAnimationFrame(() => {
            if (!scrollRef.current) return;
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        });

        return () => cancelAnimationFrame(frame);
    }, [open]);

    useEffect(() => {
        if (showSettings) return;
        atBottomRef.current = true;
        setShowScrollToBottom(false);
    }, [showSettings]);

    useEffect(() => {
        if (!scrollRef.current || !atBottomRef.current) return;
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
        inputValueRef.current = input;
    }, [input]);

    useEffect(() => {
        if (lastTournamentRef.current === activeTournamentId) return;
        lastTournamentRef.current = activeTournamentId;
        sendGenerationRef.current += 1;
        abortRef.current?.abort();
        abortRef.current = null;
        sendingRef.current = false;
        messagesRef.current = [];
        attachmentGenerationRef.current += 1;
        attachmentsRef.current = [];
        setMessages([]);
        setAttachments([]);
        setAttachmentError("");
        setPreviewImage(null);
        setError("");
        setErrorDraftKept(false);
        setToolStatus("");
        setActivityLog([]);
        setElapsedSeconds(0);
        atBottomRef.current = true;
        setShowScrollToBottom(false);
        setIsSending(false);
    }, [activeTournamentId]);

    const updateAttachments = useCallback(next => {
        const value = typeof next === "function" ? next(attachmentsRef.current) : next;
        attachmentsRef.current = value;
        setAttachments(value);
    }, []);

    const clearChat = useCallback(() => {
        messagesRef.current = [];
        attachmentGenerationRef.current += 1;
        attachmentsRef.current = [];
        setMessages([]);
        setAttachments([]);
        setAttachmentError("");
        setPreviewImage(null);
        setError("");
        setErrorDraftKept(false);
        setToolStatus("");
        setActivityLog([]);
        setElapsedSeconds(0);
        atBottomRef.current = true;
        setShowScrollToBottom(false);
        inputValueRef.current = "";
        setInput("");
    }, []);

    const removeAttachment = useCallback(id => {
        updateAttachments(attachmentsRef.current.filter(item => item.id !== id));
        setAttachmentError("");
    }, [updateAttachments]);

    const addImageFiles = useCallback(async fileList => {
        if (preparingRef.current) return;

        const files = Array.from(fileList || []);
        if (files.length === 0) return;

        const imageFiles = files.filter(isSupportedImageFile);
        if (imageFiles.length === 0) {
            setAttachmentError("Only image files can be attached.");
            return;
        }

        const slots = MAX_ATTACHMENTS - attachmentsRef.current.length;
        if (slots <= 0) {
            setAttachmentError(`You can attach up to ${MAX_ATTACHMENTS} images per message.`);
            return;
        }

        if (imageFiles.length > slots) {
            setAttachmentError(`Only ${slots} more image${slots === 1 ? "" : "s"} can be attached to this message.`);
        } else {
            setAttachmentError("");
        }

        const generation = attachmentGenerationRef.current;
        preparingRef.current = true;
        setIsPreparingImages(true);

        try {
            for (const file of imageFiles.slice(0, slots)) {
                try {
                    const attachment = await prepareAssistantImage(file);
                    if (generation !== attachmentGenerationRef.current) break;
                    if (attachmentsRef.current.length >= MAX_ATTACHMENTS) break;
                    updateAttachments([...attachmentsRef.current, attachment]);
                } catch (error) {
                    if (generation !== attachmentGenerationRef.current) break;
                    setAttachmentError(error?.message || "Could not read this image.");
                }
            }
        } finally {
            preparingRef.current = false;
            setIsPreparingImages(false);
        }
    }, [updateAttachments]);

    const isFileDrag = event => Array.from(event.dataTransfer?.types || []).includes("Files");

    const handleDragEnter = event => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        if (!isConfigured) return;
        dragDepthRef.current += 1;
        setIsDragging(true);
    };

    const handleDragOver = event => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
    };

    const handleDragLeave = event => {
        event.preventDefault();
        if (dragDepthRef.current === 0) return;
        dragDepthRef.current -= 1;
        if (dragDepthRef.current === 0) setIsDragging(false);
    };

    const handleDrop = event => {
        const hasFiles = (event.dataTransfer?.files?.length || 0) > 0;
        if (!hasFiles && !isFileDrag(event)) return;
        event.preventDefault();
        dragDepthRef.current = 0;
        setIsDragging(false);

        if (!isConfigured) return;
        void addImageFiles(event.dataTransfer.files);
        inputRef.current?.focus();
    };

    const handlePaste = event => {
        const files = Array.from(event.clipboardData?.items || [])
            .filter(item => item.kind === "file")
            .map(item => item.getAsFile())
            .filter(file => file && isSupportedImageFile(file));

        if (files.length === 0) return;

        // Keep any text on the clipboard, for example when pasting from a
        // spreadsheet that also contains an image.
        const hasText = Boolean(event.clipboardData?.getData("text/plain"));
        if (!hasText) event.preventDefault();

        void addImageFiles(files);
    };

    const handleChatScroll = event => {
        const element = event.currentTarget;
        const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 48;
        atBottomRef.current = atBottom;
        setShowScrollToBottom(current => (current === !atBottom ? current : !atBottom));
    };

    const scrollToLatest = useCallback(() => {
        const element = scrollRef.current;
        if (!element) return;
        atBottomRef.current = true;
        setShowScrollToBottom(false);
        element.scrollTop = element.scrollHeight;
    }, []);

    const handleResizeStart = event => {
        if (event.pointerType === "mouse" && event.button !== 0) return;

        const panel = panelRef.current;
        if (!panel) return;

        event.preventDefault();
        event.stopPropagation();

        const rect = panel.getBoundingClientRect();
        resizeRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startWidth: rect.width,
            startHeight: rect.height,
        };

        event.currentTarget.setPointerCapture?.(event.pointerId);
        document.body.style.userSelect = "none";
    };

    const handleResizeMove = event => {
        const state = resizeRef.current;
        if (!state || state.pointerId !== event.pointerId) return;

        event.preventDefault();

        const next = clampPanelSize({
            width: state.startWidth + (state.startX - event.clientX),
            height: state.startHeight + (state.startY - event.clientY),
        });

        updatePanelSize(next);
    };

    const handleResizeEnd = event => {
        const state = resizeRef.current;
        if (!state || state.pointerId !== event.pointerId) return;

        resizeRef.current = null;
        document.body.style.userSelect = "";

        if (event.currentTarget.hasPointerCapture?.(state.pointerId)) {
            event.currentTarget.releasePointerCapture(state.pointerId);
        }

        if (panelSizeRef.current) savePanelSize(panelSizeRef.current);
    };

    const resetPanelSize = () => {
        resizeRef.current = null;
        document.body.style.userSelect = "";
        updatePanelSize(null);
        clearSavedPanelSize();
    };

    const closeDrawer = useCallback(() => {
        dragDepthRef.current = 0;
        setIsDragging(false);
        setOpen(false);
        setShowSettings(false);
        setPreviewImage(null);
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
        setErrorDraftKept(false);
        return true;
    }, []);

    const handleRemoveConfig = useCallback(() => {
        const removed = clearAssistantConfig();
        if (!removed) return false;
        setAiConfig(null);
        setShowSettings(false);
        setError("");
        setErrorDraftKept(false);
        return true;
    }, []);

    const sendMessage = useCallback(async (text, attachmentList = []) => {
        const trimmed = String(text || "").trim();
        const pendingAttachments = Array.isArray(attachmentList) ? attachmentList : [];
        if ((!trimmed && pendingAttachments.length === 0) || sendingRef.current || preparingRef.current) return;

        if (!isConfigured) {
            setError("Add your API key in the assistant settings first.");
            setShowSettings(true);
            return;
        }

        const generation = sendGenerationRef.current;
        const baseMessages = messagesRef.current;
        const userMessage = {
            role: "user",
            content: trimmed,
            ...(pendingAttachments.length > 0
                ? {
                    images: pendingAttachments.map(attachment => ({
                        id: attachment.id,
                        name: attachment.name,
                        dataUrl: attachment.dataUrl,
                        width: attachment.width,
                        height: attachment.height,
                    })),
                }
                : {}),
        };
        let conversation = [...baseMessages, userMessage];
        const commit = nextMessages => {
            messagesRef.current = nextMessages;
            setMessages(nextMessages);
        };

        sendingRef.current = true;
        setIsSending(true);
        setError("");
        setErrorDraftKept(false);
        setAttachmentError("");
        inputValueRef.current = "";
        setInput("");
        updateAttachments([]);
        setToolStatus("Thinking...");
        setActivityLog([]);
        setElapsedSeconds(0);
        atBottomRef.current = true;
        setShowScrollToBottom(false);
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
                        messages: buildRequestMessages(conversation),
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

            // If the user started typing or attaching the next message while
            // this request was running, keep their draft and leave the failed
            // message in the chat instead of overwriting the composer.
            const hasDraft = Boolean(inputValueRef.current.trim())
                || attachmentsRef.current.length > 0;

            if (hasDraft) {
                commit([...baseMessages, userMessage]);
            } else {
                commit(baseMessages);
                inputValueRef.current = trimmed;
                setInput(trimmed);
                updateAttachments(pendingAttachments);
            }

            setErrorDraftKept(hasDraft);
            setError(err?.message || "Something went wrong.");
        } finally {
            if (generation === sendGenerationRef.current) {
                sendingRef.current = false;
                setIsSending(false);
                setToolStatus("");
                if (abortRef.current === controller) abortRef.current = null;
            }
        }
    }, [activeTournamentId, tournaments, tournamentConfig, rounds, aiConfig, isConfigured, notifyExternalDataChange, updateAttachments]);

    const handleSubmit = event => {
        event.preventDefault();
        sendMessage(input, attachments);
    };

    const handleKeyDown = event => {
        if (event.key !== "Enter" || event.shiftKey) return;

        // While a response is streaming (or images are still being prepared),
        // Enter inserts a newline and the send button stays disabled.
        if (sendingRef.current || preparingRef.current) return;

        event.preventDefault();
        sendMessage(input, attachments);
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
                    ref={panelRef}
                    role="dialog"
                    aria-label="Tournament assistant"
                    className="fixed bottom-20 right-4 z-[70] flex h-[min(720px,calc(100vh-6rem))] w-[min(520px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-surface-200-800 bg-surface-50-950 shadow-2xl"
                    style={panelSize ? {
                        width: panelSize.width,
                        height: panelSize.height,
                        maxWidth: "calc(100vw - 2rem)",
                        maxHeight: "calc(100vh - 6rem)",
                    } : undefined}
                >
                    <button
                        type="button"
                        onPointerDown={handleResizeStart}
                        onPointerMove={handleResizeMove}
                        onPointerUp={handleResizeEnd}
                        onPointerCancel={handleResizeEnd}
                        onDoubleClick={resetPanelSize}
                        className="absolute left-1.5 top-1.5 z-20 flex h-6 w-6 touch-none cursor-nwse-resize items-center justify-center rounded-md text-surface-400 transition hover:bg-surface-200-800 hover:text-surface-700-300"
                        aria-label="Resize assistant panel"
                        title="Drag to resize. Double-click to reset."
                    >
                        <MoveDiagonal size={13} />
                    </button>

                    <div className="flex items-center justify-between border-b border-surface-200-800 bg-surface-100-900 py-3 pl-9 pr-4">
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
                        <div
                            className="relative flex min-h-0 flex-1 flex-col"
                            onDragEnter={handleDragEnter}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                        >
                            {isDragging && (
                                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-surface-50-950/85 backdrop-blur-[1px]">
                                    <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-primary-500 px-6 py-5 text-primary-500">
                                        <ImagePlus size={24} />
                                        <p className="text-sm font-semibold">Drop images to attach</p>
                                        <p className="text-xs text-surface-500-400">
                                            JPEG, PNG, WebP, or HEIC · up to {MAX_ATTACHMENTS}
                                        </p>
                                    </div>
                                </div>
                            )}

                            <div className="relative min-h-0 flex-1">
                                <div
                                    ref={scrollRef}
                                    onScroll={handleChatScroll}
                                    className="h-full space-y-3 overflow-y-auto px-4 py-4"
                                >
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
                                                Ask about the active tournament. I can read players, rounds, results, and standings. I can also import a player list from a photo or screenshot. I can add players, update player fields, remove unpaired players, and enter results. I cannot generate pairings or change settings.
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
                                            <p className="text-xs text-surface-500-400">
                                                Tip: use the image button, paste a screenshot, or drag an image into this panel to import data. Image import needs a vision-capable model.
                                            </p>
                                        </div>
                                    )}

                                    {visibleMessages.map((message, index) => (
                                        <MessageBubble
                                            key={`${message.role}-${index}`}
                                            message={message}
                                            onPreviewImage={setPreviewImage}
                                        />
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
                                                {errorDraftKept
                                                    ? "Your draft is still in the composer. The failed message remains in the chat."
                                                    : "Your message is back in the input. Press send to try again."}
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

                                {showScrollToBottom && (
                                    <button
                                        type="button"
                                        onClick={scrollToLatest}
                                        className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-surface-200-800 bg-surface-100-900 px-3 py-1.5 text-xs font-medium text-surface-700-300 shadow-lg transition hover:border-primary-500 hover:text-primary-500"
                                        aria-label="Scroll to latest messages"
                                        title="Scroll to latest messages"
                                    >
                                        <ArrowDown size={13} />
                                        Latest
                                    </button>
                                )}
                            </div>

                            <form onSubmit={handleSubmit} className="border-t border-surface-200-800 bg-surface-100-900 p-3">
                                {attachments.length > 0 && (
                                    <div className="mb-2 flex flex-wrap gap-2">
                                        {attachments.map(attachment => (
                                            <div key={attachment.id} className="relative">
                                                <button
                                                    type="button"
                                                    onClick={() => setPreviewImage(attachment)}
                                                    className="block h-14 w-14 overflow-hidden rounded-lg border border-surface-200-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
                                                    title={attachment.name}
                                                >
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img
                                                        src={attachment.dataUrl}
                                                        alt={attachment.name || "Attached image"}
                                                        className="h-full w-full object-cover"
                                                    />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => removeAttachment(attachment.id)}
                                                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-surface-950 text-white shadow ring-1 ring-white/40 transition hover:bg-error-500"
                                                    aria-label={`Remove ${attachment.name || "image"}`}
                                                    title="Remove image"
                                                >
                                                    <X size={11} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {attachmentError && (
                                    <div className="mb-2 flex items-start gap-2 rounded-lg border border-warning-500/40 bg-warning-500/10 px-2.5 py-2 text-xs text-warning-600-400">
                                        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                                        <span className="min-w-0">{attachmentError}</span>
                                    </div>
                                )}

                                <div className="flex items-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={!configReady || !isConfigured || isPreparingImages || attachments.length >= MAX_ATTACHMENTS}
                                        className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-surface-200-800 text-surface-500-400 transition hover:border-primary-500 hover:text-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
                                        aria-label="Attach images"
                                        title={
                                            attachments.length >= MAX_ATTACHMENTS
                                                ? `Maximum ${MAX_ATTACHMENTS} images per message`
                                                : "Attach images"
                                        }
                                    >
                                        {isPreparingImages
                                            ? <Loader2 size={18} className="animate-spin" />
                                            : <ImagePlus size={18} />}
                                    </button>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*,.heic,.heif"
                                        multiple
                                        className="hidden"
                                        onChange={event => {
                                            void addImageFiles(event.target.files);
                                            event.target.value = "";
                                        }}
                                    />
                                    <textarea
                                        ref={inputRef}
                                        value={input}
                                        onChange={event => {
                                            inputValueRef.current = event.target.value;
                                            setInput(event.target.value);
                                        }}
                                        onKeyDown={handleKeyDown}
                                        onPaste={handlePaste}
                                        rows={1}
                                        placeholder={!configReady
                                            ? "Checking AI settings..."
                                            : !isConfigured
                                                ? "Add your API key in settings"
                                                : isSending
                                                    ? "Type your next message..."
                                                    : "Ask about the tournament or attach an image..."}
                                        disabled={!configReady || !isConfigured}
                                        className="max-h-32 min-h-[42px] flex-1 resize-none rounded-xl border border-surface-200-800 bg-surface-50-950 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none disabled:opacity-60"
                                    />
                                    <button
                                        type="submit"
                                        disabled={!configReady || !isConfigured || isSending || isPreparingImages || (!input.trim() && attachments.length === 0)}
                                        className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-primary-500 text-white transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
                                        aria-label="Send message"
                                    >
                                        {isSending
                                            ? <Loader2 size={18} className="animate-spin" />
                                            : <Send size={18} />}
                                    </button>
                                </div>
                                <p className="mt-2 text-[10px] text-surface-500-400">
                                    The assistant sends tournament data and attached images to the configured AI provider. Your key is stored in this browser. Preview pairings are not saved.
                                </p>
                            </form>
                        </div>
                    )}
                </div>
            )}

            {previewImage && (
                <div
                    role="dialog"
                    aria-label="Image preview"
                    className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4"
                    onClick={() => setPreviewImage(null)}
                >
                    <button
                        type="button"
                        onClick={() => setPreviewImage(null)}
                        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                        aria-label="Close image preview"
                    >
                        <X size={18} />
                    </button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={previewImage.dataUrl}
                        alt={previewImage.name || "Attached image"}
                        className="max-h-full max-w-full rounded-lg object-contain"
                        onClick={event => event.stopPropagation()}
                    />
                </div>
            )}
        </>
    );
}
