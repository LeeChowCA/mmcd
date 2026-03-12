import { NextResponse } from "next/server";

type JsonBody = Record<string, unknown>;
const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000/api/ask";

export const runtime = "nodejs";
export const maxDuration = 60;

function getBackendUrl() {
  return process.env.AGENT_BACKEND_URL ?? DEFAULT_BACKEND_URL;
}

function getSpeakBackendUrl() {
  const explicit = process.env.AGENT_BACKEND_VOICE_SPEAK_URL;
  if (explicit) {
    return explicit;
  }

  const base = getBackendUrl();
  if (!base) {
    return "";
  }

  if (base.includes("/api/ask")) {
    return base.replace(/\/api\/ask\/?$/, "/api/voice/speak");
  }

  return `${base.replace(/\/+$/, "")}/voice/speak`;
}

function createBackendHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

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
  const backendUrl = getSpeakBackendUrl();
  if (!backendUrl) {
    return NextResponse.json({ error: "Missing voice speech backend URL." }, { status: 500 });
  }

  let body: JsonBody;
  try {
    body = (await request.json()) as JsonBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(backendUrl, {
      method: "POST",
      headers: createBackendHeaders(),
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to reach voice speech backend.",
        backendUrl,
        details: error instanceof Error ? error.message : "Unknown network error",
      },
      { status: 502 },
    );
  }

  const audioBuffer = await upstream.arrayBuffer();

  if (!upstream.ok) {
    const detail = new TextDecoder().decode(audioBuffer).slice(0, 600);
    return NextResponse.json(
      {
        error: "Voice speech backend request failed.",
        status: upstream.status,
        details: detail,
      },
      { status: 502 },
    );
  }

  return new Response(audioBuffer, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
