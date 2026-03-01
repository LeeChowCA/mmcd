import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { buildSourcesFromFilenames } from "@/lib/documentSources";

export async function GET() {
  const publicDir = join(process.cwd(), "public");

  try {
    const entries = await readdir(publicDir, { withFileTypes: true });
    const fileNames = entries
      .filter((entry) => entry.isFile() && /\.pdf$/i.test(entry.name))
      .map((entry) => entry.name);

    return NextResponse.json({ sources: buildSourcesFromFilenames(fileNames) });
  } catch {
    return NextResponse.json({ sources: [] });
  }
}
