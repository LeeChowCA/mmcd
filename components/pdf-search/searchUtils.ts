import type { TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";
import type { HitLocation, IndexedTextItem, SearchHit } from "./types";

export const BASE_RENDER_SCALE = 1.15;
export const MIN_ZOOM = 70;
export const MAX_ZOOM = 180;
export const ZOOM_STEP = 10;

export function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return "str" in item;
}

function buildSnippet(text: string, start: number, length: number) {
  const margin = 32;
  const left = Math.max(0, start - margin);
  const right = Math.min(text.length, start + length + margin);
  const prefix = left > 0 ? "..." : "";
  const suffix = right < text.length ? "..." : "";
  return `${prefix}${text.slice(left, right)}${suffix}`;
}

function normalizeForTokenSearch(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212-]+/g, " ");
}

function tokenizeForSearch(value: string) {
  return normalizeForTokenSearch(value).match(/[a-z0-9]+(?:\.[a-z0-9]+)*/g) ?? [];
}

function buildContextSnippet(items: IndexedTextItem[], startIndex: number, endIndex: number) {
  const from = Math.max(0, startIndex - 1);
  const to = Math.min(items.length - 1, endIndex + 1);
  return items
    .slice(from, to + 1)
    .map((item) => item.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildTopLines(items: IndexedTextItem[]) {
  if (items.length === 0) {
    return [];
  }

  const maxY = items.reduce((currentMax, item) => Math.max(currentMax, item.y), Number.NEGATIVE_INFINITY);
  const headerBandMinY = maxY - 46;
  const sorted = items
    .filter((item) => item.y >= headerBandMinY)
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<{ y: number; items: IndexedTextItem[] }> = [];

  for (const item of sorted) {
    const line = lines.find((entry) => Math.abs(entry.y - item.y) <= 2.5);
    if (line) {
      line.items.push(item);
      continue;
    }
    lines.push({ y: item.y, items: [item] });
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .slice(0, 8)
    .map((line) =>
      line.items
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

function cleanExtractedTitle(value: string) {
  const cleaned = value
    .replace(/\bCITY OF SURREY\b/gi, " ")
    .replace(/\bENGINEERING DEPARTMENT\b/gi, " ")
    .replace(/\bMMCD\s+SECTION\s+[0-9A-Za-z.\s-]+/gi, " ")
    .replace(/\bMMCD\s+(?:SGC|SS|SMMCD|VMMCD)\b/gi, " ")
    .replace(/\b(?:SS|SGC)\s*PAGE\s+[A-Za-z0-9.-]+\b/gi, " ")
    .replace(/\bPAGE\s+[A-Za-z0-9.-]+\b/gi, " ")
    .replace(/\b20\s*2\s*4\b/gi, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\s*-\s*/g, "-")
    .replace(/^[\s\-|,;:]+|[\s\-|,;:]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}

export function extractPrintedPageLabel(items: IndexedTextItem[]) {
  const joined = items
    .map((item) => item.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!joined) {
    return null;
  }

  const match = joined.match(/\b((?:[A-Z]{1,4}\s+)?PAGE\s+[A-Z0-9.-]+)\b/i);
  return match ? match[1].toUpperCase() : null;
}

export function extractSectionTitle(items: IndexedTextItem[]) {
  const topLines = buildTopLines(items);

  for (const line of topLines) {
    if (!/TABLE OF CONTENTS/i.test(line)) {
      continue;
    }

    const cleanedTocTitle = cleanExtractedTitle(line);
    if (cleanedTocTitle) {
      return cleanedTocTitle;
    }
  }

  const candidates = topLines.filter((line) => {
    const cleanedLine = cleanExtractedTitle(line);
    if (!cleanedLine || cleanedLine.length < 10) {
      return false;
    }
    if (/^(?:MMCD|SECTION|PAGE)\b/i.test(cleanedLine)) {
      return false;
    }
    const alphaOnly = cleanedLine.replace(/[^A-Za-z]/g, "");
    if (alphaOnly.length < 6) {
      return false;
    }
    const uppercaseCount = alphaOnly.replace(/[^A-Z]/g, "").length;
    return uppercaseCount / alphaOnly.length >= 0.55;
  });

  if (candidates.length === 0) {
    return null;
  }

  const bestRawLine = candidates.sort((a, b) => b.length - a.length)[0];
  return cleanExtractedTitle(bestRawLine);
}

function deriveHitLocation(
  pageItems: IndexedTextItem[],
  itemIndex: number,
  pageNumber: number,
): HitLocation {
  let section = `Page ${pageNumber}`;
  let part = "Part -";
  let clause = `Match ${itemIndex + 1}`;

  for (let i = itemIndex; i >= 0 && i >= itemIndex - 40; i -= 1) {
    const text = pageItems[i]?.text.trim();
    if (!text) {
      continue;
    }

    if (section.startsWith("Page") && /^Section\s+/i.test(text)) {
      section = text;
    }

    if (part === "Part -" && /^Part\s+[0-9A-Za-z.\-]+/i.test(text)) {
      part = text;
    }

    if (clause.startsWith("Match") && /^[0-9]+(?:\.[0-9]+)+/.test(text)) {
      clause = text.split(/\s+/).slice(0, 2).join(" ");
    }

    if (!section.startsWith("Page") && part !== "Part -" && !clause.startsWith("Match")) {
      break;
    }
  }

  return { section, part, clause };
}

export function findExactSearchHits(query: string, pageIndex: Map<number, IndexedTextItem[]>) {
  const term = query.trim().toLowerCase();
  if (!term) {
    return [];
  }

  const hits: SearchHit[] = [];

  for (const [pageNumber, items] of pageIndex.entries()) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const lowerText = item.text.toLowerCase();
      let start = 0;

      while (start < lowerText.length) {
        const hitIndex = lowerText.indexOf(term, start);
        if (hitIndex === -1) {
          break;
        }

        let matchLength = term.length;
        const trailingText = item.text.slice(hitIndex + term.length);
        const trailingTokenMatch = trailingText.match(/^[A-Za-z0-9]+/);
        if (trailingTokenMatch && trailingTokenMatch[0]) {
          matchLength += trailingTokenMatch[0].length;
        }

        const safeLength = Math.max(item.text.length, 1);
        const xOffset = (item.width * hitIndex) / safeLength;
        const hitWidth = Math.max((item.width * matchLength) / safeLength, 3);
        const location = deriveHitLocation(items, i, pageNumber);

        hits.push({
          id: `${pageNumber}-${item.itemIndex}-${hitIndex}`,
          pageNumber,
          itemIndex: item.itemIndex,
          snippet: buildSnippet(item.text, hitIndex, matchLength),
          x: item.x + xOffset,
          y: item.y,
          width: hitWidth,
          height: item.height,
          location,
          quality: "High Match",
        });

        start = hitIndex + term.length;
      }
    }
  }

  if (hits.length > 0) {
    return hits;
  }

  const queryTokens = tokenizeForSearch(query);
  if (queryTokens.length === 0) {
    return hits;
  }
  const firstQueryToken = queryTokens[0];
  if (!firstQueryToken) {
    return hits;
  }

  for (const [pageNumber, items] of pageIndex.entries()) {
    const flattenedTokens: Array<{
      token: string;
      pageItemIndex: number;
    }> = [];

    for (let i = 0; i < items.length; i += 1) {
      const normalizedItem = normalizeForTokenSearch(items[i].text);
      const tokenRegex = /[a-z0-9]+(?:\.[a-z0-9]+)*/g;
      let tokenMatch = tokenRegex.exec(normalizedItem);

      while (tokenMatch) {
        flattenedTokens.push({
          token: tokenMatch[0],
          pageItemIndex: i,
        });
        tokenMatch = tokenRegex.exec(normalizedItem);
      }
    }

    for (let i = 0; i <= flattenedTokens.length - queryTokens.length; i += 1) {
      let matches = true;
      for (let j = 0; j < queryTokens.length; j += 1) {
        const queryToken = queryTokens[j];
        const candidateToken = flattenedTokens[i + j].token;
        const isLastQueryToken = j === queryTokens.length - 1;
        const isMatch =
          candidateToken === queryToken ||
          (isLastQueryToken && queryToken.length >= 2 && candidateToken.startsWith(queryToken));

        if (!isMatch) {
          matches = false;
          break;
        }
      }

      if (!matches) {
        continue;
      }

      const first = flattenedTokens[i];
      const last = flattenedTokens[i + queryTokens.length - 1];
      const firstItem = items[first.pageItemIndex];
      if (!firstItem) {
        continue;
      }

      const safeLength = Math.max(firstItem.text.length, 1);
      const hitWidth = Math.max((firstItem.width * firstQueryToken.length) / safeLength, 3);

      hits.push({
        id: `${pageNumber}-${firstItem.itemIndex}-tokens-${i}`,
        pageNumber,
        itemIndex: firstItem.itemIndex,
        snippet: buildContextSnippet(items, first.pageItemIndex, last.pageItemIndex),
        x: firstItem.x,
        y: firstItem.y,
        width: hitWidth,
        height: firstItem.height,
        location: deriveHitLocation(items, first.pageItemIndex, pageNumber),
        quality: "High Match",
      });
    }
  }

  return hits;
}
