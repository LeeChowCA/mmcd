import type { RefObject } from "react";
import type { SearchHit } from "./types";

type PdfSearchViewerPaneProps = {
  activeSourceLabel: string;
  searchHitsCount: number;
  searchMessage: string | null;
  currentPage: number;
  pageCount: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
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
  return (
    <section className="viewerPane">
      <div className="paneHeader viewerHeader">
        <div>
          <h2>Viewing: {activeSourceLabel}</h2>
          <p>Matches in this document: {searchHitsCount}</p>
        </div>
        <div className="viewerStatus">{searchMessage ?? "Ready for search."}</div>
      </div>

      <div className="viewerToolbar">
        <button type="button" onClick={onPreviousPage} disabled={currentPage <= 1}>
          Prev
        </button>
        <span className="toolbarValue">
          {pageCount === 0 ? 0 : currentPage} / {pageCount}
        </span>
        <button type="button" onClick={onNextPage} disabled={currentPage >= pageCount}>
          Next
        </button>

        <span className="toolbarDivider" />

        <button type="button" onClick={onZoomOut} disabled={zoomPercent <= minZoom}>
          -
        </button>
        <span className="toolbarValue">{zoomPercent}%</span>
        <button type="button" onClick={onZoomIn} disabled={zoomPercent >= maxZoom}>
          +
        </button>
        <button type="button" onClick={onResetZoom}>
          100%
        </button>

        <span className="toolbarDivider" />

        <button type="button" onClick={onPrintSource} disabled={!hasActiveSource}>
          Print
        </button>
        <button type="button" onClick={onDownloadSource} disabled={!hasActiveSource}>
          Download
        </button>
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
          Active match: {activeHitPrintedPageLabel ?? `PDF page ${activeHit.pageNumber}`}, item{" "}
          {activeHit.itemIndex + 1}
        </div>
      ) : null}
    </section>
  );
}
