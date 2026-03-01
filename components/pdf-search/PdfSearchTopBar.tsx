import type React from "react";
import type { DocumentSource } from "@/lib/documentSources";
import type { SearchMode } from "./types";

type PdfSearchTopBarProps = {
  query: string;
  onQueryChange: (nextValue: string) => void;
  onKeywordKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  searchMode: SearchMode;
  onSearchModeChange: (nextMode: SearchMode) => void;
  onSearchSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  sourceId: string;
  onSourceChange: (nextSourceId: string) => void;
  loadingSources: boolean;
  sources: DocumentSource[];
  isSearchDisabled: boolean;
  searchButtonLabel: string;
};

export function PdfSearchTopBar({
  query,
  onQueryChange,
  onKeywordKeyDown,
  searchMode,
  onSearchModeChange,
  onSearchSubmit,
  sourceId,
  onSourceChange,
  loadingSources,
  sources,
  isSearchDisabled,
  searchButtonLabel,
}: PdfSearchTopBarProps) {
  return (
    <header className="topSearchStrip">
      <form className="searchForm" onSubmit={onSearchSubmit}>
        <label htmlFor="keyword" className="srOnly">
          Keyword
        </label>
        <input
          id="keyword"
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onKeywordKeyDown}
          placeholder="Search specs, requirements, procedures..."
          className="keywordInput"
        />

        <label className="scopeSelect">
          <span>Search in:</span>
          <select
            value={sourceId}
            onChange={(event) => onSourceChange(event.target.value)}
            disabled={loadingSources || sources.length === 0}
          >
            {sources.length === 0 ? (
              <option value="">{loadingSources ? "Loading..." : "No PDF sources"}</option>
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
            onClick={() => onSearchModeChange("exact")}
          >
            Exact
          </button>
          <button
            type="button"
            className={searchMode === "natural" ? "active" : ""}
            onClick={() => onSearchModeChange("natural")}
          >
            Natural
          </button>
        </div>

        <button type="submit" className="searchButton" disabled={isSearchDisabled}>
          {searchButtonLabel}
        </button>
      </form>

    </header>
  );
}
