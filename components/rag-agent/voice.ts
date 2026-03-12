import { normalizeMessageContent } from "./helpers";

type VoiceTranscriptionPayload = {
  text?: unknown;
  transcript?: unknown;
  error?: unknown;
};

function toReadableMessage(value: unknown, fallback: string) {
  const text = normalizeMessageContent(value).trim();
  return text || fallback;
}

export async function transcribeAgentAudio(audioBlob: Blob) {
  const filename = audioBlob.type.includes("wav") ? "voice-input.wav" : "voice-input.webm";
  const formData = new FormData();
  formData.append("file", new File([audioBlob], filename, { type: audioBlob.type || "audio/webm" }));

  const response = await fetch("/api/agent/voice/transcribe", {
    method: "POST",
    body: formData,
  });

  const rawText = await response.text();
  let payload: VoiceTranscriptionPayload = {};
  try {
    payload = JSON.parse(rawText) as VoiceTranscriptionPayload;
  } catch {
    payload = { text: rawText };
  }

  if (!response.ok) {
    throw new Error(toReadableMessage(payload.error ?? rawText, "Voice transcription failed."));
  }

  const transcript = toReadableMessage(payload.text ?? payload.transcript, "");
  if (!transcript) {
    throw new Error("Voice transcription returned an empty transcript.");
  }

  return transcript;
}

export async function synthesizeAgentReply(text: string) {
  const response = await fetch("/api/agent/voice/speak", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const rawText = await response.text();
    throw new Error(rawText || "Voice synthesis failed.");
  }

  return response.blob();
}
