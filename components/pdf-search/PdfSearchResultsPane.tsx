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
  const distance = levenshteinDistance(a, b);
  const editScore = 1 - distance / maxLen;

  let prefix = 0;
  while (prefix < minLen && a[prefix] === b[prefix]) {
    prefix += 1;
  }
  const prefixScore = prefix / maxLen;

  return Math.max(editScore, prefixScore);
}

function renderMarkedSnippet(text: string, term: string) {
  const cleanedTerm = term.trim();
  if (!cleanedTerm) {
    return text;
  }

  const loweredTerm = cleanedTerm.toLowerCase();
  const queryTokens = loweredTerm.match(/[a-z0-9]+(?:\.[a-z0-9]+)*/g) ?? [];
  const phraseRegex = new RegExp(`(${escapeRegExp(cleanedTerm)})`, "ig");
  const phraseSegments = text.split(phraseRegex);
  const hasExactPhrase = phraseSegments.some((segment) => segment.toLowerCase() === loweredTerm);

  if (hasExactPhrase) {
    return phraseSegments.map((segment, index) =>
      segment.toLowerCase() === loweredTerm ? <mark key={index}>{segment}</mark> : segment,
    );
  }

  const tokenizedSegments = text.split(/([A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)/g);
  return tokenizedSegments.map((segment, index) => {
    const lowered = segment.toLowerCase();
    const isWord = /^[a-z0-9]+(?:\.[a-z0-9]+)*$/i.test(segment);
    if (!isWord) {
      return segment;
    }

    const shouldHighlight = queryTokens.some((token) => {
      if (token.length < 2 || lowered.length < 2) {
        return false;
      }
      return tokenSimilarity(lowered, token) >= 0.72;
    });

    return shouldHighlight ? <mark key={index}>{segment}</mark> : segment;
  });
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
  const resultCountLabel = `${searchHits.length} ${searchHits.length === 1 ? "match" : "matches"}`;

  return (
    <aside className="resultsPane">
      <div className="paneHeader">
        <span className="paneEyebrow">
          {searchMode === "exact" ? "Keyword retrieval" : "Similarity retrieval"}
        </span>
        <h2>{resultCountLabel}</h2>
        <p>
          {searchHits.length === 0
            ? `Run a search in ${activeSourceLabel} to reveal ranked excerpts.`
            : `Ranked evidence from ${activeSourceLabel}.`}
        </p>
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
              const metaLabel = hit.location.part?.trim() || "Document excerpt";
              return (
                <li key={hit.id} className={active ? "active" : ""}>
                  <div className="resultTopRow">
                    <span className="resultPageChip">P.{hitPrintedPageLabel}</span>
                    {searchMode === "fuzzy" ? <span className="matchBadge">{hit.quality}</span> : null}
                  </div>

                  <div className="resultTitleStack">
                    <p className="resultSectionTitle">{hitSectionTitle}</p>
                    <p className="resultMetaInline">
                      {activeSourceLabel} / {metaLabel}
                    </p>
                  </div>

                  <p className="resultSnippet">{renderMarkedSnippet(hit.snippet, query)}</p>

                  <div className="resultFooter">
                    <div className="resultMetaChips" aria-label="Result metadata">
                      <span className="resultMetaChip">Page {hitPrintedPageLabel}</span>
                      <span className="resultMetaChip">{metaLabel}</span>
                    </div>

                    <button type="button" className="openButton" onClick={() => onJumpToHit(hit)}>
                      Open page
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
