"use client";

import { useState } from "react";
import { AlertTriangle, ArrowLeft, Eye, EyeOff } from "lucide-react";
import {
    AI_REASONING_OPTIONS,
    DEFAULT_AI_BASE_URL,
    DEFAULT_AI_MODEL,
    DEFAULT_AI_REASONING,
    isValidBaseUrl,
    normalizeBaseUrl,
    normalizeReasoning,
} from "@/lib/assistantConfig";

const PROVIDER_PRESETS = [
    {
        id: "openai",
        label: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        hint: "OpenAI API",
    },
    {
        id: "openrouter",
        label: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "deepseek/deepseek-v4.1-flash-1017",
        hint: "OpenRouter API. Choose a vision-capable model to import data from images.",
    },
    {
        id: "ollama",
        label: "Local Ollama",
        baseUrl: "http://localhost:11434/v1",
        model: "llama3.1",
        hint: "Only works when this app runs on the same machine as Ollama",
    },
];

const INPUT_CLASS =
    "w-full rounded-lg border border-surface-200-800 bg-surface-50-950 px-3 py-2 text-sm text-surface-950-50 focus:border-primary-500 focus:outline-none";

export default function AssistantSettings({
    initialConfig,
    serverEnabled = false,
    serverModel = "",
    onSave,
    onRemove,
    onCancel,
}) {
    const [baseUrl, setBaseUrl] = useState(initialConfig?.baseUrl || DEFAULT_AI_BASE_URL);
    const [apiKey, setApiKey] = useState(initialConfig?.apiKey || "");
    const [model, setModel] = useState(initialConfig?.model || DEFAULT_AI_MODEL);
    const [reasoning, setReasoning] = useState(
        normalizeReasoning(initialConfig?.reasoning || DEFAULT_AI_REASONING)
    );
    const [showKey, setShowKey] = useState(false);
    const [error, setError] = useState("");

    const handleSave = () => {
        setError("");

        const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
        const trimmedKey = apiKey.trim();
        const trimmedModel = model.trim();

        if (!trimmedKey) {
            setError("Enter an API key.");
            return;
        }

        if (!normalizedBaseUrl || !isValidBaseUrl(normalizedBaseUrl)) {
            setError("Enter a valid http(s) base URL, for example https://api.openai.com/v1.");
            return;
        }

        if (!trimmedModel) {
            setError("Enter a model.");
            return;
        }

        const saved = onSave({
            apiKey: trimmedKey,
            baseUrl: normalizedBaseUrl,
            model: trimmedModel,
            reasoning,
        });

        if (saved === false) {
            setError("Could not save settings. This browser may block local storage.");
        }
    };

    const handleRemove = () => {
        setError("");
        const removed = onRemove();
        if (removed === false) {
            setError("Could not remove settings. This browser may block local storage.");
        }
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-surface-200-800 bg-surface-100-900 px-4 py-3">
                <button
                    type="button"
                    onClick={onCancel}
                    className="rounded p-1.5 text-surface-500-400 transition hover:bg-surface-200-800 hover:text-surface-950-50"
                    aria-label="Back to chat"
                    title="Back to chat"
                >
                    <ArrowLeft size={16} />
                </button>
                <p className="text-sm font-semibold">AI settings</p>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
                {serverEnabled && (
                    <div className="rounded-xl border border-surface-200-800 bg-surface-100-900 p-3 text-xs text-surface-600-400">
                        This deployment also has a server AI key
                        {serverModel ? ` (${serverModel})` : ""}. You can add your own key to use your own
                        provider or model. If you add a key, you can remove it later to fall back to the
                        server key.
                    </div>
                )}

                <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-surface-500-400">
                        Provider presets
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {PROVIDER_PRESETS.map(preset => (
                            <button
                                key={preset.id}
                                type="button"
                                title={preset.hint}
                                onClick={() => {
                                    setBaseUrl(preset.baseUrl);
                                    setModel(preset.model);
                                    setError("");
                                }}
                                className="rounded-full border border-surface-200-800 bg-surface-100-900 px-3 py-1.5 text-xs transition hover:border-primary-500 hover:text-primary-500"
                            >
                                {preset.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <label
                        htmlFor="ai-base-url"
                        className="mb-1 block text-xs font-semibold text-surface-600-400"
                    >
                        API base URL
                    </label>
                    <input
                        id="ai-base-url"
                        type="url"
                        value={baseUrl}
                        onChange={event => setBaseUrl(event.target.value)}
                        className={INPUT_CLASS}
                        placeholder="https://api.openai.com/v1"
                        autoComplete="off"
                        spellCheck={false}
                        autoFocus
                    />
                    <p className="mt-1 text-[11px] text-surface-500-400">
                        OpenAI, OpenRouter, or any OpenAI-compatible endpoint. Do not include
                        /chat/completions.
                    </p>
                </div>

                <div>
                    <label
                        htmlFor="ai-api-key"
                        className="mb-1 block text-xs font-semibold text-surface-600-400"
                    >
                        API key
                    </label>
                    <div className="relative">
                        <input
                            id="ai-api-key"
                            type={showKey ? "text" : "password"}
                            value={apiKey}
                            onChange={event => setApiKey(event.target.value)}
                            className={`${INPUT_CLASS} pr-10`}
                            placeholder="sk-..."
                            autoComplete="off"
                            spellCheck={false}
                        />
                        <button
                            type="button"
                            onClick={() => setShowKey(value => !value)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-surface-500-400 transition hover:bg-surface-200-800 hover:text-surface-950-50"
                            aria-label={showKey ? "Hide API key" : "Show API key"}
                            title={showKey ? "Hide API key" : "Show API key"}
                        >
                            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    </div>
                    <p className="mt-1 text-[11px] text-surface-500-400">
                        Saved in this browser only. Sent to your provider through this app&apos;s server.
                    </p>
                </div>

                <div>
                    <label
                        htmlFor="ai-model"
                        className="mb-1 block text-xs font-semibold text-surface-600-400"
                    >
                        Model
                    </label>
                    <input
                        id="ai-model"
                        type="text"
                        value={model}
                        onChange={event => setModel(event.target.value)}
                        className={INPUT_CLASS}
                        placeholder="gpt-4o-mini"
                        autoComplete="off"
                        spellCheck={false}
                    />
                    <p className="mt-1 text-[11px] text-surface-500-400">
                        Use a tool-capable model so the assistant can read tournament data. To import
                        players from photos or screenshots, choose a vision-capable model such as
                        gpt-4o-mini.
                    </p>
                </div>

                <div>
                    <p className="mb-1 block text-xs font-semibold text-surface-600-400">
                        Reasoning
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {AI_REASONING_OPTIONS.map(option => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => setReasoning(option.value)}
                                title={option.description}
                                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                                    reasoning === option.value
                                        ? "border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400"
                                        : "border-surface-200-800 bg-surface-50-950 text-surface-600-400 hover:border-primary-500"
                                }`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                    <p className="mt-1 text-[11px] text-surface-500-400">
                        {AI_REASONING_OPTIONS.find(option => option.value === reasoning)?.description}
                    </p>
                </div>

                {error && (
                    <div className="rounded-lg border border-error-500/40 bg-error-500/10 p-3 text-xs text-error-500">
                        {error}
                    </div>
                )}

                <div className="rounded-xl border border-warning-500/40 bg-warning-500/10 p-3 text-xs text-warning-600-400">
                    <div className="mb-1 flex items-center gap-2 font-semibold">
                        <AlertTriangle size={14} />
                        Security note
                    </div>
                    <p>
                        Your key is saved in this browser&apos;s local storage. Anyone with access to this
                        browser profile can read it. Use a limited key and avoid shared computers. The
                        app&apos;s server forwards the key to your provider and does not store it.
                    </p>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-surface-200-800 bg-surface-100-900 p-3">
                <button
                    type="button"
                    onClick={handleSave}
                    className="rounded-lg bg-primary-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-primary-600"
                >
                    Save settings
                </button>
                {initialConfig?.apiKey && (
                    <button
                        type="button"
                        onClick={handleRemove}
                        className="rounded-lg border border-error-500/40 px-3 py-1.5 text-sm font-medium text-error-500 transition hover:bg-error-500/10"
                    >
                        Remove key
                    </button>
                )}
                <button
                    type="button"
                    onClick={onCancel}
                    className="ml-auto rounded-lg border border-surface-200-800 px-3 py-1.5 text-sm font-medium transition hover:bg-surface-200-800"
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
