import type { RefObject } from "react";
import { RECOMMENDED_QUESTIONS, STARTER_HEADLINE, THOUGHT_STEPS } from "./constants";
import {
  formatConversationDate,
  formatMessageTime,
  renderAssistantContent,
  shouldShowDate,
} from "./helpers";
import type { ChatMessage, Citation } from "./types";

type AgentWidgetMessagesProps = {
  copiedMessageId: string | null;
  isSending: boolean;
  isStarterState: boolean;
  lastAssistantMessageId: string | null;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  showThinkingCard: boolean;
  thinkingElapsedSec: number;
  thinkingProgressPct: number;
  thinkingStep: string;
  thinkingStepIndex: number;
  visibleMessages: ChatMessage[];
  onCitationClick: (citation: Citation) => void;
  onCopyMessage: (message: ChatMessage) => void;
  onSubmitQuestion: (question: string) => void;
};

type StarterQuestionsProps = {
  isSending: boolean;
  onSubmitQuestion: (question: string) => void;
};

function StarterQuestions({ isSending, onSubmitQuestion }: StarterQuestionsProps) {
  return (
    <section className="agentSuggestedBlock">
      <p className="agentSuggestedEyebrow">Cited assistant</p>
      <h3>{STARTER_HEADLINE}</h3>
      <p className="agentSuggestedLead">
        Ask for summaries, obligations, testing procedures, or source locations. Every answer can
        route you back to the exact PDF page.
      </p>
      <div className="agentSuggestedGrid">
        {RECOMMENDED_QUESTIONS.map((question) => (
          <button
            key={question}
            type="button"
            className="agentSuggestedChip"
            onClick={() => onSubmitQuestion(question)}
            disabled={isSending}
          >
            {question}
          </button>
        ))}
      </div>
    </section>
  );
}

type AgentMessageItemProps = {
  copiedMessageId: string | null;
  index: number;
  isSending: boolean;
  lastAssistantMessageId: string | null;
  message: ChatMessage;
  visibleMessages: ChatMessage[];
  onCitationClick: (citation: Citation) => void;
  onCopyMessage: (message: ChatMessage) => void;
  onSubmitQuestion: (question: string) => void;
};

function AgentMessageItem({
  copiedMessageId,
  index,
  isSending,
  lastAssistantMessageId,
  message,
  visibleMessages,
  onCitationClick,
  onCopyMessage,
  onSubmitQuestion,
}: AgentMessageItemProps) {
  return (
    <div className="agentMessageGroup">
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
            <div className="agentAssistantText">
              {renderAssistantContent(message.content, message.citations, onCitationClick)}
            </div>
          )}

          <div className="agentMessageFooter">
            <span className="agentMessageTime">{formatMessageTime(message.createdAt)}</span>
            <div className="agentMessageActions">
              {message.status !== "streaming" ? (
                <button
                  type="button"
                  className="agentInlineIconButton"
                  onClick={() => onCopyMessage(message)}
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
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M10 21H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2h4m3-7 1 6h4.2a2 2 0 0 1 1.97 2.35l-.8 5A2 2 0 0 1 17.4 19H10"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="agentInlineIconButton"
                    title="Dislike reply"
                    aria-label="Dislike reply"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M14 3h4a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-4m-3 7-1-6H5.8a2 2 0 0 1-1.97-2.35l.8-5A2 2 0 0 1 6.6 5H14"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
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
                onClick={() => onSubmitQuestion(question)}
                disabled={isSending}
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type ThinkingCardProps = {
  thinkingElapsedSec: number;
  thinkingProgressPct: number;
  thinkingStep: string;
  thinkingStepIndex: number;
};

function ThinkingCard({
  thinkingElapsedSec,
  thinkingProgressPct,
  thinkingStep,
  thinkingStepIndex,
}: ThinkingCardProps) {
  return (
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
  );
}

export function AgentWidgetMessages({
  copiedMessageId,
  isSending,
  isStarterState,
  lastAssistantMessageId,
  messagesEndRef,
  showThinkingCard,
  thinkingElapsedSec,
  thinkingProgressPct,
  thinkingStep,
  thinkingStepIndex,
  visibleMessages,
  onCitationClick,
  onCopyMessage,
  onSubmitQuestion,
}: AgentWidgetMessagesProps) {
  return (
    <div className={`agentWidgetMessages ${isStarterState ? "agentWidgetMessages--starter" : ""}`.trim()}>
      {isStarterState ? (
        <StarterQuestions isSending={isSending} onSubmitQuestion={onSubmitQuestion} />
      ) : null}

      {visibleMessages.map((message, index) => (
        <AgentMessageItem
          key={message.id}
          copiedMessageId={copiedMessageId}
          index={index}
          isSending={isSending}
          lastAssistantMessageId={lastAssistantMessageId}
          message={message}
          visibleMessages={visibleMessages}
          onCitationClick={onCitationClick}
          onCopyMessage={onCopyMessage}
          onSubmitQuestion={onSubmitQuestion}
        />
      ))}

      {showThinkingCard ? (
        <ThinkingCard
          thinkingElapsedSec={thinkingElapsedSec}
          thinkingProgressPct={thinkingProgressPct}
          thinkingStep={thinkingStep}
          thinkingStepIndex={thinkingStepIndex}
        />
      ) : null}

      <div ref={messagesEndRef} />
    </div>
  );
}
