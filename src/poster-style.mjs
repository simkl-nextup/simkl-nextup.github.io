// Poster style settings for both rows, edited from /studio.html and stored in
// config/poster-style.json as { anime: {...}, tv: {...} }. Each section picks a
// look (the BetterPosters-style tags or the classic pre-1.10 badge) plus the tag
// options. Every tag option maps to a look built between 1.10.8 and 1.11.1.

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

// Which poster design a row uses. Kept apart from the tag options so it never
// changes tag-poster filenames on its own.
export const POSTER_LOOKS = {
  label: "Poster look",
  choices: {
    tags: "Tags — BetterPosters style (1.10+)",
    classic: "Classic badge (before 1.10)",
  },
};

export const POSTER_ACCOUNTS = {
  anime: { label: "Anime row", defaultLook: "tags" },
  tv: { label: "TV row · Account 2", defaultLook: "classic" },
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

// One row's settings: { look, ...tag options }.
export function normalizeAccountStyle(input, account = "anime") {
  const defaultLook = POSTER_ACCOUNTS[account]?.defaultLook ?? "tags";
  const look = input && Object.keys(POSTER_LOOKS.choices).includes(input.look) ? input.look : defaultLook;
  return { look, ...normalizePosterStyle(input) };
}

// The whole file. A flat file from 1.12.0 (tag options at the top level) is
// read as the anime section, so older configs keep working.
export function normalizePosterConfig(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const legacy = !source.anime && !source.tv && Object.keys(POSTER_STYLE_OPTIONS).some((key) => key in source);
  const config = {};
  for (const account of Object.keys(POSTER_ACCOUNTS)) {
    config[account] = normalizeAccountStyle(legacy && account === "anime" ? source : source[account], account);
  }
  return config;
}

export function defaultPosterConfig() {
  return normalizePosterConfig({});
}

export async function loadPosterConfig(filePath) {
  if (!filePath) return defaultPosterConfig();
  try {
    return normalizePosterConfig(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`Poster style file ignored (${error.message}); using defaults.`);
    return defaultPosterConfig();
  }
}

// Tag options for one row (without the look), as the poster renderer expects.
export async function loadPosterStyle(filePath, account = "anime") {
  const { look, ...style } = (await loadPosterConfig(filePath))[account] ?? normalizeAccountStyle(null, account);
  return style;
}
