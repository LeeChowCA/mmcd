"use client";

import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AgentWidgetHeader } from "./rag-agent/AgentWidgetHeader";
import { AgentWidgetMessages } from "./rag-agent/AgentWidgetMessages";
import { STARTER_HEADLINE, THOUGHT_STEPS } from "./rag-agent/constants";
import {
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
import { synthesizeAgentReply, transcribeAgentAudio } from "./rag-agent/voice";

type RagAgentWidgetProps = {
  onCitationClick?: (citation: Citation) => void;
};

type SubmitQuestionOptions = {
  autoSpeakReply?: boolean;
};

const DEFAULT_FORM_NOTE = "Answers are AI-generated and should be verified against the cited source.";

export function RagAgentWidget({ onCitationClick }: RagAgentWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSynthesizingSpeech, setIsSynthesizingSpeech] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [input, setInput] = useState("");
  const [thinkingStepIndex, setThinkingStepIndex] = useState(0);
  const [thinkingElapsedSec, setThinkingElapsedSec] = useState(0);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [lastReplyAudioUrl, setLastReplyAudioUrl] = useState<string | null>(null);
  const [lastReplyAudioText, setLastReplyAudioText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const lastReplyAudioUrlRef = useRef<string | null>(null);
  const voiceFlowCancelledRef = useRef(false);

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

  const formNote = voiceError || voiceNotice || DEFAULT_FORM_NOTE;
  const showReplayButton = Boolean(lastReplyAudioText) || isSpeaking || isSynthesizingSpeech;
  const micButtonLabel = isRecording
    ? "Stop recording"
    : isTranscribing
      ? "Transcribing..."
      : "Talk";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [visibleMessages, isOpen, isSending]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const maxHeight = 168;
    textarea.style.height = "0px";
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [input, isOpen, isExpanded]);

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

  useEffect(() => {
    return () => {
      stopVoiceCaptureTracks();
      stopAudioPlayback();
      revokeReplyAudioUrl();
    };
  }, []);

  function revokeReplyAudioUrl() {
    const currentUrl = lastReplyAudioUrlRef.current;
    if (!currentUrl) {
      return;
    }

    URL.revokeObjectURL(currentUrl);
    lastReplyAudioUrlRef.current = null;
    setLastReplyAudioUrl(null);
  }

  function stopAudioPlayback() {
    const player = audioPlayerRef.current;
    if (player) {
      player.pause();
      player.currentTime = 0;
      audioPlayerRef.current = null;
    }
    setIsSpeaking(false);
  }

  function stopVoiceCaptureTracks() {
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  async function playAudioFromUrl(audioUrl: string) {
    stopAudioPlayback();

    const player = new Audio(audioUrl);
    audioPlayerRef.current = player;
    setIsSpeaking(true);
    setVoiceError(null);
    setVoiceNotice("Speaking answer...");

    player.onended = () => {
      if (audioPlayerRef.current === player) {
        audioPlayerRef.current = null;
      }
      setIsSpeaking(false);
      setVoiceNotice(null);
    };

    player.onerror = () => {
      if (audioPlayerRef.current === player) {
        audioPlayerRef.current = null;
      }
      setIsSpeaking(false);
      setVoiceError("Unable to play the voice reply in this browser.");
      setVoiceNotice(null);
    };

    try {
      await player.play();
    } catch {
      if (audioPlayerRef.current === player) {
        audioPlayerRef.current = null;
      }
      setIsSpeaking(false);
      setVoiceError("Browser blocked reply audio playback.");
      setVoiceNotice(null);
    }
  }

  async function speakReply(text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    if (voiceFlowCancelledRef.current) {
      return;
    }

    setLastReplyAudioText(trimmed);
    setIsSynthesizingSpeech(true);
    setVoiceError(null);
    setVoiceNotice("Preparing voice reply...");

    try {
      const audioBlob = await synthesizeAgentReply(trimmed);
      revokeReplyAudioUrl();

      const audioUrl = URL.createObjectURL(audioBlob);
      lastReplyAudioUrlRef.current = audioUrl;
      setLastReplyAudioUrl(audioUrl);
      setIsSynthesizingSpeech(false);
      await playAudioFromUrl(audioUrl);
    } catch (error) {
      setIsSynthesizingSpeech(false);
      setVoiceNotice(null);
      setVoiceError(error instanceof Error ? error.message : "Voice synthesis failed.");
    }
  }

  async function replayLastReplyAudio() {
    if (isSpeaking) {
      stopAudioPlayback();
      setVoiceNotice(null);
      return;
    }

    if (lastReplyAudioUrl) {
      await playAudioFromUrl(lastReplyAudioUrl);
      return;
    }

    if (lastReplyAudioText) {
      await speakReply(lastReplyAudioText);
    }
  }

  async function submitQuestion(rawQuestion: string, options?: SubmitQuestionOptions) {
    const trimmed = rawQuestion.trim();
    if (!trimmed || isSending) {
      return;
    }

    voiceFlowCancelledRef.current = false;
    const autoSpeakReply = options?.autoSpeakReply === true;
    let replyToSpeak: string | null = null;
    stopAudioPlayback();
    setVoiceError(null);
    setVoiceNotice(autoSpeakReply ? "Sending your question..." : null);

    const userMessage = createMessage("user", trimmed);
    const assistantMessage: ChatMessage = {
      ...createMessage("assistant", ""),
      status: "streaming",
    };
    const nextMessages = [...messages, userMessage, assistantMessage];
    let streamedAnswer = "";

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
        if (deltaText) {
          streamedAnswer += deltaText;
        }

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

      const finalAnswer = streamedAnswer || "The agent returned an empty response.";
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessage.id
            ? {
                ...message,
                content: finalAnswer,
                suggestedQuestions:
                  message.suggestedQuestions ?? buildFallbackSuggestedQuestions(trimmed),
                status: "done",
              }
            : message,
        ),
      );
      if (autoSpeakReply) {
        replyToSpeak = finalAnswer;
      }
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
        const finalAnswer = assistantReply || "The agent returned an empty response.";

        setThinkingStepIndex(THOUGHT_STEPS.length - 1);
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessage.id
              ? {
                  ...message,
                  content: finalAnswer,
                  citations,
                  suggestedQuestions:
                    suggestedQuestions ?? buildFallbackSuggestedQuestions(trimmed),
                  status: "done",
                }
              : message,
          ),
        );
        if (autoSpeakReply) {
          replyToSpeak = finalAnswer;
        }
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
        if (autoSpeakReply) {
          setVoiceNotice(null);
          setVoiceError(message);
        }
      }
    } finally {
      setIsSending(false);
    }

    if (replyToSpeak) {
      void speakReply(replyToSpeak);
    } else if (!autoSpeakReply) {
      setVoiceNotice(null);
    }
  }

  async function transcribeAndSubmit(audioBlob: Blob) {
    setIsTranscribing(true);
    setVoiceError(null);
    setVoiceNotice("Transcribing your question...");

    try {
      const transcript = await transcribeAgentAudio(audioBlob);
      if (voiceFlowCancelledRef.current) {
        setVoiceNotice(null);
        return;
      }
      setInput(transcript);
      await submitQuestion(transcript, { autoSpeakReply: true });
    } catch (error) {
      setVoiceNotice(null);
      setVoiceError(error instanceof Error ? error.message : "Voice transcription failed.");
    } finally {
      setIsTranscribing(false);
    }
  }

  async function startVoiceCapture() {
    if (isSending || isTranscribing || isSynthesizingSpeech) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceError("Voice recording is not supported in this browser.");
      return;
    }

    voiceFlowCancelledRef.current = false;
    stopAudioPlayback();
    setVoiceError(null);
    setVoiceNotice("Listening... tap the mic again to stop.");
    setIsOpen(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        setVoiceError("Voice recording failed.");
        setVoiceNotice(null);
        setIsRecording(false);
        stopVoiceCaptureTracks();
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        audioChunksRef.current = [];
        setIsRecording(false);
        stopVoiceCaptureTracks();

        if (audioBlob.size === 0) {
          setVoiceNotice(null);
          setVoiceError("No audio was captured.");
          return;
        }

        void transcribeAndSubmit(audioBlob);
      };

      recorder.start();
      setIsRecording(true);
    } catch (error) {
      stopVoiceCaptureTracks();
      setVoiceNotice(null);
      setVoiceError(
        error instanceof Error ? error.message : "Microphone access was denied or unavailable.",
      );
    }
  }

  function stopVoiceCapture() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      return;
    }

    if (recorder.state !== "inactive") {
      setVoiceNotice("Finishing recording...");
      recorder.stop();
    }
  }

  function cancelVoiceCapture() {
    voiceFlowCancelledRef.current = true;
    audioChunksRef.current = [];
    setIsRecording(false);
    setIsTranscribing(false);
    setVoiceNotice(null);
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        // no-op
      }
    }
    stopVoiceCaptureTracks();
  }

  function handleVoiceButtonClick() {
    if (isRecording) {
      stopVoiceCapture();
      return;
    }

    void startVoiceCapture();
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

  function handleClose() {
    cancelVoiceCapture();
    stopAudioPlayback();
    setIsOpen(false);
    setIsExpanded(false);
    setVoiceNotice(null);
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
          isExpanded={isExpanded}
          onToggleExpanded={() => setIsExpanded((current) => !current)}
          onClose={handleClose}
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

        <form
          className={`agentWidgetForm ${isStarterState ? "agentWidgetForm--starter" : ""}`.trim()}
          onSubmit={onSubmit}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about specifications, requirements, procedures, or cited source pages..."
            rows={2}
            disabled={isSending || isTranscribing || isRecording}
          />
          <div className="agentWidgetFormFooter">
            <p className={`agentWidgetFormNote ${voiceError ? "is-error" : ""}`.trim()}>{formNote}</p>
            <div className="agentWidgetFormActions">
              {showReplayButton ? (
                <button
                  type="button"
                  className="agentWidgetSecondaryButton"
                  onClick={() => {
                    void replayLastReplyAudio();
                  }}
                  disabled={isTranscribing || isRecording}
                  aria-label={isSpeaking ? "Stop voice reply" : "Play voice reply"}
                  title={isSpeaking ? "Stop voice reply" : "Play voice reply"}
                >
                  {isSynthesizingSpeech ? (
                    "Preparing..."
                  ) : isSpeaking ? (
                    "Stop audio"
                  ) : (
                    <>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M5 10v4h3l4 4V6L8 10H5Z"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M16 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span>Play</span>
                    </>
                  )}
                </button>
              ) : null}
              <button
                type="button"
                className={`agentWidgetSecondaryButton ${isRecording ? "is-active" : ""}`.trim()}
                onClick={handleVoiceButtonClick}
                disabled={isSending || isTranscribing || isSynthesizingSpeech}
                aria-label={micButtonLabel}
                title={micButtonLabel}
              >
                {isRecording ? (
                  <>
                    <span className="agentRecordingDot" aria-hidden="true" />
                    <span>Stop</span>
                  </>
                ) : isTranscribing ? (
                  "Transcribing..."
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M12 4a3 3 0 0 1 3 3v5a3 3 0 1 1-6 0V7a3 3 0 0 1 3-3Z"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M19 11a7 7 0 0 1-14 0M12 18v3M8.5 21h7"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span>Talk</span>
                  </>
                )}
              </button>
              <button
                type="submit"
                disabled={
                  isSending ||
                  isRecording ||
                  isTranscribing ||
                  input.trim().length === 0
                }
              >
                {isSending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </aside>
  );
}
