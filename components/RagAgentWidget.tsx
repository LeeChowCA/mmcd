"use client";

import Image from "next/image";
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
  createdAt: number;
  status?: "streaming" | "done" | "error";
  citations?: Citation[];
  suggestedQuestions?: string[];
};

type AgentResponse =
  | string
  | {
      answer?: unknown;
      reply?: unknown;
      output?: unknown;
      message?: unknown;
      citations?: unknown;
      suggested_questions?: unknown;
      suggestedQuestions?: unknown;
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
  suggested_questions?: unknown;
  suggestedQuestions?: unknown;
};

const STARTER_HEADLINE = "What can I break down for you?";

const RECOMMENDED_QUESTIONS = [
  "What are the key contractor obligations in SGC?",
  "Where is the approved materials list for roadway lighting?",
  "Summarize start-up, testing and commissioning requirements.",
  "What sections cover sanitary sewers and related requirements?",
  "Find the requirements for pre-testing and commissioning.",
];

const THOUGHT_STEPS = [
  "Breaking down your question",
  "Finding relevant sections",
  "Reading sources",
  "Drafting response",
  "Finalizing",
];

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

function shortenSuggestedQuestion(input: string): string {
  const normalized = input
    .replace(/\s+/g, " ")
    .replace(/[??]/g, '"')
    .replace(/[??]/g, "'")
    .trim();

  if (!normalized) {
    return "";
  }

  const lower = normalized.toLowerCase();
  if (lower.includes("exact section") || lower.includes("exact page")) {
    return "Can you show the exact section and page?";
  }
  if (lower.includes("plain language") || lower.includes("summarize")) {
    return "Can you summarize this in plain language?";
  }
  if (lower.includes("related") && lower.includes("section")) {
    return "What related MMCD sections should I review?";
  }
  if (lower.includes("what page") || lower.includes("where is")) {
    return "Where is this covered in the document?";
  }
  if (lower.includes("requirements") || lower.includes("requirement")) {
    return "What are the key requirements here?";
  }

  const withoutQuotes = normalized.replace(/"[^"]*"/g, "").replace(/\s+/g, " ").trim();
  const trimmedLead = withoutQuotes
    .replace(/^please\s+/i, "")
    .replace(/^could\s+you\s+/i, "Can you ")
    .replace(/^would\s+you\s+/i, "Can you ")
    .replace(/^tell me\s+/i, "Can you explain ")
    .replace(/^show me\s+/i, "Can you show me ")
    .replace(/^find\s+/i, "Can you find ")
    .replace(/^list\s+/i, "Can you list ")
    .trim();

  const baseText = trimmedLead || normalized;
  const words = baseText.split(/\s+/).filter(Boolean);

  if (words.length < 5) {
    return "Can you explain this section in more detail?";
  }

  const cappedWords = words.slice(0, 30);
  let result = cappedWords.join(" ").replace(/[,.!?;:]+$/, "").trim();

  if (!/^(can|what|where|which|how|is|are|do|does)\b/i.test(result)) {
    result = `Can you ${result.charAt(0).toLowerCase()}${result.slice(1)}`;
  }

  if (!result.endsWith("?")) {
    result = `${result}?`;
  }

  return result;
}

function parseSuggestedQuestions(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parsed = value
    .map((entry) => shortenSuggestedQuestion(normalizeMessageContent(entry)))
    .filter(Boolean)
    .filter((entry, index, all) => all.indexOf(entry) === index)
    .slice(0, 4);

  return parsed.length > 0 ? parsed : undefined;
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

function extractSuggestedQuestions(payload: AgentResponse): string[] | undefined {
  if (typeof payload === "string") {
    return undefined;
  }

  return parseSuggestedQuestions(payload.suggested_questions ?? payload.suggestedQuestions);
}

function formatCitationLabel(citation: Citation) {
  const base = (citation.label || "").trim();
  if (base) {
    return base.length > 28 ? `${base.slice(0, 27)}...` : base;
  }

  if (citation.url) {
    try {
      const url = new URL(citation.url);
      const leaf = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "").trim();
      if (leaf) {
        return leaf.length > 18 ? `${leaf.slice(0, 17)}...` : leaf;
      }
      return url.hostname.replace(/^www\./, "") || `Source ${citation.id}`;
    } catch {
      return `Source ${citation.id}`;
    }
  }

  return `Source ${citation.id}`;
}

function renderAssistantContent(content: string, citations?: Citation[]) {
  const citationMap = new Map<number, Citation>();
  for (const citation of citations ?? []) {
    citationMap.set(citation.id, citation);
  }

  const segments = content.split(/(\[\d{1,3}\])/g);
  const hasCitationTokens = segments.some((segment) => /^\[\d{1,3}\]$/.test(segment));

  const rendered = (
    <>
      {segments.map((segment, index) => {
        const match = segment.match(/^\[(\d{1,3})\]$/);
        if (match) {
          const citation = citationMap.get(Number(match[1]));
          if (citation?.url) {
            return (
              <a
                key={`${segment}-${index}`}
                className="agentCitationPill"
                href={citation.url}
                target="_blank"
                rel="noopener noreferrer"
                title={citation.url}
              >
                {segment}
              </a>
            );
          }
        }

        return <span key={`${segment}-${index}`}>{segment}</span>;
      })}
    </>
  );

  if (hasCitationTokens) {
    return rendered;
  }

  if (!citations || citations.length === 0) {
    return rendered;
  }

  return (
    <>
      {rendered}
      <span className="agentCitationList">
        {citations.map((citation) =>
          citation.url ? (
            <a
              key={`${citation.id}-${citation.url}`}
              className="agentCitationPill"
              href={citation.url}
              target="_blank"
              rel="noopener noreferrer"
              title={citation.url}
            >
              {formatCitationLabel(citation)}
            </a>
          ) : null,
        )}
      </span>
    </>
  );
}

function extractQuestionTopic(question: string) {
  const normalized = question
    .replace(/\s+/g, " ")
    .replace(/[?.!]+$/, "")
    .trim();

  const topic = normalized
    .replace(/^(can|could|would)\s+you\s+/i, "")
    .replace(/^please\s+/i, "")
    .replace(/^what\s+sections?\s+(cover|mention|address)\s+/i, "")
    .replace(/^which\s+sections?\s+(cover|mention|address)\s+/i, "")
    .replace(/^where\s+(is|are)\s+/i, "")
    .replace(/^find\s+/i, "")
    .replace(/^show\s+me\s+/i, "")
    .replace(/^summari[sz]e\s+/i, "")
    .replace(/^explain\s+/i, "")
    .replace(/^what\s+are\s+the\s+/i, "")
    .replace(/^(the\s+)?requirements?\s+for\s+/i, "")
    .replace(/\s+in\s+plain\s+language$/i, "")
    .replace(/\s+and\s+related\s+requirements$/i, "")
    .replace(/\s+related\s+requirements$/i, "")
    .replace(/^the\s+/i, "")
    .trim();

  const words = topic.split(/\s+/).filter(Boolean).slice(0, 8);
  return words.length > 0 ? words.join(" ") : "this topic";
}

function buildFallbackSuggestedQuestions(question: string) {
  const topic = extractQuestionTopic(question);
  return [
    shortenSuggestedQuestion(`What section and page cover ${topic}?`),
    shortenSuggestedQuestion(`Can you summarize ${topic} in plain language?`),
    shortenSuggestedQuestion(`What related MMCD sections mention ${topic}?`),
  ];
}

function createMessage(role: ChatRole, content: string): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: Date.now(),
  };
}

function toReadableError(payload: AgentResponse, fallback: string) {
  if (typeof payload === "string") {
    return payload.trim() || fallback;
  }
  return normalizeMessageContent(payload) || fallback;
}

function formatMessageTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatConversationDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  })
    .format(new Date(timestamp))
    .replace(".", "")
    .toUpperCase();
}

function buildConversationTitle(messages: ChatMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  if (!firstUserMessage) {
    return "Chat 4";
  }

  const normalized = firstUserMessage.content.replace(/\s+/g, " ").trim();
  const firstBreak = normalized.search(/[.!?\n]/);
  const sentence = firstBreak !== -1 ? normalized.slice(0, firstBreak) : normalized;
  return (sentence || normalized).trim();
}

function shouldShowDate(messages: ChatMessage[], index: number) {
  if (index === 0) {
    return true;
  }

  const currentDay = new Date(messages[index].createdAt).toDateString();
  const previousDay = new Date(messages[index - 1].createdAt).toDateString();
  return currentDay !== previousDay;
}

function getLastAssistantMessageId(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") {
      return messages[index].id;
    }
  }
  return null;
}

async function streamAgentReply(
  requestBody: unknown,
  onEvent: (payload: { deltaText?: string; citations?: Citation[]; suggestedQuestions?: string[] }) => void,
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
    const suggestedQuestions = parseSuggestedQuestions(event.suggested_questions ?? event.suggestedQuestions);
    const eventType = String(event.event ?? event.type ?? "").toLowerCase();
    const delta =
      normalizeMessageContent(event.delta) ||
      normalizeMessageContent(event.text) ||
      normalizeMessageContent(event.token) ||
      normalizeMessageContent(event.chunk);

    if (delta) {
      assembled += delta;
      onEvent({ deltaText: delta, citations, suggestedQuestions });
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
          onEvent({ deltaText: extra, citations, suggestedQuestions });
        } else if (citations || suggestedQuestions) {
          onEvent({ citations, suggestedQuestions });
        }
      } else if (citations || suggestedQuestions) {
        onEvent({ citations, suggestedQuestions });
      }
    } else if (citations || suggestedQuestions) {
      onEvent({ citations, suggestedQuestions });
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
        onEvent({ deltaText: payloadLine });
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
        onEvent({ deltaText: tailPayload });
      }
    }
  }
}

export function RagAgentWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [input, setInput] = useState("");
  const [thinkingStepIndex, setThinkingStepIndex] = useState(0);
  const [thinkingElapsedSec, setThinkingElapsedSec] = useState(0);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (message) =>
          !(message.role === "assistant" && message.status === "streaming" && message.content.trim().length === 0) &&
          !(message.role === "assistant" && message.content.trim() === STARTER_HEADLINE),
      ),
    [messages],
  );
  const isStarterState = visibleMessages.length === 0 && !isSending;
  const conversationTitle = useMemo(() => buildConversationTitle(visibleMessages), [visibleMessages]);
  const thinkingStep = THOUGHT_STEPS[Math.min(thinkingStepIndex, THOUGHT_STEPS.length - 1)];
  const thinkingProgressPct = Math.round(
    ((Math.min(thinkingStepIndex, THOUGHT_STEPS.length - 1) + 1) / THOUGHT_STEPS.length) * 100,
  );
  const lastAssistantMessageId = useMemo(() => getLastAssistantMessageId(visibleMessages), [visibleMessages]);
  const showThinkingCard = useMemo(
    () =>
      isSending &&
      messages.some(
        (message) =>
          message.role === "assistant" &&
          message.status === "streaming" &&
          message.content.trim().length === 0,
      ),
    [isSending, messages],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visibleMessages, isOpen, isSending]);

  useEffect(() => {
    if (!copiedMessageId) {
      return;
    }

    const timer = window.setTimeout(() => setCopiedMessageId(null), 1400);
    return () => window.clearTimeout(timer);
  }, [copiedMessageId]);

  useEffect(() => {
    if (!isSending) {
      return;
    }

    setThinkingElapsedSec(0);
    setThinkingStepIndex(0);

    const timer = window.setInterval(() => {
      setThinkingElapsedSec((current) => current + 1);
      setThinkingStepIndex((current) => Math.min(current + 1, THOUGHT_STEPS.length - 1));
    }, 1100);

    return () => window.clearInterval(timer);
  }, [isSending]);

  async function submitQuestion(rawQuestion: string) {
    const trimmed = rawQuestion.trim();
    if (!trimmed || isSending) {
      return;
    }

    const userMessage = createMessage("user", trimmed);
    const assistantMessage: ChatMessage = {
      ...createMessage("assistant", ""),
      status: "streaming",
    };
    const nextMessages = [...messages, userMessage, assistantMessage];

    setMessages(nextMessages);
    setInput("");
    setIsSending(true);
    setIsOpen(true);

    const requestBody = {
      messages: nextMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    };

    try {
      await streamAgentReply(requestBody, ({ deltaText = "", citations, suggestedQuestions }) => {
        setThinkingStepIndex((current) => Math.max(current, 3));
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessage.id
              ? {
                  ...message,
                  content: `${message.content}${deltaText}`,
                  citations: citations ?? message.citations,
                  suggestedQuestions: suggestedQuestions ?? message.suggestedQuestions,
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
                  suggestedQuestions: message.suggestedQuestions ?? buildFallbackSuggestedQuestions(trimmed),
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
        const suggestedQuestions = extractSuggestedQuestions(payload);
        setThinkingStepIndex(THOUGHT_STEPS.length - 1);
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessage.id
                ? {
                    ...message,
                    content: assistantReply || "The agent returned an empty response.",
                    citations,
                    suggestedQuestions: suggestedQuestions ?? buildFallbackSuggestedQuestions(trimmed),
                    status: "done",
                  }
                : message,
          ),
        );
      } catch (submitError) {
        const message =
          submitError instanceof Error ? submitError.message : "Unable to reach agent backend.";
        console.error("Agent request failed", message);
        setMessages((current) =>
          current.map((entry) =>
            entry.id === assistantMessage.id
              ? {
                  ...entry,
                  content: `I noted your question: "${trimmed}", but the remote agent isn't reachable right now. Please try again once it's back online.`,
                  status: "error",
                }
              : entry,
          ),
        );
      }
    } finally {
      setIsSending(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitQuestion(input);
  }

  function copyMessage(message: ChatMessage) {
    if (!navigator?.clipboard) {
      return;
    }

    void navigator.clipboard.writeText(message.content).then(() => {
      setCopiedMessageId(message.id);
    });
  }

  return (
    <aside className="agentWidget">
      {!isOpen ? (
        <button
          type="button"
          className="agentWidgetToggle"
          onClick={() => setIsOpen(true)}
          aria-expanded={isOpen}
        >
          Ask Agent
        </button>
      ) : null}

      <div
        className={`agentWidgetPanel ${isOpen ? "open" : "closed"} ${isExpanded ? "expanded" : ""}`}
        aria-hidden={!isOpen}
      >
        <header className="agentWidgetHeader">
          <div className="agentHeaderIdentity">
            <div className="agentHeaderAvatar" aria-hidden="true">
              <Image src="/avino_logo.png" alt="" width={36} height={36} />
            </div>
            <div className="agentHeaderTitleButton" title={conversationTitle}>
              <span className="agentHeaderTitleText">{conversationTitle}</span>
              <span className="agentHeaderCaret" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M6 9l6 6 6-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </div>
          </div>

          <div className="agentWidgetHeaderActions">
            <button
              type="button"
              className="agentWidgetIconButton"
              onClick={() => setIsExpanded((current) => !current)}
              aria-label={isExpanded ? "Collapse chat" : "Expand chat"}
              title={isExpanded ? "Collapse chat" : "Expand chat"}
            >
              {isExpanded ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 5l4 4M19 5l-4 4M5 19l4-4M19 19l-4-4"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M9 9H7M9 9V7M15 9H17M15 9V7M9 15H7M9 15V17M15 15H17M15 15V17"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M9 9L5 5M15 9l4-4M9 15l-4 4M15 15l4 4"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M5 5H8M5 5V8M19 5H16M19 5V8M5 19H8M5 19V16M19 19H16M19 19V16"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>

            <button
              type="button"
              className="agentWidgetClose"
              onClick={() => {
                setIsOpen(false);
                setIsExpanded(false);
              }}
              aria-label="Close chat"
              title="Close chat"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 6l12 12M18 6 6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </header>

        <div className="agentWidgetMessages">
          {isStarterState ? (
            <section className="agentSuggestedBlock">
              <h3>{STARTER_HEADLINE}</h3>
              <ul className="agentSuggestedList">
                {RECOMMENDED_QUESTIONS.map((question) => (
                  <li key={question}>
                    <button
                      type="button"
                      className="agentSuggestedChip"
                      onClick={() => void submitQuestion(question)}
                      disabled={isSending}
                    >
                      {question}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {visibleMessages.map((message, index) => (
            <div key={message.id} className="agentMessageGroup">
              {shouldShowDate(visibleMessages, index) ? (
                <div className="agentDateDivider">
                  <span>{formatConversationDate(message.createdAt)}</span>
                </div>
              ) : null}

              <article className={`agentMessage agentMessage--${message.role}`}>
                <div className="agentMessageBody">
                  {message.role === "user" ? (
                    <div className="agentUserBubble">
                      <p>{message.content}</p>
                    </div>
                  ) : (
                    <div className="agentAssistantText">{renderAssistantContent(message.content, message.citations)}</div>
                  )}

                  <div className="agentMessageFooter">
                    <span className="agentMessageTime">{formatMessageTime(message.createdAt)}</span>
                    <div className="agentMessageActions">
                      {message.status !== "streaming" ? (
                        <button
                          type="button"
                          className="agentInlineIconButton"
                          onClick={() => copyMessage(message)}
                          title={copiedMessageId === message.id ? "Copied" : "Copy"}
                          aria-label={copiedMessageId === message.id ? "Copied" : "Copy"}
                        >
                          {copiedMessageId === message.id ? (
                            "Copied"
                          ) : (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                              <path
                                d="M9 9h10v10H9zM5 5h10v2H7v8H5z"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </button>
                      ) : null}

                      {message.role === "assistant" &&
                      message.status === "done" &&
                      message.id === lastAssistantMessageId ? (
                        <>
                          <button
                            type="button"
                            className="agentInlineIconButton"
                            title="Like reply"
                            aria-label="Like reply"
                          >
                            {"\u{1F44D}"}
                          </button>
                          <button
                            type="button"
                            className="agentInlineIconButton"
                            title="Dislike reply"
                            aria-label="Dislike reply"
                          >
                            {"\u{1F44E}"}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              </article>

              {message.role === "assistant" &&
              message.status === "done" &&
              message.id === lastAssistantMessageId &&
              (message.suggestedQuestions?.length ?? 0) > 0 ? (
                <div className="agentFollowUpBlock">
                  <div className="agentFollowUpDivider" />
                  <p className="agentFollowUpLabel">You might also ask:</p>
                  <div className="agentFollowUpChips">
                    {message.suggestedQuestions?.map((question) => (
                      <button
                        key={question}
                        type="button"
                        className="agentFollowUpChip"
                        onClick={() => void submitQuestion(question)}
                        disabled={isSending}
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))}

          {showThinkingCard ? (
            <article className="agentThoughtCard" aria-live="polite">
              <div className="agentThoughtTopRow">
                <span className="agentThoughtDots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <strong>{thinkingStep}</strong>
                <span>{`0:${String(thinkingElapsedSec).padStart(2, "0")}`}</span>
              </div>
              <div className="agentThoughtProgressTrack" aria-hidden="true">
                <span className="agentThoughtProgressFill" style={{ width: `${thinkingProgressPct}%` }} />
              </div>
              <p>{`Step ${Math.min(thinkingStepIndex + 1, THOUGHT_STEPS.length)}/${THOUGHT_STEPS.length}`}</p>
            </article>
          ) : null}

          <div ref={messagesEndRef} />
        </div>

        <form className="agentWidgetForm" onSubmit={onSubmit}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask, search, or make anything..."
            rows={1}
            disabled={isSending}
          />
          <div className="agentWidgetFormFooter">
            <p className="agentWidgetFormNote">For reference only - AI-generated content.</p>
            <button type="submit" disabled={isSending || input.trim().length === 0}>
              {isSending ? "Sending..." : "Send"}
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
}
