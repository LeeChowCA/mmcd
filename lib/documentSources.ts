export type DocumentSource = {
  id: string;
  label: string;
  url: string;
};

const LABEL_OVERRIDES: Record<string, string> = {
  mmcd: "MMCD",
  smmcd: "SMMCD",
  vmmcd: "VMMCD",
  "surry-smmcd-2024": "SMMCD",
};

function toSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toLabel(baseName: string) {
  const slug = toSlug(baseName);
  const override = LABEL_OVERRIDES[slug];

  if (override) {
    return override;
  }

  return baseName
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function sourceFromPdfFilename(fileName: string): DocumentSource | null {
  if (!/\.pdf$/i.test(fileName)) {
    return null;
  }

  const baseName = fileName.replace(/\.pdf$/i, "");
  const id = toSlug(baseName);

  if (!id) {
    return null;
  }

  return {
    id,
    label: toLabel(baseName),
    url: `/${encodeURIComponent(fileName)}`,
  };
}

export function buildSourcesFromFilenames(fileNames: string[]): DocumentSource[] {
  const uniqueById = new Map<string, DocumentSource>();

  for (const fileName of fileNames) {
    const source = sourceFromPdfFilename(fileName);
    if (source) {
      uniqueById.set(source.id, source);
    }
  }

  return [...uniqueById.values()].sort((a, b) => a.label.localeCompare(b.label));
}
