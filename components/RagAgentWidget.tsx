"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AgentWidgetHeader } from "./rag-agent/AgentWidgetHeader";
import { AgentWidgetMessages } from "./rag-agent/AgentWidgetMessages";
import { STARTER_HEADLINE, THOUGHT_STEPS } from "./rag-agent/constants";
import {
  buildConversationTitle,
  buildFallbackSuggestedQuestions,
  createMessage,
  extractAssistantCitations,
  extractAssistantText,
  extractSuggestedQuestions,
  getLastAssistantMessageId,
  toReadableError,
} from "./rag-agent/helpers";
import { streamAgentReply } from "./rag-agent/stream";
import type { AgentResponse, ChatMessage, Citation } from "./rag-agent/types";

type RagAgentWidgetProps = {
  onCitationClick?: (citation: Citation) => void;
};

export function RagAgentWidget({ onCitationClick }: RagAgentWidgetProps) {
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
          !(
            message.role === "assistant" &&
            message.status === "streaming" &&
            message.content.trim().length === 0
          ) && !(message.role === "assistant" && message.content.trim() === STARTER_HEADLINE),
      ),
    [messages],
  );

  const isStarterState = visibleMessages.length === 0 && !isSending;
  const conversationTitle = useMemo(() => buildConversationTitle(visibleMessages), [visibleMessages]);
  const thinkingStep = THOUGHT_STEPS[Math.min(thinkingStepIndex, THOUGHT_STEPS.length - 1)];
  const thinkingProgressPct = Math.round(
    ((Math.min(thinkingStepIndex, THOUGHT_STEPS.length - 1) + 1) / THOUGHT_STEPS.length) * 100,
  );
  const lastAssistantMessageId = useMemo(
    () => getLastAssistantMessageId(visibleMessages),
    [visibleMessages],
  );
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
                suggestedQuestions:
                  message.suggestedQuestions ?? buildFallbackSuggestedQuestions(trimmed),
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
                  suggestedQuestions:
                    suggestedQuestions ?? buildFallbackSuggestedQuestions(trimmed),
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
          Ask MMCD Agent
        </button>
      ) : null}

      <div
        className={`agentWidgetPanel ${isOpen ? "open" : "closed"} ${isExpanded ? "expanded" : ""}`}
        aria-hidden={!isOpen}
      >
        <AgentWidgetHeader
          conversationTitle={conversationTitle}
          isExpanded={isExpanded}
          onToggleExpanded={() => setIsExpanded((current) => !current)}
          onClose={() => {
            setIsOpen(false);
            setIsExpanded(false);
          }}
        />

        <AgentWidgetMessages
          copiedMessageId={copiedMessageId}
          isSending={isSending}
          isStarterState={isStarterState}
          lastAssistantMessageId={lastAssistantMessageId}
          messagesEndRef={messagesEndRef}
          showThinkingCard={showThinkingCard}
          thinkingElapsedSec={thinkingElapsedSec}
          thinkingProgressPct={thinkingProgressPct}
          thinkingStep={thinkingStep}
          thinkingStepIndex={thinkingStepIndex}
          visibleMessages={visibleMessages}
          onCitationClick={(citation) => {
            onCitationClick?.(citation);
          }}
          onCopyMessage={copyMessage}
          onSubmitQuestion={(question) => {
            void submitQuestion(question);
          }}
        />

        <form className="agentWidgetForm" onSubmit={onSubmit}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about specifications, requirements, procedures, or cited source pages..."
            rows={1}
            disabled={isSending}
          />
          <div className="agentWidgetFormFooter">
            <p className="agentWidgetFormNote">
              Answers are AI-generated and should be verified against the cited source.
            </p>
            <button type="submit" disabled={isSending || input.trim().length === 0}>
              {isSending ? "Sending..." : "Send"}
            </button>
          </div>
        </form>
      </div>
    </aside>
  );
}
