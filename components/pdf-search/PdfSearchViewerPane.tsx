import { useRef, type KeyboardEvent, type RefObject } from "react";
import type { SearchHit } from "./types";

type PdfSearchViewerPaneProps = {
  activeSourceLabel: string;
  searchHitsCount: number;
  searchMessage: string | null;
  currentPage: number;
  pageCount: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onPageSelect: (page: number) => void;
  zoomPercent: number;
  minZoom: number;
  maxZoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onResetZoom: () => void;
  onPrintSource: () => void;
  onDownloadSource: () => void;
  hasActiveSource: boolean;
  canvasContainerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  viewportSize: { width: number; height: number };
  currentPageHits: SearchHit[];
  renderScale: number;
  zoomScale: number;
  activeHitId: string | null;
  onJumpToHit: (hit: SearchHit) => void;
  activeHit: SearchHit | null;
  activeHitPrintedPageLabel: string | null;
};

export function PdfSearchViewerPane({
  activeSourceLabel,
  searchHitsCount,
  searchMessage,
  currentPage,
  pageCount,
  onPreviousPage,
  onNextPage,
  onPageSelect,
  zoomPercent,
  minZoom,
  maxZoom,
  onZoomOut,
  onZoomIn,
  onResetZoom,
  onPrintSource,
  onDownloadSource,
  hasActiveSource,
  canvasContainerRef,
  canvasRef,
  viewportSize,
  currentPageHits,
  renderScale,
  zoomScale,
  activeHitId,
  onJumpToHit,
  activeHit,
  activeHitPrintedPageLabel,
}: PdfSearchViewerPaneProps) {
  const pageInputRef = useRef<HTMLInputElement | null>(null);

  function commitPageInput() {
    if (pageCount === 0) {
      if (pageInputRef.current) {
        pageInputRef.current.value = "";
      }
      return;
    }

    const rawValue = pageInputRef.current?.value ?? "";
    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed)) {
      if (pageInputRef.current) {
        pageInputRef.current.value = String(currentPage);
      }
      return;
    }

    const nextPage = Math.max(1, Math.min(pageCount, parsed));
    if (pageInputRef.current) {
      pageInputRef.current.value = String(nextPage);
    }
    if (nextPage !== currentPage) {
      onPageSelect(nextPage);
    }
  }

  function onPageInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitPageInput();
    }
  }

  return (
    <section className="viewerPane">
      <div className="paneHeader viewerHeader">
        <div className="viewerHeading">
          <span className="paneEyebrow">Source viewer</span>
          <h2>{activeSourceLabel}</h2>
          <p>
            {searchHitsCount} {searchHitsCount === 1 ? "match" : "matches"} available in this
            document
          </p>
        </div>
        <div className="viewerStatusCard">
          <span className="viewerStatusLabel">Status</span>
          <div className="viewerStatus">{searchMessage ?? "Ready to inspect cited pages."}</div>
        </div>
      </div>

      <div className="viewerToolbar">
        <div className="viewerToolbarGroup">
          <button type="button" onClick={onPreviousPage} disabled={currentPage <= 1}>
            Prev
          </button>
          <label className="toolbarPageGroup">
            <span className="toolbarGroupLabel">Page</span>
            <input
              key={pageCount === 0 ? "empty-page" : `page-${currentPage}-${pageCount}`}
              ref={pageInputRef}
              type="number"
              inputMode="numeric"
              min={pageCount > 0 ? 1 : undefined}
              max={pageCount > 0 ? pageCount : undefined}
              className="toolbarPageInput"
              defaultValue={pageCount === 0 ? "" : String(currentPage)}
              onBlur={commitPageInput}
              onKeyDown={onPageInputKeyDown}
              disabled={pageCount === 0}
              aria-label="Page number"
            />
            <span className="toolbarPageTotal">/ {pageCount}</span>
          </label>
          <button type="button" onClick={onNextPage} disabled={currentPage >= pageCount}>
            Next
          </button>
        </div>

        <span className="toolbarDivider" />

        <div className="viewerToolbarGroup">
          <span className="toolbarGroupLabel">Zoom</span>
          <button type="button" onClick={onZoomOut} disabled={zoomPercent <= minZoom}>
            -
          </button>
          <span className="toolbarValue">{zoomPercent}%</span>
          <button type="button" onClick={onZoomIn} disabled={zoomPercent >= maxZoom}>
            +
          </button>
          <button type="button" onClick={onResetZoom}>
            Reset
          </button>
        </div>

        <span className="toolbarDivider" />

        <div className="viewerToolbarGroup">
          <button type="button" onClick={onPrintSource} disabled={!hasActiveSource}>
            Open PDF
          </button>
          <button type="button" onClick={onDownloadSource} disabled={!hasActiveSource}>
            Download
          </button>
        </div>
      </div>

      <div className="viewerCanvasFrame" ref={canvasContainerRef}>
        <div
          className="canvasWrap"
          style={{
            width: viewportSize.width > 0 ? viewportSize.width * zoomScale : undefined,
            height: viewportSize.height > 0 ? viewportSize.height * zoomScale : undefined,
          }}
        >
          <div
            className="canvasStage"
            style={{
              width: viewportSize.width > 0 ? viewportSize.width : undefined,
              height: viewportSize.height > 0 ? viewportSize.height : undefined,
              transform: `scale(${zoomScale})`,
            }}
          >
            <canvas ref={canvasRef} />

            {currentPageHits.map((hit) => {
              const padX = 3;
              const padY = 2;
              const top = Math.max(0, viewportSize.height - (hit.y + hit.height) * renderScale - padY);
              const left = Math.max(0, hit.x * renderScale - padX);
              const width = Math.max(hit.width * renderScale + padX * 2, 10);
              const height = Math.max(hit.height * renderScale + padY * 2, 12);
              const isActive = hit.id === activeHitId;

              return (
                <button
                  key={hit.id}
                  type="button"
                  data-hit-id={hit.id}
                  className={`highlight ${isActive ? "active" : ""}`}
                  style={{ top, left, width, height }}
                  onClick={() => onJumpToHit(hit)}
                  aria-label={`Open match on page ${hit.pageNumber}`}
                />
              );
            })}
          </div>
        </div>
      </div>

      {activeHit ? (
        <div className="activeMatchBar">
          Active evidence: {activeHitPrintedPageLabel ?? `PDF page ${activeHit.pageNumber}`}, item{" "}
          {activeHit.itemIndex + 1}
        </div>
      ) : null}
    </section>
  );
}
