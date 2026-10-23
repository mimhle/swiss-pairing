"use client";

/**
 * Read the assistant's server-sent event stream.
 *
 * Events:
 *   { type: "delta", content: "..." }
 *   { type: "tool_calls", toolCalls: [...], content: "...", usage: {...} }
 *   { type: "done", content: "...", usage: {...} }
 *   { type: "error", error: "..." }
 */
export async function readAssistantStream(response, { onDelta } = {}) {
    if (!response.body) {
        throw new Error("Streaming is not supported by this browser.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let toolCalls = [];
    let usage = null;

    const handleEvent = event => {
        if (!event || typeof event !== "object") return;

        if (event.type === "delta") {
            content += event.content || "";
            onDelta?.(event.content || "", content);
            return;
        }

        if (event.type === "tool_calls") {
            toolCalls = Array.isArray(event.toolCalls) ? event.toolCalls : [];
            if (typeof event.content === "string") content = event.content;
            usage = event.usage || usage;
            return;
        }

        if (event.type === "done") {
            if (typeof event.content === "string") content = event.content;
            usage = event.usage || usage;
            return;
        }

        if (event.type === "error") {
            throw new Error(event.error || "AI stream failed.");
        }
    };

    try {
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

                    let event;
                    try {
                        event = JSON.parse(payloadText);
                    } catch (_) {
                        continue;
                    }

                    handleEvent(event);
                }
            }
        }
    } catch (error) {
        try {
            await reader.cancel();
        } catch (_) {}
        throw error;
    }

    return { content, toolCalls, usage };
}
