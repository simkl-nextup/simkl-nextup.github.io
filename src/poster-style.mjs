// Poster style settings for the anime row, edited from /studio.html and
// stored in config/poster-style.json. Every option maps to a look we built
// between 1.10.8 and 1.11.1, so any combination can be mixed.

import { readFile } from "node:fs/promises";

export const POSTER_STYLE_OPTIONS = {
  topTab: {
    label: "Top tab",
    choices: {
      chip: "Next S1 E2 + aired chip on the right (1.11)",
      single: "One line: S1 · E13 Aired · Next E2 (1.10.8)",
      boxed: "Two lines, compact box (1.10.9)",
      band: "Two lines, full-width band (1.10.10)",
    },
  },
  size: {
    label: "Tag size",
    choices: { large: "Large — readable from the sofa (1.11)", compact: "Compact (1.10.8)" },
  },
  outlineOnWhiteText: {
    label: "Black outline on white text",
    choices: { true: "On", false: "Off" },
  },
  outlineOnDarkText: {
    label: "White outline on black text",
    choices: { false: "Off", true: "On" },
  },
  outlineWeight: {
    label: "Outline thickness",
    choices: { thin: "Thin (1.11.1)", bold: "Bold (1.10.10)" },
  },
  tagShadow: {
    label: "Tag drop shadow",
    choices: { coloured: "Coloured, matches each tag (1.11.1)", none: "None" },
  },
  contrast: {
    label: "Top tab contrast",
    choices: { max: "Maximum, 7:1 (1.11)", standard: "Standard, 4.5:1 (1.10.8)" },
  },
  ratingShadow: {
    label: "Shadow under the ★ score",
    choices: { true: "On", false: "Off" },
  },
};

// 1.11.1 without the white outline on black text.
export const DEFAULT_POSTER_STYLE = Object.freeze({
  topTab: "chip",
  size: "large",
  outlineOnWhiteText: true,
  outlineOnDarkText: false,
  outlineWeight: "thin",
  tagShadow: "coloured",
  contrast: "max",
  ratingShadow: true,
});

// Keeps only known keys with allowed values; anything else falls back to the default.
export function normalizePosterStyle(input) {
  const style = { ...DEFAULT_POSTER_STYLE };
  if (!input || typeof input !== "object") return style;
  for (const [key, option] of Object.entries(POSTER_STYLE_OPTIONS)) {
    if (!(key in input)) continue;
    const raw = input[key];
    const allowed = Object.keys(option.choices);
    const asString = String(raw);
    if (!allowed.includes(asString)) continue;
    style[key] = typeof DEFAULT_POSTER_STYLE[key] === "boolean" ? asString === "true" : asString;
  }
  return style;
}

export async function loadPosterStyle(filePath) {
  if (!filePath) return { ...DEFAULT_POSTER_STYLE };
  try {
    return normalizePosterStyle(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`Poster style file ignored (${error.message}); using defaults.`);
    return { ...DEFAULT_POSTER_STYLE };
  }
}
