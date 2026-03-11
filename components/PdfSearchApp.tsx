"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import type { DocumentSource } from "@/lib/documentSources";
import { PdfSearchResultsPane } from "./pdf-search/PdfSearchResultsPane";
import { PdfSearchTopBar } from "./pdf-search/PdfSearchTopBar";
import { PdfSearchViewerPane } from "./pdf-search/PdfSearchViewerPane";
import { RagAgentWidget } from "./RagAgentWidget";
import {
  BASE_RENDER_SCALE,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  buildNaturalSnippetForPage,
  extractPrintedPageLabel,
  extractSectionTitle,
  findExactSearchHits,
  findNaturalAnchorsForPage,
  isTextItem,
} from "./pdf-search/searchUtils";
import type { IndexedTextItem, SearchHit, SearchMode } from "./pdf-search/types";
import type { Citation } from "./rag-agent/types";

const NATURAL_SEARCH_MIN_PCT = 60;
const NATURAL_SEARCH_LIMIT = 20;

type FuzzySearchPayload = {
  hits?: SearchHit[];
};

function normalizeCitationQuery(value?: string) {
  if (!value) {
    return "";
  }

  return value.replace(/^\.{3}|\.\.\.$/g, "").replace(/\s+/g, " ").trim();
}

function tokenizeCitationText(value?: string) {
  return normalizeCitationQuery(value)
    .toLowerCase()
    .match(/[a-z0-9]+(?:\.[a-z0-9]+)*/g) ?? [];
}

function normalizeCitationOcrArtifacts(value: string) {
  return value
    .replace(/\bC\s*ITY\b/gi, "CITY")
    .replace(/\bE\s*NGINEERING\b/gi, "ENGINEERING")
    .replace(/\bS\s*UPPLEMENTARY\b/gi, "SUPPLEMENTARY")
    .replace(/\bS\s*TART\b/gi, "START")
    .replace(/\bC\s*OMMISSIONING\b/gi, "COMMISSIONING")
    .replace(/\bS\s*S\s+P\s*AGE\b/gi, "SS PAGE")
    .replace(/\bMM\s*CD\b/gi, "MMCD");
}

function stripCitationBoilerplate(value: string) {
  return normalizeCitationOcrArtifacts(value)
    .replace(/\bcity of surrey\b/gi, " ")
    .replace(/\bengineering department\b/gi, " ")
    .replace(/\blist of approved materials and products\b/gi, " ")
    .replace(/\bstart-up,\s*testing\s*and\s*commissioning\b/gi, " ")
    .replace(/\bmmcd section\s+[0-9a-z.\s-]+\b/gi, " ")
    .replace(/\bss page\s+[0-9a-z.-]+\b/gi, " ")
    .replace(/\bsupplementary specifications(?:\s+20\d{2})?\b/gi, " ")
    .replace(/\bmmcd section\b/gi, " ")
    .replace(/\bapproved material\s*\/\s*type\b/gi, " ")
    .replace(/\bapproved product\s*\/\s*manufacturer\b/gi, " ")
    .replace(/\brestrictions\s*\/\s*additional specifications\b/gi, " ")
    .replace(/\bproduct\b/gi, " ")
    .replace(/\b2024\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCitationSignalText(value?: string) {
  return stripCitationBoilerplate(normalizeCitationQuery(value));
}

function isMeaningfulCitationSegment(value: string) {
  const tokens = tokenizeCitationText(value);
  if (tokens.length < 5) {
    return false;
  }

  const alphaChars = value.replace(/[^A-Za-z]/g, "");
  if (alphaChars.length < 16) {
    return false;
  }

  const uppercaseRatio =
    alphaChars.length > 0 ? alphaChars.replace(/[^A-Z]/g, "").length / alphaChars.length : 0;
  return uppercaseRatio < 0.8;
}

function pickCitationSegment(value: string) {
  const segments = value
    .split(/(?:\.\.\.+|\u2026|(?<=[.!?])\s+)/)
    .map((segment) => segment.trim())
    .filter(isMeaningfulCitationSegment)
    .sort((a, b) => b.length - a.length);

  if (segments.length > 0) {
    return segments[0];
  }

  const tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length <= 14) {
    return value;
  }

  return tokens.slice(0, 18).join(" ");
}

function buildCitationMatchedTextQuery(citation: Citation) {
  const matchedText = cleanCitationSignalText(citation.matchedText);
  if (!matchedText) {
    return "";
  }

  return pickCitationSegment(matchedText);
}

function buildCitationExcerptQuery(citation: Citation) {
  const excerpt = cleanCitationSignalText(citation.excerpt);
  if (!excerpt) {
    return "";
  }

  const matchedText = cleanCitationSignalText(citation.matchedText);
  if (matchedText) {
    const lowerExcerpt = excerpt.toLowerCase();
    const lowerMatch = matchedText.toLowerCase();
    const matchIndex = lowerExcerpt.indexOf(lowerMatch);
    if (matchIndex >= 0) {
      const from = Math.max(0, matchIndex - 48);
      const to = Math.min(excerpt.length, matchIndex + matchedText.length + 48);
      return excerpt.slice(from, to).replace(/^\.{3}|\.\.\.$/g, "").trim();
    }
  }

  return pickCitationSegment(excerpt);
}

type CitationQueryCandidate = {
  text: string;
  allowFuzzy: boolean;
};

type CitationLine = {
  items: IndexedTextItem[];
  y: number;
  text: string;
  cleanText: string;
};

const CITATION_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "these",
  "those",
  "shall",
  "must",
  "where",
  "into",
  "they",
  "them",
  "their",
  "are",
  "was",
  "were",
  "been",
  "being",
  "have",
  "has",
  "had",
  "will",
  "would",
  "should",
  "could",
  "all",
  "any",
  "can",
  "not",
  "but",
  "before",
  "after",
  "during",
  "under",
  "include",
  "including",
  "therefore",
  "through",
]);

function buildCitationQueryCandidates(citation: Citation): CitationQueryCandidate[] {
  const rawCandidates: CitationQueryCandidate[] = [
    { text: buildCitationMatchedTextQuery(citation), allowFuzzy: true },
    { text: buildCitationExcerptQuery(citation), allowFuzzy: true },
    { text: normalizeCitationQuery(citation.label), allowFuzzy: false },
  ];

  const seen = new Set<string>();
  const candidates: CitationQueryCandidate[] = [];

  for (const candidate of rawCandidates) {
    if (!candidate.text || seen.has(candidate.text)) {
      continue;
    }
    seen.add(candidate.text);
    candidates.push(candidate);
  }

  return candidates;
}

function groupCitationLines(pageItems: IndexedTextItem[]) {
  const sorted = [...pageItems].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: CitationLine[] = [];

  for (const item of sorted) {
    const line = lines.find(
      (entry) => Math.abs(entry.y - item.y) <= Math.max(3, Math.max(entry.items[0]?.height ?? 0, item.height) * 0.65),
    );

    if (line) {
      line.items.push(item);
      continue;
    }

    lines.push({
      items: [item],
      y: item.y,
      text: "",
      cleanText: "",
    });
  }

  return lines
    .map((line) => {
      const orderedItems = [...line.items].sort((a, b) => a.x - b.x);
      const text = orderedItems
        .map((item) => item.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      return {
        items: orderedItems,
        y: line.y,
        text,
        cleanText: cleanCitationSignalText(text),
      };
    })
    .filter((line) => line.text.length > 0);
}

function buildCitationTokenSet(value: string) {
  return new Set(
    tokenizeCitationText(value).filter((token) => token.length >= 4 && !CITATION_STOPWORDS.has(token)),
  );
}

function scoreCitationWindow(windowText: string, candidateText: string) {
  const cleanWindow = cleanCitationSignalText(windowText).toLowerCase();
  const cleanCandidate = cleanCitationSignalText(candidateText).toLowerCase();
  if (!cleanWindow || !cleanCandidate) {
    return 0;
  }

  const windowTokens = buildCitationTokenSet(cleanWindow);
  const candidateTokens = [...buildCitationTokenSet(cleanCandidate)];
  if (candidateTokens.length === 0) {
    return 0;
  }

  let score = 0;
  for (const token of candidateTokens) {
    if (windowTokens.has(token)) {
      score += token.length >= 8 ? 14 : 10;
    }
  }

  if (cleanWindow.includes(cleanCandidate)) {
    score += 120;
  }

  for (let index = 0; index < candidateTokens.length - 1; index += 1) {
    const bigram = `${candidateTokens[index]} ${candidateTokens[index + 1]}`;
    if (cleanWindow.includes(bigram)) {
      score += 18;
    }
  }

  return score;
}

function buildCitationWindowHit(citation: Citation, pageItems: IndexedTextItem[]) {
  const pageNumber = citation.page;
  if (typeof pageNumber !== "number" || pageItems.length === 0) {
    return null;
  }

  const candidateTexts = buildCitationQueryCandidates(citation)
    .filter((candidate) => candidate.allowFuzzy)
    .map((candidate) => candidate.text)
    .filter(Boolean);

  if (candidateTexts.length === 0) {
    return null;
  }

  const pageTopY = pageItems.reduce((maxY, item) => Math.max(maxY, item.y), Number.NEGATIVE_INFINITY);
  const headerCutoffY = pageTopY - 48;
  const lines = groupCitationLines(pageItems).filter((line) => line.y < headerCutoffY);

  let best:
    | {
        score: number;
        items: IndexedTextItem[];
        snippet: string;
      }
    | null = null;

  for (let start = 0; start < lines.length; start += 1) {
    for (let end = start; end < Math.min(lines.length, start + 5); end += 1) {
      const windowItems = lines.slice(start, end + 1).flatMap((line) => line.items);
      const windowText = lines
        .slice(start, end + 1)
        .map((line) => line.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      let score = 0;
      for (const candidateText of candidateTexts) {
        score = Math.max(score, scoreCitationWindow(windowText, candidateText));
      }

      if (score <= 0) {
        continue;
      }

      if (!best || score > best.score) {
        best = {
          score,
          items: windowItems,
          snippet: windowText,
        };
      }
    }
  }

  if (!best) {
    return null;
  }

  const minX = best.items.reduce((value, item) => Math.min(value, item.x), Number.POSITIVE_INFINITY);
  const maxX = best.items.reduce((value, item) => Math.max(value, item.x + item.width), Number.NEGATIVE_INFINITY);
  const minY = best.items.reduce((value, item) => Math.min(value, item.y), Number.POSITIVE_INFINITY);
  const maxY = best.items.reduce((value, item) => Math.max(value, item.y + item.height), Number.NEGATIVE_INFINITY);
  const firstItem = best.items[0];

  if (!firstItem) {
    return null;
  }

  return {
    id: `citation-${citation.id}-${pageNumber}-window`,
    pageNumber,
    itemIndex: firstItem.itemIndex,
    snippet: best.snippet,
    x: Math.max(0, minX - 6),
    y: Math.max(0, minY - 3),
    width: Math.max(maxX - minX + 12, 24),
    height: Math.max(maxY - minY + 6, 18),
    quality: "Citation",
    location: {
      section: `Page ${pageNumber}`,
      part: "Citation",
      clause: `Page ${pageNumber}`,
    },
  };
}

function buildCitationHit(citation: Citation, pageItems: IndexedTextItem[]): SearchHit | null {
  if (typeof citation.page !== "number" || pageItems.length === 0) {
    return null;
  }

  const pageNumber = citation.page;
  const roughHit = buildCitationWindowHit(citation, pageItems);
  if (roughHit) {
    return roughHit;
  }

  const pageTopY = pageItems.reduce((maxY, item) => Math.max(maxY, item.y), Number.NEGATIVE_INFINITY);
  const fallbackItem =
    pageItems.find((item) => item.text.trim() && item.y < pageTopY - 48) ??
    pageItems.find((item) => item.text.trim());
  if (!fallbackItem) {
    return null;
  }

  return {
    id: `citation-${citation.id}-${pageNumber}-fallback`,
    pageNumber,
    itemIndex: fallbackItem.itemIndex,
    snippet: citation.excerpt ?? fallbackItem.text,
    x: fallbackItem.x,
    y: fallbackItem.y,
    width: fallbackItem.width,
    height: fallbackItem.height,
    quality: "Citation",
    location: {
      section: `Page ${pageNumber}`,
      part: "Citation",
      clause: `Page ${pageNumber}`,
    },
  };
}

export function PdfSearchApp() {
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("exact");
  const [sources, setSources] = useState<DocumentSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [loadingSources, setLoadingSources] = useState(true);

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageIndex, setPageIndex] = useState<Map<number, IndexedTextItem[]>>(new Map());
  const [indexing, setIndexing] = useState(false);

  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [activeHitId, setActiveHitId] = useState<string | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [searchingFuzzy, setSearchingFuzzy] = useState(false);
  const [printedPageLabels, setPrintedPageLabels] = useState<Map<number, string>>(new Map());
  const [sectionTitlesByPage, setSectionTitlesByPage] = useState<Map<number, string>>(new Map());
  const [citationFocus, setCitationFocus] = useState<Citation | null>(null);

  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [zoomPercent, setZoomPercent] = useState(100);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const activePdfRef = useRef<PDFDocumentProxy | null>(null);

  const activeSource = useMemo(
    () => sources.find((source) => source.id === sourceId) ?? null,
    [sourceId, sources],
  );
  const activeSourceLabel = activeSource?.label ?? "No source";

  const activeHit = useMemo(
    () => searchHits.find((hit) => hit.id === activeHitId) ?? null,
    [activeHitId, searchHits],
  );

  const currentPageHits = useMemo(
    () =>
      searchHits.filter(
        (hit) => hit.pageNumber === currentPage && hit.width > 1 && hit.height > 1,
      ),
    [currentPage, searchHits],
  );

  const renderScale = BASE_RENDER_SCALE;
  const zoomScale = zoomPercent / 100;

  const citationHit = useMemo(() => {
    if (!citationFocus || !activeSource || typeof citationFocus.page !== "number") {
      return null;
    }

    if (citationFocus.sourceId && activeSource.id !== citationFocus.sourceId) {
      return null;
    }

    return buildCitationHit(citationFocus, pageIndex.get(citationFocus.page) ?? []);
  }, [activeSource, citationFocus, pageIndex]);

  const viewerHits = useMemo(() => {
    if (!citationHit || citationHit.pageNumber !== currentPage) {
      return currentPageHits;
    }

    return [citationHit, ...currentPageHits.filter((hit) => hit.id !== citationHit.id)];
  }, [citationHit, currentPage, currentPageHits]);

  const viewerActiveHitId = citationHit?.id ?? activeHitId;
  const viewerActiveHit = citationHit ?? activeHit;
  const viewerActiveHitPrintedPageLabel = useMemo(
    () =>
      viewerActiveHit ? printedPageLabels.get(viewerActiveHit.pageNumber) ?? null : null,
    [printedPageLabels, viewerActiveHit],
  );
  const viewerSearchMessage = useMemo(() => {
    if (!citationFocus) {
      return searchMessage;
    }

    const label = citationFocus.label ?? citationFocus.sourceFile ?? activeSource?.label ?? "document";
    if (typeof citationFocus.page === "number") {
      return `Viewing citation in ${label}, page ${citationFocus.page}.`;
    }
    return `Viewing citation in ${label}.`;
  }, [activeSource?.label, citationFocus, searchMessage]);

  useEffect(() => {
    let cancelled = false;

    async function loadSources() {
      setLoadingSources(true);

      try {
        const response = await fetch("/api/sources", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Unable to load PDF sources");
        }

        const payload = (await response.json()) as { sources?: DocumentSource[] };
        const loadedSources = Array.isArray(payload.sources) ? payload.sources : [];

        if (!cancelled) {
          setSources(loadedSources);
          setSourceError(null);
          setSourceId((current) =>
            loadedSources.some((source) => source.id === current)
              ? current
              : (loadedSources[0]?.id ?? ""),
          );
        }
      } catch {
        if (!cancelled) {
          setSources([]);
          setSourceId("");
          setSourceError("Unable to read PDF sources from the public folder.");
        }
      } finally {
        if (!cancelled) {
          setLoadingSources(false);
        }
      }
    }

    void loadSources();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadedDoc: PDFDocumentProxy | null = null;

    async function loadSource() {
      if (!activeSource) {
        setPdfDoc(null);
        setPageCount(0);
        setCurrentPage(1);
        setPageIndex(new Map());
        setSearchHits([]);
        setActiveHitId(null);
        setSearchMessage(null);
        setPrintedPageLabels(new Map());
        setSectionTitlesByPage(new Map());

        if (!loadingSources) {
          setSourceError("No PDF files were found in the public folder.");
        }
        return;
      }

      setSourceLoading(true);
      setSourceError(null);
      setPageCount(0);
      setCurrentPage(1);
      setPageIndex(new Map());
      setSearchHits([]);
      setActiveHitId(null);
      setSearchMessage(null);
      setPrintedPageLabels(new Map());
      setSectionTitlesByPage(new Map());
      setZoomPercent(100);

      if (activePdfRef.current) {
        activePdfRef.current.destroy();
        activePdfRef.current = null;
      }
      setPdfDoc(null);

      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const loadingTask = pdfjs.getDocument(activeSource.url);
        loadedDoc = await loadingTask.promise;

        if (cancelled) {
          loadedDoc.destroy();
          return;
        }

        activePdfRef.current = loadedDoc;
        setPdfDoc(loadedDoc);
        setPageCount(loadedDoc.numPages);

        setIndexing(true);
        const nextIndex = new Map<number, IndexedTextItem[]>();
        const nextPrintedPageLabels = new Map<number, string>();
        const nextSectionTitlesByPage = new Map<number, string>();

        for (let pageNumber = 1; pageNumber <= loadedDoc.numPages; pageNumber += 1) {
          const page = await loadedDoc.getPage(pageNumber);
          const textContent = await page.getTextContent(
            ({ disableCombineTextItems: true } as unknown) as Parameters<
              typeof page.getTextContent
            >[0],
          );
          const items: IndexedTextItem[] = [];

          for (let itemIndex = 0; itemIndex < textContent.items.length; itemIndex += 1) {
            const rawItem = textContent.items[itemIndex];
            if (!isTextItem(rawItem)) {
              continue;
            }

            const [scaleX, , , scaleY, x, y] = rawItem.transform;
            const itemWidth = Math.abs(rawItem.width || scaleX || 0);
            const itemHeight = Math.abs(rawItem.height || scaleY || 0);

            if (!rawItem.str.trim() || itemWidth === 0 || itemHeight === 0) {
              continue;
            }

            items.push({
              itemIndex,
              pageNumber,
              text: rawItem.str,
              x,
              y,
              width: itemWidth,
              height: itemHeight,
            });
          }

          nextIndex.set(pageNumber, items);
          const printedPageLabel = extractPrintedPageLabel(items);
          if (printedPageLabel) {
            nextPrintedPageLabels.set(pageNumber, printedPageLabel);
          }
          const sectionTitle = extractSectionTitle(items);
          if (sectionTitle) {
            nextSectionTitlesByPage.set(pageNumber, sectionTitle);
          }
        }

        if (!cancelled) {
          setPageIndex(nextIndex);
          setPrintedPageLabels(nextPrintedPageLabels);
          setSectionTitlesByPage(nextSectionTitlesByPage);
        }
      } catch {
        if (!cancelled) {
          setSourceError(`Unable to load ${activeSource.url}. Confirm the PDF exists in public/.`);
        }
      } finally {
        if (!cancelled) {
          setSourceLoading(false);
          setIndexing(false);
        }
      }
    }

    void loadSource();

    return () => {
      cancelled = true;
      if (loadedDoc) {
        loadedDoc.destroy();
      }
    };
  }, [activeSource, loadingSources]);

  useEffect(() => {
    let cancelled = false;

    async function renderCurrentPage() {
      if (!pdfDoc || !canvasRef.current || currentPage < 1 || currentPage > pageCount) {
        return;
      }

      const page = await pdfDoc.getPage(currentPage);
      const viewport = page.getViewport({ scale: renderScale });
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");

      if (!context) {
        return;
      }

      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, viewport.width, viewport.height);

      const renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
      });

      await renderTask.promise;
      if (!cancelled) {
        setViewportSize({ width: viewport.width, height: viewport.height });
      }
    }

    void renderCurrentPage();
    return () => {
      cancelled = true;
    };
  }, [currentPage, pageCount, pdfDoc, renderScale]);

  useEffect(() => {
    if (!viewerActiveHitId || !canvasContainerRef.current) {
      return;
    }

    const activeHighlight = canvasContainerRef.current.querySelector<HTMLElement>(
      `[data-hit-id="${viewerActiveHitId}"]`,
    );

    if (activeHighlight) {
      activeHighlight.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
    }
  }, [viewerActiveHitId, currentPage]);

  useEffect(() => {
    if (!citationFocus || !activeSource || typeof citationFocus.page !== "number") {
      return;
    }

    if (citationFocus.sourceId && activeSource.id !== citationFocus.sourceId) {
      return;
    }

    if (currentPage !== citationFocus.page) {
      setCurrentPage(citationFocus.page);
    }
  }, [activeSource, citationFocus, currentPage]);

  async function executeSearch() {
    const trimmedQuery = query.trim();
    setCitationFocus(null);
    if (!trimmedQuery) {
      setSearchHits([]);
      setActiveHitId(null);
      setSearchMessage("Enter a keyword to search.");
      return;
    }

    if (searchMode === "fuzzy") {
      if (!activeSource) {
        setSearchHits([]);
        setActiveHitId(null);
        setSearchMessage("Choose a source before searching.");
        return;
      }

      setSearchingFuzzy(true);
      try {
        const response = await fetch("/api/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: trimmedQuery,
            sourceId: activeSource.id,
            minPct: NATURAL_SEARCH_MIN_PCT,
            limit: NATURAL_SEARCH_LIMIT,
          }),
        });

        if (!response.ok) {
          throw new Error("Fuzzy search failed");
        }

        const payload = (await response.json()) as FuzzySearchPayload;
        const hits = Array.isArray(payload.hits) ? payload.hits : [];
        const snippetByPage = new Map<number, string>();
        const exactAnchorsByPage = new Map<number, SearchHit[]>();
        const naturalAnchorsByPage = new Map<number, SearchHit[]>();
        const pageAnchorCursor = new Map<number, number>();

        const enrichedHits = hits.map((hit) => {
          const pageItems = pageIndex.get(hit.pageNumber) ?? [];

          if (!snippetByPage.has(hit.pageNumber)) {
            const naturalSnippet = buildNaturalSnippetForPage(trimmedQuery, pageItems, hit.snippet);
            snippetByPage.set(hit.pageNumber, naturalSnippet);
          }

          if (!exactAnchorsByPage.has(hit.pageNumber)) {
            const anchors = pageItems.length
              ? findExactSearchHits(trimmedQuery, new Map([[hit.pageNumber, pageItems]]))
              : [];

            anchors.sort((a, b) => a.itemIndex - b.itemIndex || a.x - b.x);
            exactAnchorsByPage.set(hit.pageNumber, anchors);
          }

          if (!naturalAnchorsByPage.has(hit.pageNumber)) {
            const anchors = pageItems.length
              ? findNaturalAnchorsForPage(trimmedQuery, pageItems, hit.pageNumber, 12)
              : [];
            anchors.sort((a, b) => a.itemIndex - b.itemIndex || a.x - b.x);
            naturalAnchorsByPage.set(hit.pageNumber, anchors);
          }

          const exactAnchors = exactAnchorsByPage.get(hit.pageNumber) ?? [];
          const fuzzyAnchors = naturalAnchorsByPage.get(hit.pageNumber) ?? [];
          const anchorsForPage = exactAnchors.length > 0 ? exactAnchors : fuzzyAnchors;
          const cursor = pageAnchorCursor.get(hit.pageNumber) ?? 0;
          const anchor =
            anchorsForPage.length > 0 ? anchorsForPage[cursor % anchorsForPage.length] : null;
          pageAnchorCursor.set(hit.pageNumber, cursor + 1);

          return {
            ...hit,
            itemIndex: anchor?.itemIndex ?? hit.itemIndex,
            snippet: anchor?.snippet ?? snippetByPage.get(hit.pageNumber) ?? hit.snippet,
            x: anchor?.x ?? hit.x,
            y: anchor?.y ?? hit.y,
            width: anchor?.width ?? hit.width,
            height: anchor?.height ?? hit.height,
          };
        });

        setSearchHits(enrichedHits);

        if (enrichedHits.length > 0) {
          setCurrentPage(enrichedHits[0].pageNumber);
          setActiveHitId(enrichedHits[0].id);
          setSearchMessage(
            `Found ${enrichedHits.length} fuzzy matches at ${NATURAL_SEARCH_MIN_PCT}%+ similarity.`,
          );
        } else {
          setActiveHitId(null);
          setSearchMessage(`No fuzzy matches found at ${NATURAL_SEARCH_MIN_PCT}%+ similarity.`);
        }
      } catch {
        setSearchHits([]);
        setActiveHitId(null);
        setSearchMessage("Fuzzy search is unavailable right now.");
      } finally {
        setSearchingFuzzy(false);
      }
      return;
    }

    const hits = findExactSearchHits(trimmedQuery, pageIndex);
    setSearchHits(hits);

    if (hits.length > 0) {
      setCurrentPage(hits[0].pageNumber);
      setActiveHitId(hits[0].id);
      setSearchMessage(`Found ${hits.length} results in ${activeSource?.label ?? "source"}.`);
    } else {
      setActiveHitId(null);
      setSearchMessage("No exact matches found in this source.");
    }
  }

  function onSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void executeSearch();
  }

  function onKeywordKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || isBusy || !activeSource) {
      return;
    }

    event.preventDefault();
    void executeSearch();
  }

  function jumpToHit(hit: SearchHit) {
    setCitationFocus(null);
    setCurrentPage(hit.pageNumber);
    setActiveHitId(hit.id);
  }

  function previousPage() {
    setCitationFocus(null);
    setCurrentPage((page) => Math.max(1, page - 1));
  }

  function nextPage() {
    setCitationFocus(null);
    setCurrentPage((page) => Math.min(pageCount, page + 1));
  }

  function goToPage(page: number) {
    setCitationFocus(null);
    setCurrentPage(Math.max(1, Math.min(pageCount, page)));
  }

  function zoomOut() {
    setZoomPercent((zoom) => Math.max(MIN_ZOOM, zoom - ZOOM_STEP));
  }

  function zoomIn() {
    setZoomPercent((zoom) => Math.min(MAX_ZOOM, zoom + ZOOM_STEP));
  }

  function resetZoom() {
    setZoomPercent(100);
  }

  function downloadSource() {
    if (!activeSource) {
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = activeSource.url;
    anchor.download = `${activeSource.label}.pdf`;
    anchor.rel = "noopener";
    anchor.click();
  }

  function printSource() {
    if (!activeSource) {
      return;
    }

    window.open(activeSource.url, "_blank", "noopener,noreferrer");
  }

  function onCitationClick(citation: Citation) {
    const targetSourceId = citation.sourceId?.trim();
    const sourceExists = targetSourceId
      ? sources.some((source) => source.id === targetSourceId)
      : false;

    if (targetSourceId && sourceExists) {
      if (targetSourceId !== sourceId) {
        setSourceId(targetSourceId);
      }
    } else if (citation.url) {
      window.open(citation.url, "_blank", "noopener,noreferrer");
      return;
    }

    setCitationFocus(citation);
    setActiveHitId(null);

    if (typeof citation.page === "number") {
      setCurrentPage(citation.page);
    }
  }

  const isBusy = loadingSources || sourceLoading || indexing || searchingFuzzy;

  const searchButtonLabel = loadingSources
    ? "Loading sources..."
    : sourceLoading
      ? "Loading document..."
      : indexing
        ? "Indexing..."
        : searchingFuzzy
          ? "Searching..."
        : "Search";

  return (
    <main className="appShell">
      <PdfSearchTopBar
        query={query}
        onQueryChange={setQuery}
        onKeywordKeyDown={onKeywordKeyDown}
        searchMode={searchMode}
        onSearchModeChange={setSearchMode}
        onSearchSubmit={onSearchSubmit}
        sourceId={sourceId}
        onSourceChange={(nextSourceId) => {
          setCitationFocus(null);
          setSourceId(nextSourceId);
        }}
        loadingSources={loadingSources}
        sources={sources}
        isSearchDisabled={isBusy || !activeSource}
        searchButtonLabel={searchButtonLabel}
      />

      {sourceError ? <p className="bannerError">{sourceError}</p> : null}

      <section className="contentGrid">
        <PdfSearchResultsPane
          searchHits={searchHits}
          activeHitId={activeHitId}
          activeSourceLabel={activeSourceLabel}
          searchMode={searchMode}
          printedPageLabels={printedPageLabels}
          sectionTitlesByPage={sectionTitlesByPage}
          query={query}
          onJumpToHit={jumpToHit}
        />

        <PdfSearchViewerPane
          activeSourceLabel={activeSource?.label ?? "No source selected"}
          searchHitsCount={searchHits.length}
          searchMessage={viewerSearchMessage}
          currentPage={currentPage}
          pageCount={pageCount}
          onPreviousPage={previousPage}
          onNextPage={nextPage}
          onPageSelect={goToPage}
          zoomPercent={zoomPercent}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          onZoomOut={zoomOut}
          onZoomIn={zoomIn}
          onResetZoom={resetZoom}
          onPrintSource={printSource}
          onDownloadSource={downloadSource}
          hasActiveSource={Boolean(activeSource)}
          canvasContainerRef={canvasContainerRef}
          canvasRef={canvasRef}
          viewportSize={viewportSize}
          currentPageHits={viewerHits}
          renderScale={renderScale}
          zoomScale={zoomScale}
          activeHitId={viewerActiveHitId}
          onJumpToHit={jumpToHit}
          activeHit={viewerActiveHit}
          activeHitPrintedPageLabel={viewerActiveHitPrintedPageLabel}
        />
      </section>

      <RagAgentWidget onCitationClick={onCitationClick} />
    </main>
  );
}
