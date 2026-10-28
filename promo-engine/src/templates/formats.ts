// Output formats (aspect-ratio families). One template renders into any of these.
// Dimensions are the final export pixel sizes; templates are responsive to `ratio`.

export type FormatId = "ig_square" | "ig_portrait" | "landscape" | "story";

export interface Format {
  id: FormatId;
  label: string;
  width: number;
  height: number;
  ratio: "1:1" | "4:5" | "16:9" | "9:16";
  platforms: string[]; // where this size is typically used
}

export const FORMATS: Record<FormatId, Format> = {
  ig_square: {
    id: "ig_square",
    label: "Square 1:1",
    width: 1080,
    height: 1080,
    ratio: "1:1",
    platforms: ["Instagram", "LinkedIn", "X"],
  },
  ig_portrait: {
    id: "ig_portrait",
    label: "Portrait 4:5",
    width: 1080,
    height: 1350,
    ratio: "4:5",
    platforms: ["Instagram", "LinkedIn"],
  },
  landscape: {
    id: "landscape",
    label: "Landscape 16:9",
    width: 1200,
    height: 675,
    ratio: "16:9",
    platforms: ["LinkedIn", "X"],
  },
  story: {
    id: "story",
    label: "Story 9:16",
    width: 1080,
    height: 1920,
    ratio: "9:16",
    platforms: ["Instagram Stories/Reels", "LinkedIn"],
  },
};

export const ALL_FORMATS = Object.values(FORMATS);
export const DEFAULT_FORMATS: FormatId[] = ["ig_square", "ig_portrait", "landscape", "story"];
