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

function normalizeSnippetWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
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

function levenshteinDistance(a: string, b: string) {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }

  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j < cols; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function tokenSimilarity(a: string, b: string) {
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }

  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  const prefixLen = (() => {
    let count = 0;
    while (count < minLen && a[count] === b[count]) {
      count += 1;
    }
    return count;
  })();
  const prefixScore = prefixLen / maxLen;

  const distance = levenshteinDistance(a, b);
  const editScore = 1 - distance / maxLen;
  return Math.max(editScore, prefixScore);
}

function buildContextSnippet(items: IndexedTextItem[], startIndex: number, endIndex: number) {
  const from = Math.max(0, startIndex - 1);
  const to = Math.min(items.length - 1, endIndex + 1);
  return normalizeSnippetWhitespace(
    items
      .slice(from, to + 1)
      .map((item) => item.text)
      .join(" "),
  );
}

function buildItemRangeBounds(items: IndexedTextItem[], startIndex: number, endIndex: number) {
  const range = items.slice(startIndex, endIndex + 1).filter(Boolean);
  if (range.length === 0) {
    return null;
  }

  const minX = range.reduce((value, item) => Math.min(value, item.x), Number.POSITIVE_INFINITY);
  const minY = range.reduce((value, item) => Math.min(value, item.y), Number.POSITIVE_INFINITY);
  const maxX = range.reduce((value, item) => Math.max(value, item.x + item.width), Number.NEGATIVE_INFINITY);
  const maxY = range.reduce(
    (value, item) => Math.max(value, item.y + item.height),
    Number.NEGATIVE_INFINITY,
  );

  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, 3),
    height: Math.max(maxY - minY, 12),
  };
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

function areItemsLikelyContinuousToken(previous: IndexedTextItem, current: IndexedTextItem) {
  const height = Math.max(previous.height, current.height, 1);
  const sameLine = Math.abs(previous.y - current.y) <= height * 0.6;
  if (!sameLine) {
    return false;
  }

  const previousRight = previous.x + previous.width;
  const gap = current.x - previousRight;

  // Allow tiny overlap/kerning and small positive gaps for split glyph runs.
  return gap >= -height * 0.8 && gap <= height * 1.2;
}

function areItemsLikelyAdjacentText(previous: IndexedTextItem, current: IndexedTextItem) {
  const height = Math.max(previous.height, current.height, 1);
  const verticalDelta = previous.y - current.y;
  const sameLine = Math.abs(previous.y - current.y) <= height * 0.7;

  if (sameLine) {
    const previousRight = previous.x + previous.width;
    const gap = current.x - previousRight;

    // Allow normal word spacing and table-column jumps on the same visual row.
    return gap >= -height * 1.2 && gap <= height * 22;
  }

  const nextLine = verticalDelta >= height * 0.6 && verticalDelta <= height * 2.5;
  if (!nextLine) {
    return false;
  }

  // Keep matches within the same text block instead of jumping between header and body.
  return Math.abs(current.x - previous.x) <= Math.max(previous.width, current.width, height * 18);
}

type ScoredSnippet = {
  score: number;
  snippet: string;
};

function scoreSnippetCandidate(text: string, queryLower: string, queryTokens: string[]): ScoredSnippet | null {
  const normalizedText = normalizeSnippetWhitespace(text);
  if (!normalizedText) {
    return null;
  }

  const lowerText = normalizedText.toLowerCase();
  const phraseIndex = queryLower ? lowerText.indexOf(queryLower) : -1;
  if (phraseIndex >= 0) {
    return {
      score: 10_000 + queryLower.length,
      snippet: buildSnippet(normalizedText, phraseIndex, queryLower.length),
    };
  }

  let tokenScore = 0;
  let firstHitIndex = Number.POSITIVE_INFINITY;
  let firstHitLength = 0;

  for (const token of queryTokens) {
    if (token.length < 2) {
      continue;
    }

    const tokenIndex = lowerText.indexOf(token);
    if (tokenIndex === -1) {
      continue;
    }

    tokenScore += Math.min(token.length, 16);

    if (tokenIndex < firstHitIndex) {
      firstHitIndex = tokenIndex;
      firstHitLength = token.length;
    }
  }

  if (tokenScore === 0 || !Number.isFinite(firstHitIndex)) {
    return null;
  }

  return {
    score: tokenScore,
    snippet: buildSnippet(normalizedText, firstHitIndex, Math.max(firstHitLength, 2)),
  };
}

export function buildNaturalSnippetForPage(
  query: string,
  items: IndexedTextItem[],
  fallbackSnippet: string,
) {
  const queryLower = query.trim().toLowerCase();
  const queryTokens = tokenizeForSearch(query);
  if (!queryLower && queryTokens.length === 0) {
    return normalizeSnippetWhitespace(fallbackSnippet);
  }

  let best: ScoredSnippet | null = null;

  for (let i = 0; i < items.length; i += 1) {
    const current = items[i];
    const oneItem = scoreSnippetCandidate(current.text, queryLower, queryTokens);
    if (oneItem && (!best || oneItem.score > best.score)) {
      best = oneItem;
    }

    const next = items[i + 1];
    if (!next) {
      continue;
    }

    // Catch split text runs (e.g. table cells or line wraps).
    const twoItems = scoreSnippetCandidate(`${current.text} ${next.text}`, queryLower, queryTokens);
    if (twoItems && (!best || twoItems.score > best.score)) {
      best = twoItems;
    }
  }

  if (best) {
    return best.snippet;
  }

  const cleanedFallback = normalizeSnippetWhitespace(fallbackSnippet);
  if (cleanedFallback.length <= 180) {
    return cleanedFallback;
  }

  return `${cleanedFallback.slice(0, 177).trimEnd()}...`;
}

type TokenSpan = {
  value: string;
  start: number;
  end: number;
};

function getTokenSpans(text: string): TokenSpan[] {
  const spans: TokenSpan[] = [];
  const regex = /[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*/g;
  let match = regex.exec(text);

  while (match) {
    const token = match[0];
    const start = match.index ?? 0;
    spans.push({
      value: token.toLowerCase(),
      start,
      end: start + token.length,
    });
    match = regex.exec(text);
  }

  return spans;
}

export function findNaturalAnchorsForPage(
  query: string,
  items: IndexedTextItem[],
  pageNumber: number,
  limit = 8,
) {
  const queryTokens = tokenizeForSearch(query).filter((token) => token.length >= 2);
  if (queryTokens.length === 0 || items.length === 0) {
    return [] as SearchHit[];
  }

  const minScore = 0.62;
  const candidates: Array<{ score: number; hit: SearchHit }> = [];

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const spans = getTokenSpans(item.text);
    if (spans.length === 0) {
      continue;
    }

    let bestScore = 0;
    let bestStartToken = -1;
    let bestLength = 0;

    if (queryTokens.length === 1) {
      const target = queryTokens[0];
      for (let tokenIndex = 0; tokenIndex < spans.length; tokenIndex += 1) {
        const score = tokenSimilarity(target, spans[tokenIndex].value);
        if (score > bestScore) {
          bestScore = score;
          bestStartToken = tokenIndex;
          bestLength = 1;
        }
      }
    } else {
      for (let tokenIndex = 0; tokenIndex <= spans.length - queryTokens.length; tokenIndex += 1) {
        let total = 0;
        for (let j = 0; j < queryTokens.length; j += 1) {
          total += tokenSimilarity(queryTokens[j], spans[tokenIndex + j].value);
        }
        const score = total / queryTokens.length;
        if (score > bestScore) {
          bestScore = score;
          bestStartToken = tokenIndex;
          bestLength = queryTokens.length;
        }
      }
    }

    if (bestScore < minScore || bestStartToken < 0 || bestLength <= 0) {
      continue;
    }

    const firstSpan = spans[bestStartToken];
    const lastSpan = spans[bestStartToken + bestLength - 1];
    if (!firstSpan || !lastSpan) {
      continue;
    }

    const charStart = firstSpan.start;
    const charEnd = lastSpan.end;
    const safeLength = Math.max(item.text.length, 1);
    const xOffset = (item.width * charStart) / safeLength;
    const hitWidth = Math.max((item.width * (charEnd - charStart)) / safeLength, 8);

    candidates.push({
      score: bestScore,
      hit: {
        id: `${pageNumber}-${item.itemIndex}-natural-${bestStartToken}`,
        pageNumber,
        itemIndex: item.itemIndex,
        snippet: buildSnippet(item.text, charStart, Math.max(charEnd - charStart, 2)),
        x: item.x + xOffset,
        y: item.y,
        width: hitWidth,
        height: item.height,
        quality: `${(bestScore * 100).toFixed(1)}% Match`,
        location: deriveHitLocation(items, i, pageNumber),
      },
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.hit.itemIndex - b.hit.itemIndex)
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.hit);
}

export function findExactSearchHits(query: string, pageIndex: Map<number, IndexedTextItem[]>) {
  const term = query.trim().toLowerCase();
  if (!term) {
    return [];
  }

  const hits: SearchHit[] = [];
  const queryTokens = tokenizeForSearch(query);
  const firstQueryToken = queryTokens[0];

  for (const [pageNumber, items] of pageIndex.entries()) {
    const pageHitsBefore = hits.length;

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

    const pageHasDirectHits = hits.length > pageHitsBefore;
    if (pageHasDirectHits || queryTokens.length === 0 || !firstQueryToken) {
      continue;
    }

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

    if (queryTokens.length === 1) {
      const target = queryTokens[0];
      for (let i = 0; i < flattenedTokens.length; i += 1) {
        let combined = "";
        let lastTokenOffset = i;

        for (
          let offset = i;
          offset < flattenedTokens.length && offset - i < 3;
          offset += 1, lastTokenOffset = offset
        ) {
          const current = flattenedTokens[offset];
          if (offset > i) {
            const previous = flattenedTokens[offset - 1];
            const previousItem = items[previous.pageItemIndex];
            const currentItem = items[current.pageItemIndex];
            if (!previousItem || !currentItem || !areItemsLikelyContinuousToken(previousItem, currentItem)) {
              break;
            }
          }

          combined += current.token;

          const isMatch = combined === target || (target.length >= 2 && combined.startsWith(target));
          if (!isMatch) {
            if (combined.length > target.length + 4) {
              break;
            }
            continue;
          }

          const first = flattenedTokens[i];
          const last = flattenedTokens[lastTokenOffset];
          const firstItem = items[first.pageItemIndex];
          const lastItem = items[last.pageItemIndex];
          if (!firstItem || !lastItem) {
            break;
          }

          const spanningWidth = Math.max(lastItem.x + lastItem.width - firstItem.x, firstItem.width, 3);

          hits.push({
            id: `${pageNumber}-${firstItem.itemIndex}-tokens-${i}-${lastTokenOffset}`,
            pageNumber,
            itemIndex: firstItem.itemIndex,
            snippet: buildContextSnippet(items, first.pageItemIndex, last.pageItemIndex),
            x: firstItem.x,
            y: firstItem.y,
            width: spanningWidth,
            height: Math.max(firstItem.height, lastItem.height),
            location: deriveHitLocation(items, first.pageItemIndex, pageNumber),
            quality: "High Match",
          });

          break;
        }
      }
      continue;
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

        if (j === 0) {
          continue;
        }

        const previous = flattenedTokens[i + j - 1];
        const current = flattenedTokens[i + j];
        if (previous.pageItemIndex === current.pageItemIndex) {
          continue;
        }

        const previousItem = items[previous.pageItemIndex];
        const currentItem = items[current.pageItemIndex];
        if (!previousItem || !currentItem || !areItemsLikelyAdjacentText(previousItem, currentItem)) {
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
      const bounds = buildItemRangeBounds(items, first.pageItemIndex, last.pageItemIndex);
      if (!firstItem || !bounds) {
        continue;
      }

      hits.push({
        id: `${pageNumber}-${firstItem.itemIndex}-tokens-${i}`,
        pageNumber,
        itemIndex: firstItem.itemIndex,
        snippet: buildContextSnippet(items, first.pageItemIndex, last.pageItemIndex),
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        location: deriveHitLocation(items, first.pageItemIndex, pageNumber),
        quality: "High Match",
      });
    }
  }

  return hits;
}
