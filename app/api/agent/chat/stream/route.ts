import { NextResponse } from "next/server";

type JsonBody = Record<string, unknown>;
const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000/api/ask";

function getBackendUrl() {
  return process.env.AGENT_BACKEND_URL ?? DEFAULT_BACKEND_URL;
}

function getStreamBackendUrl() {
  const explicit = process.env.AGENT_BACKEND_STREAM_URL;
  if (explicit) {
    return explicit;
  }

  const base = getBackendUrl();
  if (!base) {
    return "";
  }

  if (base.endsWith("/stream")) {
    return base;
  }

  if (base.includes("/api/ask")) {
    return base.replace(/\/api\/ask\/?$/, "/api/ask/stream");
  }

  return `${base.replace(/\/+$/, "")}/stream`;
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
  const streamBackendUrl = getStreamBackendUrl();
  if (!streamBackendUrl) {
    return NextResponse.json(
      {
        error:
          "Missing AGENT_BACKEND_STREAM_URL (or AGENT_BACKEND_URL). Set one in your environment.",
      },
      { status: 500 },
    );
  }

  let body: JsonBody;
  try {
    body = (await request.json()) as JsonBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(streamBackendUrl, {
      method: "POST",
      headers: createBackendHeaders(),
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to reach agent streaming backend.",
        streamBackendUrl,
        details: error instanceof Error ? error.message : "Unknown network error",
      },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const rawText = await upstream.text();
    return NextResponse.json(
      {
        error: "Agent streaming backend request failed.",
        status: upstream.status,
        details: rawText.slice(0, 600),
      },
      { status: 502 },
    );
  }

  if (!upstream.body) {
    return NextResponse.json(
      { error: "Agent backend did not return a stream body." },
      { status: 502 },
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
