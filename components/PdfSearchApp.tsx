"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PDFDocumentProxy,
  TextItem,
  TextMarkedContent,
} from "pdfjs-dist/types/src/display/api";
import type { DocumentSource } from "@/lib/documentSources";

type SearchMode = "exact" | "natural";

type IndexedTextItem = {
  itemIndex: number;
  text: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

type HitLocation = {
  section: string;
  part: string;
  clause: string;
};

type SearchHit = {
  id: string;
  pageNumber: number;
  itemIndex: number;
  snippet: string;
  x: number;
  y: number;
  width: number;
  height: number;
  quality: "High Match";
  location: HitLocation;
};

const BASE_RENDER_SCALE = 1.15;
const MIN_ZOOM = 70;
const MAX_ZOOM = 180;
const ZOOM_STEP = 10;

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderMarkedSnippet(text: string, term: string) {
  const cleanedTerm = term.trim();
  if (!cleanedTerm) {
    return text;
  }

  const regex = new RegExp(`(${escapeRegExp(cleanedTerm)})`, "ig");
  const segments = text.split(regex);
  const loweredTerm = cleanedTerm.toLowerCase();

  return segments.map((segment, index) =>
    segment.toLowerCase() === loweredTerm ? <mark key={index}>{segment}</mark> : segment,
  );
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
  const [pageIndex, setPageIndex] = useState<Map<number, IndexedTextItem[]>>(
    new Map(),
  );
  const [indexing, setIndexing] = useState(false);

  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [activeHitId, setActiveHitId] = useState<string | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);

  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [zoomPercent, setZoomPercent] = useState(100);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const activePdfRef = useRef<PDFDocumentProxy | null>(null);

  const activeSource = useMemo(
    () => sources.find((source) => source.id === sourceId) ?? null,
    [sourceId, sources],
  );

  const activeHit = useMemo(
    () => searchHits.find((hit) => hit.id === activeHitId) ?? null,
    [activeHitId, searchHits],
  );

  const currentPageHits = useMemo(
    () => searchHits.filter((hit) => hit.pageNumber === currentPage),
    [currentPage, searchHits],
  );

  const renderScale = useMemo(
    () => BASE_RENDER_SCALE * (zoomPercent / 100),
    [zoomPercent],
  );

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

        for (let pageNumber = 1; pageNumber <= loadedDoc.numPages; pageNumber += 1) {
          const page = await loadedDoc.getPage(pageNumber);
          const textContent = await page.getTextContent();
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
        }

        if (!cancelled) {
          setPageIndex(nextIndex);
        }
      } catch {
        if (!cancelled) {
          setSourceError(
            `Unable to load ${activeSource.url}. Confirm the PDF exists in public/.`,
          );
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
    if (!activeHitId || !canvasContainerRef.current) {
      return;
    }

    const activeHighlight = canvasContainerRef.current.querySelector<HTMLElement>(
      `[data-hit-id="${activeHitId}"]`,
    );

    if (activeHighlight) {
      activeHighlight.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
    }
  }, [activeHitId, currentPage]);

  function runExactSearch() {
    const term = query.trim().toLowerCase();
    if (!term) {
      setSearchHits([]);
      setActiveHitId(null);
      setSearchMessage("Enter a keyword to search.");
      return;
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

          const safeLength = Math.max(item.text.length, 1);
          const xOffset = (item.width * hitIndex) / safeLength;
          const hitWidth = Math.max((item.width * term.length) / safeLength, 3);
          const location = deriveHitLocation(items, i, pageNumber);

          hits.push({
            id: `${pageNumber}-${item.itemIndex}-${hitIndex}`,
            pageNumber,
            itemIndex: item.itemIndex,
            snippet: buildSnippet(item.text, hitIndex, term.length),
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

    if (hits.length === 0) {
      const queryTokens = tokenizeForSearch(query);

      if (queryTokens.length > 0) {
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
              if (flattenedTokens[i + j].token !== queryTokens[j]) {
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
            const hitWidth = Math.max((firstItem.width * queryTokens[0].length) / safeLength, 3);

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
      }
    }

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

  function executeSearch() {
    if (searchMode === "natural") {
      setSearchHits([]);
      setActiveHitId(null);
      setSearchMessage("Natural (fuzzy) mode is not implemented yet.");
      return;
    }

    runExactSearch();
  }

  function onSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    executeSearch();
  }

  function onKeywordKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || isBusy || !activeSource) {
      return;
    }

    event.preventDefault();
    executeSearch();
  }

  function jumpToHit(hit: SearchHit) {
    setCurrentPage(hit.pageNumber);
    setActiveHitId(hit.id);
  }

  function previousPage() {
    setCurrentPage((page) => Math.max(1, page - 1));
  }

  function nextPage() {
    setCurrentPage((page) => Math.min(pageCount, page + 1));
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

  const isBusy = loadingSources || sourceLoading || indexing;

  return (
    <main className="appShell">
      <header className="topSearchStrip">
        <form className="searchForm" onSubmit={onSearchSubmit}>
          <label htmlFor="keyword" className="srOnly">
            Keyword
          </label>
          <input
            id="keyword"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeywordKeyDown}
            placeholder="Search specs, requirements, procedures..."
            className="keywordInput"
          />

          <label className="scopeSelect">
            <span>Search in:</span>
            <select
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
              disabled={loadingSources || sources.length === 0}
            >
              {sources.length === 0 ? (
                <option value="">
                  {loadingSources ? "Loading..." : "No PDF sources"}
                </option>
              ) : (
                sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.label}
                  </option>
                ))
              )}
            </select>
          </label>

          <div className="modeSwitch" aria-label="Search mode">
            <button
              type="button"
              className={searchMode === "exact" ? "active" : ""}
              onClick={() => setSearchMode("exact")}
            >
              Exact
            </button>
            <button
              type="button"
              className={searchMode === "natural" ? "active" : ""}
              onClick={() => setSearchMode("natural")}
            >
              Natural
            </button>
          </div>

          <button type="submit" className="searchButton" disabled={isBusy || !activeSource}>
            {loadingSources
              ? "Loading sources..."
              : sourceLoading
                ? "Loading document..."
                : indexing
                  ? "Indexing..."
                  : "Search"}
          </button>
        </form>

        <div className="utilityActions">
          <button type="button" aria-label="Notifications">
            Alerts
          </button>
          <button type="button" aria-label="Settings">
            Settings
          </button>
          <button type="button" aria-label="Help">
            Help
          </button>
        </div>
      </header>

      {sourceError ? <p className="bannerError">{sourceError}</p> : null}

      <section className="contentGrid">
        <aside className="resultsPane">
          <div className="paneHeader">
            <h2>
              {searchHits.length} results in {activeSource?.label ?? "No source"}
            </h2>
            <p>{searchMode === "exact" ? "Keyword Search" : "Natural Search (coming soon)"}</p>
          </div>

          <div className="resultsList">
            {searchHits.length === 0 ? (
              <p className="emptyState">
                Enter a keyword, choose a source, and run search to view matches.
              </p>
            ) : (
              <ul>
                {searchHits.map((hit) => {
                  const active = hit.id === activeHitId;
                  return (
                    <li key={hit.id} className={active ? "active" : ""}>
                      <div className="resultTop">
                        <span className="resultDoc">{activeSource?.label ?? "MMCD"} Document</span>
                        <span className="matchBadge">{hit.quality}</span>
                      </div>

                      <p className="resultPath">
                        {hit.location.section} - {hit.location.part} - {hit.location.clause}
                      </p>

                      <p className="resultSnippet">{renderMarkedSnippet(hit.snippet, query)}</p>

                      <button type="button" className="openButton" onClick={() => jumpToHit(hit)}>
                        Open
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <section className="viewerPane">
          <div className="paneHeader viewerHeader">
            <div>
              <h2>Viewing: {activeSource?.label ?? "No source selected"}</h2>
              <p>Matches in this document: {searchHits.length}</p>
            </div>
            <div className="viewerStatus">{searchMessage ?? "Ready for search."}</div>
          </div>

          <div className="viewerToolbar">
            <button type="button" onClick={previousPage} disabled={currentPage <= 1}>
              Prev
            </button>
            <span className="toolbarValue">
              Page {pageCount === 0 ? 0 : currentPage} / {pageCount}
            </span>
            <button type="button" onClick={nextPage} disabled={currentPage >= pageCount}>
              Next
            </button>

            <span className="toolbarDivider" />

            <button type="button" onClick={zoomOut} disabled={zoomPercent <= MIN_ZOOM}>
              -
            </button>
            <span className="toolbarValue">{zoomPercent}%</span>
            <button type="button" onClick={zoomIn} disabled={zoomPercent >= MAX_ZOOM}>
              +
            </button>
            <button type="button" onClick={resetZoom}>
              100%
            </button>

            <span className="toolbarDivider" />

            <button type="button" onClick={printSource} disabled={!activeSource}>
              Print
            </button>
            <button type="button" onClick={downloadSource} disabled={!activeSource}>
              Download
            </button>
          </div>

          <div className="viewerCanvasFrame" ref={canvasContainerRef}>
            <div className="canvasWrap" style={{ maxWidth: viewportSize.width || undefined }}>
              <canvas ref={canvasRef} />

              {currentPageHits.map((hit) => {
                const top = viewportSize.height - (hit.y + hit.height) * renderScale;
                const left = hit.x * renderScale;
                const width = Math.max(hit.width * renderScale, 6);
                const height = Math.max(hit.height * renderScale, 10);
                const isActive = hit.id === activeHitId;

                return (
                  <button
                    key={hit.id}
                    type="button"
                    data-hit-id={hit.id}
                    className={`highlight ${isActive ? "active" : ""}`}
                    style={{ top, left, width, height }}
                    onClick={() => jumpToHit(hit)}
                    aria-label={`Open match on page ${hit.pageNumber}`}
                  />
                );
              })}
            </div>
          </div>

          {activeHit ? (
            <div className="activeMatchBar">
              Active match: page {activeHit.pageNumber}, item {activeHit.itemIndex + 1}
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
