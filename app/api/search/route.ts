import { NextResponse } from "next/server";
import type { SearchHit } from "@/components/pdf-search/types";

type SearchRequestBody = {
  query?: unknown;
  sourceId?: unknown;
  minPct?: unknown;
  limit?: unknown;
};

type FuzzyRow = {
  page_id: string;
  page_number: number;
  snippet: string | null;
  similarity_pct: number | string;
};

type RpcError = {
  message?: string;
};

const DEFAULT_MIN_PCT = 60;
const DEFAULT_LIMIT = 20;

function parseBoundedInt(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const rounded = Math.round(value);
  return Math.min(max, Math.max(min, rounded));
}

function toSearchHit(row: FuzzyRow, index: number): SearchHit {
  const similarity = Number(row.similarity_pct);
  const similarityLabel = Number.isFinite(similarity) ? `${similarity.toFixed(1)}% Match` : "Fuzzy Match";

  return {
    id: `${row.page_id}-${index}`,
    pageNumber: row.page_number,
    itemIndex: 0,
    snippet: row.snippet ?? "",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    quality: similarityLabel,
    location: {
      section: `Page ${row.page_number}`,
      part: "Fuzzy Search",
      clause: `Page ${row.page_number}`,
    },
  };
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 },
    );
  }

  let body: SearchRequestBody;
  try {
    body = (await request.json()) as SearchRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
  const minPct = parseBoundedInt(body.minPct, DEFAULT_MIN_PCT, 0, 100);
  const limit = parseBoundedInt(body.limit, DEFAULT_LIMIT, 1, 100);

  if (!query) {
    return NextResponse.json({ error: "Query is required." }, { status: 400 });
  }
  if (!sourceId) {
    return NextResponse.json({ error: "sourceId is required." }, { status: 400 });
  }

  const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/search_document_pages_fuzzy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      p_source_slug: sourceId,
      p_query: query,
      p_min_pct: minPct,
      p_limit: limit,
    }),
  });

  if (!rpcResponse.ok) {
    let details = "";
    try {
      const rpcError = (await rpcResponse.json()) as RpcError;
      details = rpcError.message ?? "";
    } catch {
      details = await rpcResponse.text();
    }

    return NextResponse.json(
      { error: "Supabase RPC call failed.", details: details.slice(0, 400) },
      { status: 502 },
    );
  }

  const rows = (await rpcResponse.json()) as FuzzyRow[];
  const hits = rows.map(toSearchHit);

  return NextResponse.json({ hits });
}
