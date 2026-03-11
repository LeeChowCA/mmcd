import { normalizeMessageContent, parseCitations, parseSuggestedQuestions } from "./helpers";
import type { StreamAgentEventPayload, StreamEvent } from "./types";

function getSuggestedQuestionsValue(event: StreamEvent) {
  return (
    event.follow_up_questions ??
    event.followUpQuestions ??
    event.suggested_questions ??
    event.suggestedQuestions
  );
}

export async function streamAgentReply(
  requestBody: unknown,
  onEvent: (payload: StreamAgentEventPayload) => void,
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
    const suggestedQuestions = parseSuggestedQuestions(getSuggestedQuestionsValue(event));
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

      // Ignore SSE comments/metadata such as ": keep-alive" or ": stream-start".
      if (line.startsWith(":") || line.startsWith("event:") || line.startsWith("id:")) {
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
    if (tail.startsWith(":") || tail.startsWith("event:") || tail.startsWith("id:")) {
      return;
    }

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
