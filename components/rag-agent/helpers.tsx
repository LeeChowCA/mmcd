import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { AgentResponse, Citation, ChatMessage, ChatRole } from "./types";

export function normalizeMessageContent(value: unknown): string {
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

export function parseCitations(value: unknown): Citation[] | undefined {
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
    const scoreCandidate = candidate.score;
    const pageNumber =
      typeof pageCandidate === "number" && Number.isFinite(pageCandidate)
        ? Math.max(1, Math.floor(pageCandidate))
        : undefined;
    const score =
      typeof scoreCandidate === "number" && Number.isFinite(scoreCandidate)
        ? scoreCandidate
        : undefined;
    const url = normalizeMessageContent(candidate.url || candidate.source_url || candidate.href).trim();
    const sourceFile = normalizeMessageContent(
      candidate.source_file || candidate.sourceFile || candidate.file_name,
    ).trim();
    const rawSourceId = normalizeMessageContent(
      candidate.source_id || candidate.sourceId,
    ).trim();
    const pageId = normalizeMessageContent(candidate.page_id || candidate.pageId).trim();
    const excerpt = normalizeMessageContent(candidate.excerpt || candidate.snippet).trim();
    const matchedText = normalizeMessageContent(
      candidate.matched_text || candidate.matchedText,
    ).trim();
    const label = normalizeMessageContent(
      candidate.label || candidate.title || candidate.file_name || candidate.source,
    ).trim();
    let derivedSourceId = rawSourceId;

    if (!derivedSourceId && sourceFile) {
      derivedSourceId = sourceFile
        .replace(/\.[^.]+$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    }

    if (!derivedSourceId && url) {
      try {
        const parsedUrl = new URL(url, window.location.origin);
        const leaf = decodeURIComponent(parsedUrl.pathname.split("/").filter(Boolean).pop() || "");
        derivedSourceId = leaf
          .replace(/\.[^.]+$/, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
      } catch {
        derivedSourceId = "";
      }
    }

    parsed.push({
      id: Number.isFinite(numericId) ? numericId : index + 1,
      url: url || undefined,
      label: label || undefined,
      page: pageNumber,
      sourceId: derivedSourceId || undefined,
      pageId: pageId || undefined,
      sourceFile: sourceFile || undefined,
      excerpt: excerpt || undefined,
      matchedText: matchedText || undefined,
      score,
    });
  }

  return parsed.length > 0 ? parsed : undefined;
}

export function shortenSuggestedQuestion(input: string): string {
  const normalized = input
    .replace(/\s+/g, " ")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
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

export function parseSuggestedQuestions(value: unknown): string[] | undefined {
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

function getSuggestedQuestionsValue(
  value: Pick<
    Exclude<AgentResponse, string>,
    "suggested_questions" | "suggestedQuestions" | "follow_up_questions" | "followUpQuestions"
  >,
) {
  return (
    value.follow_up_questions ??
    value.followUpQuestions ??
    value.suggested_questions ??
    value.suggestedQuestions
  );
}

export function extractAssistantText(payload: AgentResponse): string {
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

export function extractAssistantCitations(payload: AgentResponse): Citation[] | undefined {
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

export function extractSuggestedQuestions(payload: AgentResponse): string[] | undefined {
  if (typeof payload === "string") {
    return undefined;
  }

  return parseSuggestedQuestions(getSuggestedQuestionsValue(payload));
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

function renderHighlightedPreviewText(text: string, matchedText?: string) {
  if (!matchedText) {
    return text;
  }

  const normalizedMatch = matchedText.trim();
  if (!normalizedMatch) {
    return text;
  }

  const escaped = normalizedMatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "ig"));
  const hasMatch = parts.some((part) => part.toLowerCase() === normalizedMatch.toLowerCase());

  if (!hasMatch) {
    return text;
  }

  return parts.map((part, index) =>
    part.toLowerCase() === normalizedMatch.toLowerCase() ? <mark key={`${part}-${index}`}>{part}</mark> : part,
  );
}

function buildCitationPreviewText(citation: Citation) {
  if (citation.excerpt?.trim()) {
    return citation.excerpt.trim();
  }

  const pageText =
    typeof citation.page === "number"
      ? `Page ${citation.page}`
      : "Referenced section";
  const label = citation.label?.trim() || citation.sourceFile?.trim() || "Document";
  return `${label} - ${pageText}`;
}

function CitationNode({
  citation,
  label,
  onCitationClick,
}: {
  citation: Citation;
  label: string;
  onCitationClick?: (citation: Citation) => void;
}) {
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const previewRef = useRef<HTMLSpanElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [previewStyle, setPreviewStyle] = useState<{ left: number; top: number } | null>(null);

  const previewText = buildCitationPreviewText(citation);
  const previewTitle = citation.label?.trim() || citation.sourceFile?.trim() || `Source ${citation.id}`;

  useLayoutEffect(() => {
    if (!isOpen || !wrapperRef.current || !previewRef.current) {
      return;
    }

    const wrapperRect = wrapperRef.current.getBoundingClientRect();
    const previewRect = previewRef.current.getBoundingClientRect();
    const panel =
      wrapperRef.current.closest(".agentWidgetPanel") ?? wrapperRef.current.closest(".agentWidgetMessages");
    const panelRect = panel?.getBoundingClientRect();

    if (!panelRect) {
      setPreviewStyle({ left: 0, top: -previewRect.height - 10 });
      return;
    }

    const gutter = 16;
    const preferredLeft = wrapperRect.left;
    const minLeft = panelRect.left + gutter;
    const maxLeft = panelRect.right - gutter - previewRect.width;
    const clampedLeft = Math.min(Math.max(preferredLeft, minLeft), Math.max(minLeft, maxLeft));
    const left = clampedLeft - wrapperRect.left;

    const aboveTop = -previewRect.height - 10;
    const belowTop = wrapperRect.height + 10;
    const absoluteAboveTop = wrapperRect.top + aboveTop;
    const top = absoluteAboveTop < panelRect.top + gutter ? belowTop : aboveTop;

    setPreviewStyle({ left, top });
  }, [isOpen]);

  const openPreview = () => setIsOpen(true);
  const closePreview = () => setIsOpen(false);

  if (!onCitationClick) {
    if (citation.url) {
      return (
        <a
          className="agentCitationPill"
          href={citation.url}
          target="_blank"
          rel="noopener noreferrer"
          title={citation.url}
        >
          {label}
        </a>
      );
    }

    return <span className="agentCitationPill">{label}</span>;
  }

  return (
    <span
      ref={wrapperRef}
      className={`agentCitationWrapper ${isOpen ? "is-open" : ""}`}
      onMouseEnter={openPreview}
      onMouseLeave={closePreview}
      onFocusCapture={openPreview}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          closePreview();
        }
      }}
    >
      <button
        type="button"
        className="agentCitationPill agentCitationButton"
        onClick={() => onCitationClick(citation)}
        title={typeof citation.page === "number" ? `${previewTitle} - page ${citation.page}` : previewTitle}
      >
        {label}
      </button>
      <span
        ref={previewRef}
        className="agentCitationPreview"
        role="tooltip"
        style={
          previewStyle
            ? {
                left: `${previewStyle.left}px`,
                top: `${previewStyle.top}px`,
              }
            : undefined
        }
      >
        <strong className="agentCitationPreviewTitle">
          {previewTitle}
          {typeof citation.page === "number" ? ` - p.${citation.page}` : ""}
        </strong>
        <span className="agentCitationPreviewText">
          {renderHighlightedPreviewText(previewText, citation.matchedText)}
        </span>
      </span>
    </span>
  );
}

function renderCitationNode(
  citation: Citation,
  label: string,
  key: string,
  onCitationClick?: (citation: Citation) => void,
) {
  return <CitationNode key={key} citation={citation} label={label} onCitationClick={onCitationClick} />;
}

export function renderAssistantContent(
  content: string,
  citations?: Citation[],
  onCitationClick?: (citation: Citation) => void,
): ReactNode {
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
          if (citation) {
            return renderCitationNode(citation, segment, `${segment}-${index}`, onCitationClick);
          }
        }

        return <span key={`${segment}-${index}`}>{segment}</span>;
      })}
    </>
  );

  if (hasCitationTokens || !citations || citations.length === 0) {
    return rendered;
  }

  return (
    <>
      {rendered}
      <span className="agentCitationList">
        {citations.map((citation) =>
          renderCitationNode(
            citation,
            formatCitationLabel(citation),
            `${citation.id}-${citation.url || citation.label || citation.page || "citation"}`,
            onCitationClick,
          ),
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

export function buildFallbackSuggestedQuestions(question: string) {
  const topic = extractQuestionTopic(question);
  return [
    shortenSuggestedQuestion(`What section and page cover ${topic}?`),
    shortenSuggestedQuestion(`Can you summarize ${topic} in plain language?`),
    shortenSuggestedQuestion(`What related MMCD sections mention ${topic}?`),
  ];
}

export function createMessage(role: ChatRole, content: string): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: Date.now(),
  };
}

export function toReadableError(payload: AgentResponse, fallback: string) {
  if (typeof payload === "string") {
    return payload.trim() || fallback;
  }
  return normalizeMessageContent(payload) || fallback;
}

export function formatMessageTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function formatConversationDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  })
    .format(new Date(timestamp))
    .replace(".", "")
    .toUpperCase();
}

export function buildConversationTitle(messages: ChatMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  if (!firstUserMessage) {
    return "Chat 4";
  }

  const normalized = firstUserMessage.content.replace(/\s+/g, " ").trim();
  const firstBreak = normalized.search(/[.!?\n]/);
  const sentence = firstBreak !== -1 ? normalized.slice(0, firstBreak) : normalized;
  return (sentence || normalized).trim();
}

export function shouldShowDate(messages: ChatMessage[], index: number) {
  if (index === 0) {
    return true;
  }

  const currentDay = new Date(messages[index].createdAt).toDateString();
  const previousDay = new Date(messages[index - 1].createdAt).toDateString();
  return currentDay !== previousDay;
}

export function getLastAssistantMessageId(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") {
      return messages[index].id;
    }
  }
  return null;
}
