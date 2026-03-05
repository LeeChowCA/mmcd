import { NextResponse } from "next/server";

const DEFAULT_BACKEND_HEALTH_URL = "http://127.0.0.1:8000/health";

function getHealthUrl() {
  if (process.env.AGENT_BACKEND_HEALTH_URL) {
    return process.env.AGENT_BACKEND_HEALTH_URL;
  }

  const backendUrl = process.env.AGENT_BACKEND_URL;
  if (backendUrl && backendUrl.includes("/api/ask")) {
    return backendUrl.replace(/\/api\/ask\/?$/, "/health");
  }

  return DEFAULT_BACKEND_HEALTH_URL;
}

export async function GET() {
  const healthUrl = getHealthUrl();

  try {
    const upstream = await fetch(healthUrl, { cache: "no-store" });
    const text = await upstream.text();

    if (!upstream.ok) {
      return NextResponse.json(
        {
          ok: false,
          status: upstream.status,
          healthUrl,
          details: text.slice(0, 500),
        },
        { status: 502 },
      );
    }

    try {
      return NextResponse.json(JSON.parse(text) as unknown);
    } catch {
      return NextResponse.json({ ok: true, healthUrl, raw: text });
    }
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        healthUrl,
        error: error instanceof Error ? error.message : "Unknown network error",
      },
      { status: 502 },
    );
  }
}

