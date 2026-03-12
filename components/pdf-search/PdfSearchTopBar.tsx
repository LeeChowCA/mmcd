"use client";

import Image from "next/image";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
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
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  const activeSource = useMemo(
    () => sources.find((source) => source.id === sourceId) ?? null,
    [sourceId, sources],
  );
  const sourceButtonLabel = activeSource?.label ?? (loadingSources ? "Loading..." : "No PDF sources");
  const isSourceDisabled = loadingSources || sources.length === 0;

  useEffect(() => {
    function onDocumentPointerDown(event: MouseEvent) {
      if (!scopeRef.current?.contains(event.target as Node)) {
        setIsSourceOpen(false);
      }
    }

    document.addEventListener("mousedown", onDocumentPointerDown);
    return () => document.removeEventListener("mousedown", onDocumentPointerDown);
  }, []);

  function onScopeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      setIsSourceOpen(false);
    }
  }

  return (
    <header className="topSearchStrip">
      <div className="topSearchIntro">
        <div className="topSearchBrand">
          <div className="topSearchBrandMark" aria-hidden="true">
            <Image src="/scale_technics.png" alt="" width={44} height={44} />
          </div>
          <div className="topSearchBrandCopy">
            <p className="topSearchEyebrow">Scale Technics</p>
            <h1>MMCD Intelligence Workspace</h1>
            <p>Search specs, inspect pages, and verify answers against the source.</p>
          </div>
        </div>
      </div>

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

        <div
          className={`scopeSelect ${isSourceOpen ? "open" : ""} ${isSourceDisabled ? "disabled" : ""}`}
          ref={scopeRef}
          onKeyDown={onScopeKeyDown}
        >
          <button
            type="button"
            className="scopeSelectTrigger"
            aria-haspopup="listbox"
            aria-expanded={isSourceOpen}
            aria-controls={listboxId}
            onClick={() => {
              if (!isSourceDisabled) {
                setIsSourceOpen((current) => !current);
              }
            }}
            disabled={isSourceDisabled}
          >
            <span className="scopeSelectLabel">Source</span>
            <span className="scopeSelectValue">{sourceButtonLabel}</span>
            <span className="scopeSelectChevron" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 9l6 6 6-6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>

          {isSourceOpen ? (
            <div id={listboxId} className="scopeSelectMenu" role="listbox" aria-label="Document source">
              {sources.map((source) => {
                const isActive = source.id === sourceId;
                return (
                  <button
                    key={source.id}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={`scopeSelectOption ${isActive ? "active" : ""}`}
                    onClick={() => onSourceChange(source.id)}
                  >
                    <span className="scopeSelectOptionTitle">{source.label}</span>
                    <span className="scopeSelectOptionMeta">PDF source</span>
                    {isActive ? <span className="scopeSelectOptionCheck">Current</span> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

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
            className={searchMode === "fuzzy" ? "active" : ""}
            onClick={() => onSearchModeChange("fuzzy")}
          >
            Fuzzy
          </button>
        </div>

        <button type="submit" className="searchButton" disabled={isSearchDisabled}>
          {searchButtonLabel}
        </button>
      </form>
    </header>
  );
}
