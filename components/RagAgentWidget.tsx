"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type ChatRole = "user" | "assistant";

type Citation = {
  id: number;
  url?: string;
  label?: string;
  page?: number;
};

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  status?: "streaming" | "done" | "error";
  citations?: Citation[];
};

type AgentResponse =
  | string
  | {
      answer?: unknown;
      reply?: unknown;
      output?: unknown;
      message?: unknown;
      citations?: unknown;
      messages?: Array<{ role?: unknown; content?: unknown; citations?: unknown }>;
    };

type StreamEvent = {
  event?: unknown;
  type?: unknown;
  text?: unknown;
  delta?: unknown;
  token?: unknown;
  chunk?: unknown;
  answer?: unknown;
  output?: unknown;
  message?: unknown;
  citations?: unknown;
};

function normalizeMessageContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
      .join("\n")
      .trim();
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  }
  return "";
}

function parseCitations(value: unknown): Citation[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parsed: Citation[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as Record<string, unknown>;
    const numericId = typeof candidate.id === "number" ? candidate.id : index + 1;
    const pageCandidate = candidate.page ?? candidate.page_number ?? candidate.pageNumber;
    const pageNumber =
      typeof pageCandidate === "number" && Number.isFinite(pageCandidate)
        ? Math.max(1, Math.floor(pageCandidate))
        : undefined;
    const url = normalizeMessageContent(candidate.url || candidate.source_url || candidate.href).trim();
    const label = normalizeMessageContent(
      candidate.label || candidate.title || candidate.file_name || candidate.source,
    ).trim();

    parsed.push({
      id: Number.isFinite(numericId) ? numericId : index + 1,
      url: url || undefined,
      label: label || undefined,
      page: pageNumber,
    });
  }

  return parsed.length > 0 ? parsed : undefined;
}

function citationLabel(citation: Citation, index: number) {
  if (typeof citation.page === "number") {
    return `p.${citation.page}`;
  }
  if (citation.label) {
    return citation.label.length > 18 ? `${citation.label.slice(0, 17)}...` : citation.label;
  }
  return `source ${index + 1}`;
}

function extractAssistantText(payload: AgentResponse): string {
  if (typeof payload === "string") {
    return payload.trim();
  }

  const direct =
    normalizeMessageContent(payload.answer) ||
    normalizeMessageContent(payload.reply) ||
    normalizeMessageContent(payload.output) ||
    normalizeMessageContent(payload.message);
  if (direct) {
    return direct;
  }

  const assistantFromMessages = payload.messages
    ?.slice()
    .reverse()
    .find((entry) => entry.role === "assistant");
  if (!assistantFromMessages) {
    return "The agent returned an empty response.";
  }

  const messageText = normalizeMessageContent(assistantFromMessages.content);
  return messageText || "The agent returned an empty assistant message.";
}

function extractAssistantCitations(payload: AgentResponse): Citation[] | undefined {
  if (typeof payload === "string") {
    return undefined;
  }

  const directCitations = parseCitations(payload.citations);
  if (directCitations) {
    return directCitations;
  }

  const assistantFromMessages = payload.messages
    ?.slice()
    .reverse()
    .find((entry) => entry.role === "assistant");
  if (!assistantFromMessages) {
    return undefined;
  }

  return parseCitations(assistantFromMessages.citations);
}

function createMessage(role: ChatRole, content: string): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
  };
}

function toReadableError(payload: AgentResponse, fallback: string) {
  if (typeof payload === "string") {
    return payload.trim() || fallback;
  }
  return normalizeMessageContent(payload) || fallback;
}

async function streamAgentReply(
  requestBody: unknown,
  onDelta: (deltaText: string, citations?: Citation[]) => void,
) {
  const response = await fetch("/api/agent/chat/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(raw || `Streaming request failed with status ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Streaming response body is not available.");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let assembled = "";

  const emitFromEvent = (event: StreamEvent) => {
    const citations = parseCitations(event.citations);
    const eventType = String(event.event ?? event.type ?? "").toLowerCase();
    const delta =
      normalizeMessageContent(event.delta) ||
      normalizeMessageContent(event.text) ||
      normalizeMessageContent(event.token) ||
      normalizeMessageContent(event.chunk);

    if (delta) {
      assembled += delta;
      onDelta(delta, citations);
      return;
    }

    if (eventType === "done" || eventType === "final") {
      const final =
        normalizeMessageContent(event.answer) ||
        normalizeMessageContent(event.output) ||
        normalizeMessageContent(event.message);
      if (final) {
        const extra = final.startsWith(assembled) ? final.slice(assembled.length) : final;
        assembled = final;
        if (extra) {
          onDelta(extra, citations);
        } else if (citations) {
          onDelta("", citations);
        }
      } else if (citations) {
        onDelta("", citations);
      }
    } else if (citations) {
      onDelta("", citations);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const payloadLine = line.startsWith("data:") ? line.slice(5).trim() : line;
      if (!payloadLine || payloadLine === "[DONE]") {
        continue;
      }

      try {
        emitFromEvent(JSON.parse(payloadLine) as StreamEvent);
      } catch {
        assembled += payloadLine;
        onDelta(payloadLine);
      }
    }
  }

  const tail = buffer.trim();
  if (tail) {
    const tailPayload = tail.startsWith("data:") ? tail.slice(5).trim() : tail;
    if (tailPayload && tailPayload !== "[DONE]") {
      try {
        emitFromEvent(JSON.parse(tailPayload) as StreamEvent);
      } catch {
        assembled += tailPayload;
        onDelta(tailPayload);
      }
    }
  }
}

export function RagAgentWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    createMessage(
      "assistant",
      "RAG Agent is ready. Ask a question about the selected MMCD document.",
    ),
  ]);

  const placeholder = useMemo(
    () => (isSending ? "Waiting for agent response..." : "Ask your LangGraph RAG agent..."),
    [isSending],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isOpen]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isSending) {
      return;
    }

    const userMessage = createMessage("user", trimmed);
    const assistantMessage = {
      ...createMessage("assistant", ""),
      status: "streaming" as const,
    };
    const nextMessages = [...messages, userMessage, assistantMessage];
    setMessages(nextMessages);
    setInput("");
    setError(null);
    setIsSending(true);
    setIsOpen(true);

    const requestBody = {
      messages: nextMessages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({
          role: message.role,
          content: message.content,
        })),
    };

    try {
      await streamAgentReply(requestBody, (deltaText, citations) => {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessage.id
              ? {
                  ...message,
                  content: `${message.content}${deltaText}`,
                  citations: citations ?? message.citations,
                  status: "streaming",
                }
              : message,
          ),
        );
      });

      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessage.id
            ? {
                ...message,
                content: message.content || "The agent returned an empty response.",
                status: "done",
              }
            : message,
        ),
      );
    } catch {
      try {
        const response = await fetch("/api/agent/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        const responseText = await response.text();
        let payload: AgentResponse = responseText;
        try {
          payload = JSON.parse(responseText) as AgentResponse;
        } catch {
          payload = responseText;
        }

        if (!response.ok) {
          throw new Error(toReadableError(payload, "Agent backend returned an error."));
        }

        const assistantReply = extractAssistantText(payload);
        const citations = extractAssistantCitations(payload);
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessage.id
              ? {
                  ...message,
                  content: assistantReply,
                  citations,
                  status: "done",
                }
              : message,
          ),
        );
      } catch (submitError) {
        const message =
          submitError instanceof Error ? submitError.message : "Unable to reach agent backend.";
        setMessages((current) =>
          current.map((entry) =>
            entry.id === assistantMessage.id
              ? {
                  ...entry,
                  content: "I couldn't reach the agent backend just now. Please try again.",
                  status: "error",
                }
              : entry,
          ),
        );
        setError(message);
      }
    } finally {
      setIsSending(false);
    }
  }

  return (
    <aside className="agentWidget">
      <button
        type="button"
        className="agentWidgetToggle"
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
      >
        {isOpen ? "Hide Agent" : "Ask Agent"}
      </button>

      <div className={`agentWidgetPanel ${isOpen ? "open" : "closed"}`} aria-hidden={!isOpen}>
        <header className="agentWidgetHeader">
          <div>
            <h2>RAG Agent</h2>
            <p>Streaming via `/api/agent/chat/stream`</p>
          </div>
          <button
            type="button"
            className="agentWidgetClose"
            onClick={() => setIsOpen(false)}
            aria-label="Close agent panel"
          >
            ✕
          </button>
        </header>

        <div className="agentWidgetMessages">
          {messages.map((message) => (
            <article
              key={message.id}
              className={`agentMessage ${message.role === "assistant" ? "assistant" : "user"}`}
            >
              <div className="agentMessageMeta">
                <span className="agentMessageRole">{message.role === "assistant" ? "Agent" : "You"}</span>
                {message.status === "streaming" ? <span className="agentStreamingBadge">Streaming...</span> : null}
                {message.status === "error" ? <span className="agentErrorBadge">Error</span> : null}
              </div>
              <p>{message.content}</p>

              {message.role === "assistant" && message.citations && message.citations.length > 0 ? (
                <div className="agentCitations">
                  {message.citations.map((citation, index) => {
                    const label = citationLabel(citation, index);
                    if (citation.url) {
                      return (
                        <a
                          key={`${message.id}-citation-${citation.id}-${index}`}
                          href={citation.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="agentCitationPill"
                          title={citation.url}
                        >
                          {label}
                        </a>
                      );
                    }
                    return (
                      <span
                        key={`${message.id}-citation-${citation.id}-${index}`}
                        className="agentCitationPill"
                        title="Citation"
                      >
                        {label}
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </article>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {error ? <p className="agentWidgetError">{error}</p> : null}

        <form className="agentWidgetForm" onSubmit={onSubmit}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={placeholder}
            rows={3}
            disabled={isSending}
          />
          <button type="submit" disabled={isSending || input.trim().length === 0}>
            {isSending ? "Sending..." : "Send"}
          </button>
        </form>
      </div>
    </aside>
  );
}
