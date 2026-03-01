export type SearchMode = "exact" | "natural";

export type IndexedTextItem = {
  itemIndex: number;
  text: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type HitLocation = {
  section: string;
  part: string;
  clause: string;
};

export type SearchHit = {
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
