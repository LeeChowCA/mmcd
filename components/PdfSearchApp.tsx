"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import type { DocumentSource } from "@/lib/documentSources";
import { PdfSearchResultsPane } from "./pdf-search/PdfSearchResultsPane";
import { PdfSearchTopBar } from "./pdf-search/PdfSearchTopBar";
import { PdfSearchViewerPane } from "./pdf-search/PdfSearchViewerPane";
import {
  BASE_RENDER_SCALE,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  extractPrintedPageLabel,
  extractSectionTitle,
  findExactSearchHits,
  isTextItem,
} from "./pdf-search/searchUtils";
import type { IndexedTextItem, SearchHit, SearchMode } from "./pdf-search/types";

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
  const [printedPageLabels, setPrintedPageLabels] = useState<Map<number, string>>(new Map());
  const [sectionTitlesByPage, setSectionTitlesByPage] = useState<Map<number, string>>(new Map());

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
    () => searchHits.filter((hit) => hit.pageNumber === currentPage),
    [currentPage, searchHits],
  );

  const renderScale = BASE_RENDER_SCALE;
  const zoomScale = zoomPercent / 100;

  const activeHitPrintedPageLabel = useMemo(
    () => (activeHit ? printedPageLabels.get(activeHit.pageNumber) ?? null : null),
    [activeHit, printedPageLabels],
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

  function executeSearch() {
    if (searchMode === "natural") {
      setSearchHits([]);
      setActiveHitId(null);
      setSearchMessage("Natural (fuzzy) mode is not implemented yet.");
      return;
    }

    const hits = findExactSearchHits(query, pageIndex);
    setSearchHits(hits);

    if (hits.length > 0) {
      setCurrentPage(hits[0].pageNumber);
      setActiveHitId(hits[0].id);
      setSearchMessage(`Found ${hits.length} results in ${activeSource?.label ?? "source"}.`);
    } else {
      setActiveHitId(null);
      setSearchMessage(query.trim() ? "No exact matches found in this source." : "Enter a keyword to search.");
    }
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

  const searchButtonLabel = loadingSources
    ? "Loading sources..."
    : sourceLoading
      ? "Loading document..."
      : indexing
        ? "Indexing..."
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
        onSourceChange={setSourceId}
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
          searchMessage={searchMessage}
          currentPage={currentPage}
          pageCount={pageCount}
          onPreviousPage={previousPage}
          onNextPage={nextPage}
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
          currentPageHits={currentPageHits}
          renderScale={renderScale}
          zoomScale={zoomScale}
          activeHitId={activeHitId}
          onJumpToHit={jumpToHit}
          activeHit={activeHit}
          activeHitPrintedPageLabel={activeHitPrintedPageLabel}
        />
      </section>
    </main>
  );
}
