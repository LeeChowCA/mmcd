import { NextResponse } from "next/server";

type JsonBody = Record<string, unknown>;
const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000/api/ask";

function getBackendUrl() {
  return process.env.AGENT_BACKEND_URL ?? DEFAULT_BACKEND_URL;
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
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    return NextResponse.json(
      { error: "Missing AGENT_BACKEND_URL. Set it in your environment." },
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
    upstream = await fetch(backendUrl, {
      method: "POST",
      headers: createBackendHeaders(),
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to reach agent backend.",
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
        error: "Agent backend request failed.",
        status: upstream.status,
        details: rawText.slice(0, 600),
      },
      { status: 502 },
    );
  }

  try {
    const payload = JSON.parse(rawText) as JsonBody;
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json({ reply: rawText });
  }
}
