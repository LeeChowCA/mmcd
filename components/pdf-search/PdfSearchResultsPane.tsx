import type { SearchMode, SearchHit } from "./types";

type PdfSearchResultsPaneProps = {
  searchHits: SearchHit[];
  activeHitId: string | null;
  activeSourceLabel: string;
  searchMode: SearchMode;
  printedPageLabels: Map<number, string>;
  sectionTitlesByPage: Map<number, string>;
  query: string;
  onJumpToHit: (hit: SearchHit) => void;
};

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

export function PdfSearchResultsPane({
  searchHits,
  activeHitId,
  activeSourceLabel,
  searchMode,
  printedPageLabels,
  sectionTitlesByPage,
  query,
  onJumpToHit,
}: PdfSearchResultsPaneProps) {
  return (
    <aside className="resultsPane">
      <div className="paneHeader">
        <h2>
          {searchHits.length} results in {activeSourceLabel}
        </h2>
        <p>{searchMode === "exact" ? "Keyword Search" : "Natural Search (coming soon)"}</p>
      </div>

      <div className="resultsList">
        {searchHits.length === 0 ? (
          <p className="emptyState">Enter a keyword, choose a source, and run search to view matches.</p>
        ) : (
          <ul>
            {searchHits.map((hit) => {
              const active = hit.id === activeHitId;
              const hitPrintedPageLabel = printedPageLabels.get(hit.pageNumber) ?? hit.location.clause;
              const hitSectionTitle = sectionTitlesByPage.get(hit.pageNumber) ?? hit.location.section;
              return (
                <li key={hit.id} className={active ? "active" : ""}>
                  <div className="resultTop">
                    <span className="resultDoc">{activeSourceLabel} Document</span>
                    {searchMode === "natural" ? <span className="matchBadge">{hit.quality}</span> : null}
                  </div>

                  <p className="resultPath">
                    {hitSectionTitle} - {hitPrintedPageLabel}
                  </p>

                  <p className="resultSnippet">{renderMarkedSnippet(hit.snippet, query)}</p>

                  <button type="button" className="openButton" onClick={() => onJumpToHit(hit)}>
                    Open
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
