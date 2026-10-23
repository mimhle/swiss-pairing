import { NextResponse } from "next/server";
import {
    ASSISTANT_SYSTEM_PROMPT,
    ASSISTANT_TOOL_DEFINITIONS,
    ASSISTANT_TOOL_NAMES,
} from "@/lib/assistantTools";
import {
    DEFAULT_AI_BASE_URL,
    DEFAULT_AI_MODEL,
    DEFAULT_AI_REASONING,
    isValidBaseUrl,
    normalizeBaseUrl,
    normalizeReasoning,
} from "@/lib/assistantConfig";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SERVER_API_KEY =
    process.env.AI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    "";
const SERVER_BASE_URL = normalizeBaseUrl(process.env.AI_BASE_URL || DEFAULT_AI_BASE_URL);
const SERVER_MODEL = process.env.AI_MODEL || DEFAULT_AI_MODEL;
const APP_NAME = process.env.AI_APP_NAME || "Swiss Pairing";
const APP_URL = process.env.AI_APP_URL || "";
const ALLOWED_BASE_URLS = (process.env.AI_ALLOWED_BASE_URLS || "")
    .split(",")
    .map(value => normalizeBaseUrl(value))
    .filter(Boolean);

const MAX_MESSAGES = 120;
const MAX_CONTENT_CHARS = 200000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 120;
const rateLimitStore = new Map();

function getClientIp(request) {
    const forwarded = request.headers.get("x-forwarded-for") || "";
    return forwarded.split(",")[0].trim()
        || request.headers.get("x-real-ip")
        || "unknown";
}

function checkRateLimit(request) {
    const now = Date.now();

    if (rateLimitStore.size > 5000) {
        for (const [key, value] of rateLimitStore) {
            if (now - value.startedAt > RATE_LIMIT_WINDOW_MS) rateLimitStore.delete(key);
        }
    }

    const ip = getClientIp(request);
    const entry = rateLimitStore.get(ip);

    if (!entry || now - entry.startedAt > RATE_LIMIT_WINDOW_MS) {
        rateLimitStore.set(ip, { startedAt: now, count: 1 });
        return { allowed: true };
    }

    entry.count += 1;
    if (entry.count > RATE_LIMIT_MAX) {
        return {
            allowed: false,
            retryAfter: Math.ceil((entry.startedAt + RATE_LIMIT_WINDOW_MS - now) / 1000),
        };
    }

    return { allowed: true };
}

function safeParseArguments(raw) {
    if (raw == null || raw === "") return {};
    if (typeof raw === "object") return raw;
    try {
        return JSON.parse(raw);
    } catch (_) {
        return {};
    }
}

function normalizeMessage(message) {
    const role = message?.role;

    if (role === "tool") {
        const toolCallId = String(message.toolCallId || message.tool_call_id || "");
        if (!toolCallId) return null;
        return {
            role: "tool",
            tool_call_id: toolCallId,
            content: typeof message.content === "string"
                ? message.content
                : JSON.stringify(message.content ?? {}),
        };
    }

    if (role === "assistant" && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
        const toolCalls = message.toolCalls
            .filter(toolCall => ASSISTANT_TOOL_NAMES.has(toolCall?.name))
            .map(toolCall => ({
                id: String(toolCall.id || `call_${Math.random().toString(36).slice(2)}`),
                type: "function",
                function: {
                    name: toolCall.name,
                    arguments: JSON.stringify(toolCall.arguments ?? {}),
                },
            }));

        if (toolCalls.length === 0) {
            return { role: "assistant", content: String(message.content ?? "") };
        }

        return {
            role: "assistant",
            content: message.content ? String(message.content) : null,
            tool_calls: toolCalls,
        };
    }

    if (role === "user" || role === "assistant") {
        return { role, content: String(message.content ?? "") };
    }

    // Client-supplied system messages are ignored so the server keeps control
    // of the assistant's instructions.
    return null;
}

function errorResponse(message, status, extraHeaders = {}) {
    return NextResponse.json(
        { error: message },
        { status, headers: { "Cache-Control": "no-store", ...extraHeaders } }
    );
}

function getClientKey(request, body) {
    return String(
        request.headers.get("x-ai-api-key") || body?.apiKey || ""
    ).trim();
}

function isAllowedBaseUrl(baseUrl) {
    if (ALLOWED_BASE_URLS.length === 0) return true;
    return ALLOWED_BASE_URLS.some(allowed => (
        baseUrl === allowed || baseUrl.startsWith(`${allowed}/`)
    ));
}

function buildReasoningPayload({ baseUrl, model, reasoning }) {
    if (!reasoning || reasoning === "auto") return {};

    if (baseUrl.includes("openrouter.ai")) {
        if (reasoning === "off") {
            return { reasoning: { enabled: false, exclude: true } };
        }
        return { reasoning: { effort: "low", exclude: true } };
    }

    if (baseUrl.includes("api.openai.com")) {
        if (!/^(o\d|gpt-5)/i.test(model)) return {};
        return { reasoning_effort: reasoning === "off" ? "minimal" : "low" };
    }

    return {};
}

function providerStatusMessage(status, keyHint) {
    const messages = {
        401: `The AI provider rejected the API key. ${keyHint}`,
        403: `The AI provider denied access. ${keyHint}`,
        404: `The AI provider could not find the model or endpoint. ${keyHint}`,
        429: "The AI provider is rate-limiting requests. Try again shortly.",
    };
    return messages[status] || `The AI provider returned ${status}. ${keyHint}`;
}

function streamAssistantResponse({ request, url, headers, body, keyHint, requestKey }) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const send = event => {
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                } catch (_) {
                    // Client disconnected.
                }
            };

            try {
                const response = await fetch(url, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(body),
                    signal: request.signal,
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    const safeErrorText = requestKey
                        ? errorText.replaceAll(requestKey, "[redacted]")
                        : errorText;
                    console.error(
                        "[AI Assistant] Provider error:",
                        response.status,
                        safeErrorText.slice(0, 1000)
                    );
                    send({
                        type: "error",
                        error: providerStatusMessage(response.status, keyHint),
                    });
                    return;
                }

                if (!response.body) {
                    send({ type: "error", error: "The AI provider did not return a stream." });
                    return;
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = "";
                let content = "";
                let usage = null;
                const toolCallMap = new Map();

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

                    let boundary;
                    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
                        const rawEvent = buffer.slice(0, boundary);
                        buffer = buffer.slice(boundary + 2);

                        for (const line of rawEvent.split("\n")) {
                            if (!line.startsWith("data:")) continue;
                            const payloadText = line.slice(5).trim();
                            if (!payloadText || payloadText === "[DONE]") continue;

                            let payload;
                            try {
                                payload = JSON.parse(payloadText);
                            } catch (_) {
                                continue;
                            }

                            if (payload.usage) usage = payload.usage;

                            const choice = payload.choices?.[0];
                            if (!choice) continue;
                            const delta = choice.delta || {};

                            if (typeof delta.content === "string" && delta.content) {
                                content += delta.content;
                                send({ type: "delta", content: delta.content });
                            }

                            if (Array.isArray(delta.tool_calls)) {
                                for (const toolCallDelta of delta.tool_calls) {
                                    const index = Number.isInteger(toolCallDelta.index)
                                        ? toolCallDelta.index
                                        : 0;
                                    const existing = toolCallMap.get(index) || {
                                        id: "",
                                        name: "",
                                        arguments: "",
                                    };
                                    if (toolCallDelta.id) existing.id = toolCallDelta.id;
                                    if (toolCallDelta.function?.name) {
                                        existing.name += toolCallDelta.function.name;
                                    }
                                    if (toolCallDelta.function?.arguments) {
                                        existing.arguments += toolCallDelta.function.arguments;
                                    }
                                    toolCallMap.set(index, existing);
                                }
                            }
                        }
                    }
                }

                const toolCalls = [...toolCallMap.entries()]
                    .sort((a, b) => a[0] - b[0])
                    .map(([, toolCall]) => ({
                        id: toolCall.id || `call_${Math.random().toString(36).slice(2)}`,
                        name: toolCall.name,
                        arguments: safeParseArguments(toolCall.arguments),
                    }))
                    .filter(toolCall => ASSISTANT_TOOL_NAMES.has(toolCall.name));

                if (toolCalls.length > 0) {
                    send({ type: "tool_calls", toolCalls, content, usage });
                } else {
                    send({
                        type: "done",
                        content: content || "I could not produce a response. Please try rephrasing your question.",
                        usage,
                    });
                }
            } catch (error) {
                if (error?.name !== "AbortError") {
                    console.error("[AI Assistant] Stream failed:", error);
                    send({
                        type: "error",
                        error: "Could not reach the AI provider. Check the base URL, your network, and AI settings.",
                    });
                }
            } finally {
                try {
                    controller.close();
                } catch (_) {
                    // Already closed.
                }
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
        },
    });
}

export async function GET() {
    return NextResponse.json(
        {
            enabled: Boolean(SERVER_API_KEY),
            model: SERVER_API_KEY ? SERVER_MODEL : null,
            serverKeyAvailable: Boolean(SERVER_API_KEY),
        },
        { headers: { "Cache-Control": "no-store" } }
    );
}

export async function POST(request) {
    const limit = checkRateLimit(request);
    if (!limit.allowed) {
        return errorResponse(
            "Too many AI requests. Please wait a few minutes and try again.",
            429,
            { "Retry-After": String(limit.retryAfter) }
        );
    }

    let body;
    try {
        body = await request.json();
    } catch (_) {
        return errorResponse("Invalid JSON body.", 400);
    }

    const messages = Array.isArray(body?.messages) ? body.messages : null;
    if (!messages || messages.length === 0) {
        return errorResponse("messages is required.", 400);
    }
    if (messages.length > MAX_MESSAGES) {
        return errorResponse("Conversation is too long. Clear the chat and try again.", 413);
    }

    const contentChars = messages.reduce(
        (sum, message) => sum + String(message?.content ?? "").length,
        0
    );
    if (contentChars > MAX_CONTENT_CHARS) {
        return errorResponse("Conversation is too large. Clear the chat and try again.", 413);
    }

    const normalized = messages.map(normalizeMessage).filter(Boolean);
    if (normalized.length === 0) {
        return errorResponse("No valid messages were provided.", 400);
    }

    // The browser may supply its own key (BYOK). If it does, the server uses
    // that key and the browser's base URL/model. If it does not, the server
    // falls back to its own environment configuration. A server key is never
    // sent to a browser-supplied base URL.
    const clientKey = getClientKey(request, body);
    const useClientKey = Boolean(clientKey);
    const requestKey = useClientKey ? clientKey : SERVER_API_KEY;

    if (!requestKey) {
        return errorResponse(
            "AI assistant is not configured. Add your API key in the assistant settings, or set AI_API_KEY on the server.",
            503
        );
    }

    let baseUrl;
    let model;

    if (useClientKey) {
        baseUrl = normalizeBaseUrl(body?.aiBaseUrl || DEFAULT_AI_BASE_URL);
        model = String(body?.aiModel || DEFAULT_AI_MODEL).trim();

        if (!isValidBaseUrl(baseUrl)) {
            return errorResponse(
                "The AI base URL is invalid. Use an http(s) URL such as https://api.openai.com/v1.",
                400
            );
        }

        if (!isAllowedBaseUrl(baseUrl)) {
            return errorResponse(
                "This AI base URL is not allowed on this deployment. Contact the administrator.",
                403
            );
        }

        if (!model) {
            return errorResponse("The AI model is required in the assistant settings.", 400);
        }
    } else {
        baseUrl = SERVER_BASE_URL;
        model = SERVER_MODEL;

        if (!isValidBaseUrl(baseUrl)) {
            return errorResponse("The server's AI base URL is invalid. Check AI_BASE_URL.", 500);
        }
    }

    const contextText = body?.context
        ? `Current app context (JSON):\n${JSON.stringify(body.context)}`
        : "";
    const systemContent = [ASSISTANT_SYSTEM_PROMPT, contextText].filter(Boolean).join("\n\n");

    const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${requestKey}`,
    };
    if (APP_NAME) headers["X-Title"] = APP_NAME;
    if (APP_URL) headers["HTTP-Referer"] = APP_URL;
    if (baseUrl.includes("openrouter.ai")) {
        // Keep the app out of OpenRouter's public rankings. OpenRouter only
        // applies this when it first creates the app entry.
        headers["X-OpenRouter-App-Visibility"] = "hidden";
    }

    const keyHint = useClientKey
        ? "Open the assistant settings and check your key, base URL, and model."
        : "Check the server's AI_API_KEY, AI_BASE_URL, and AI_MODEL settings.";

    const reasoningSetting = useClientKey
        ? normalizeReasoning(body?.aiReasoning)
        : normalizeReasoning(process.env.AI_REASONING || DEFAULT_AI_REASONING);
    const stream = body?.stream !== false;
    headers.Accept = stream ? "text/event-stream" : "application/json";

    const providerBody = {
        model,
        messages: [{ role: "system", content: systemContent }, ...normalized],
        tools: ASSISTANT_TOOL_DEFINITIONS,
        tool_choice: "auto",
        temperature: 0.2,
        max_tokens: 3000,
        stream,
        ...buildReasoningPayload({ baseUrl, model, reasoning: reasoningSetting }),
    };

    if (stream) {
        return streamAssistantResponse({
            request,
            url: `${baseUrl}/chat/completions`,
            headers,
            body: providerBody,
            keyHint,
            requestKey,
        });
    }

    try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify(providerBody),
        });

        if (!response.ok) {
            const errorText = await response.text();
            const safeErrorText = requestKey
                ? errorText.replaceAll(requestKey, "[redacted]")
                : errorText;
            console.error(
                "[AI Assistant] Provider error:",
                response.status,
                safeErrorText.slice(0, 1000)
            );
            return errorResponse(providerStatusMessage(response.status, keyHint), 502);
        }

        const data = await response.json();
        const choice = data?.choices?.[0]?.message;
        if (!choice) {
            return errorResponse("The AI provider returned an empty response.", 502);
        }

        const toolCalls = (choice.tool_calls || [])
            .filter(toolCall => ASSISTANT_TOOL_NAMES.has(toolCall?.function?.name))
            .map(toolCall => ({
                id: String(toolCall.id),
                name: toolCall.function.name,
                arguments: safeParseArguments(toolCall.function.arguments),
            }));

        if (toolCalls.length > 0) {
            return NextResponse.json(
                {
                    type: "tool_calls",
                    message: choice.content || "",
                    toolCalls,
                    usage: data.usage,
                },
                { headers: { "Cache-Control": "no-store" } }
            );
        }

        return NextResponse.json(
            {
                type: "message",
                message: choice.content || "I could not produce a response. Please try rephrasing your question.",
                usage: data.usage,
            },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (error) {
        console.error("[AI Assistant] Request failed:", error);
        return errorResponse(
            "Could not reach the AI provider. Check the base URL, your network, and AI settings.",
            502
        );
    }
}
