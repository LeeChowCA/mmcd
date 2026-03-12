import { NextResponse } from "next/server";

const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000/api/ask";

export const runtime = "nodejs";

function getBackendUrl() {
  return process.env.AGENT_BACKEND_URL ?? DEFAULT_BACKEND_URL;
}

function getTranscribeBackendUrl() {
  const explicit = process.env.AGENT_BACKEND_VOICE_TRANSCRIBE_URL;
  if (explicit) {
    return explicit;
  }

  const base = getBackendUrl();
  if (!base) {
    return "";
  }

  if (base.includes("/api/ask")) {
    return base.replace(/\/api\/ask\/?$/, "/api/voice/transcribe");
  }

  return `${base.replace(/\/+$/, "")}/voice/transcribe`;
}

function createBackendHeaders() {
  const headers: Record<string, string> = {};

  const authHeader = process.env.AGENT_BACKEND_AUTH_HEADER;
  if (authHeader) {
    headers.Authorization = authHeader;
  }

  const apiKey = process.env.AGENT_BACKEND_API_KEY;
  if (apiKey && !headers.Authorization) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

export async function POST(request: Request) {
  const backendUrl = getTranscribeBackendUrl();
  if (!backendUrl) {
    return NextResponse.json(
      { error: "Missing voice transcription backend URL." },
      { status: 500 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form-data request body." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing audio file upload." }, { status: 400 });
  }

  const upstreamForm = new FormData();
  upstreamForm.append("file", file, file.name || "voice-input.webm");

  for (const [key, value] of formData.entries()) {
    if (key === "file") {
      continue;
    }
    if (typeof value === "string") {
      upstreamForm.append(key, value);
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(backendUrl, {
      method: "POST",
      headers: createBackendHeaders(),
      body: upstreamForm,
      cache: "no-store",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to reach voice transcription backend.",
        backendUrl,
        details: error instanceof Error ? error.message : "Unknown network error",
      },
      { status: 502 },
    );
  }

  const rawText = await upstream.text();

  if (!upstream.ok) {
    return NextResponse.json(
      {
        error: "Voice transcription backend request failed.",
        status: upstream.status,
        details: rawText.slice(0, 600),
      },
      { status: 502 },
    );
  }

  try {
    return NextResponse.json(JSON.parse(rawText) as unknown);
  } catch {
    return NextResponse.json({ text: rawText.trim() });
  }
}
