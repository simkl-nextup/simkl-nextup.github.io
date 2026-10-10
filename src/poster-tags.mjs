// BetterPosters-style "tags" poster used by the anime account.
//
//   ┌────────────────────────┐
//   │  [ E13 Aired · Next E2 ]│  top tab: episode info, tinted from the poster
//   │[DUB ✓ E9]               │  left tag: English dub state (omitted if no dub)
//   │                         │
//   │        TITLE LOGO       │  TMDB logo, or the show name as text
//   │▒▒ [NEW EPISODE] ★ 8.4 ▒▒│  blurred band: status tag + MAL score
//   └────────────────────────┘
//
// The TV account keeps the classic badges in poster-badges.mjs.

import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { DEFAULT_POSTER_STYLE, normalizePosterStyle } from "./poster-style.mjs";

export const TAG_STYLE_VERSION = 13;
const W = 500;
const H = 750;
const FONT_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "fonts", "Inter-ExtraBold.otf");
const FONT = "Inter ExtraBold";

// Two size presets. "large" is sized for reading from a sofa (posters show
// ~230px wide on a TV, so everything here is roughly halved on screen).
export const SIZE_PRESETS = {
  large: {
    tabFont: 46, tabMinFont: 34, tabSubFont: 31, tabPad: 30, tabH: 78, tabRadius: 12, tabOpacity: 0.95,
    chipFont: 30, chipH: 56, chipPad: 16, chipRadius: 12, chipGap: 12, chipOpacity: 0.95,
    bandTop: 520, rowY: 640, pillH: 62, pillPad: 18, pillRadius: 12, pillFont: 31, ratingFont: 44, rowGap: 14,
    logoMaxW: 420, logoMaxH: 170, logoBottom: 616, logoMinTop: 400,
  },
  compact: {
    tabFont: 36, tabMinFont: 26, tabSubFont: 26, tabPad: 30, tabH: 64, tabRadius: 10, tabOpacity: 0.9,
    chipFont: 28, chipH: 54, chipPad: 16, chipRadius: 10, chipGap: 16, chipOpacity: 0.92,
    bandTop: 540, rowY: 652, pillH: 52, pillPad: 16, pillRadius: 10, pillFont: 26, ratingFont: 32, rowGap: 14,
    logoMaxW: 420, logoMaxH: 190, logoBottom: 626, logoMinTop: 400,
  },
};
export function layoutFor(style) {
  return SIZE_PRESETS[style?.size] ?? SIZE_PRESETS.large;
}

// Status colours keep their meaning; flat BetterPosters finish.
export const STATUS_TAGS = {
  watching: { label: "NEW EPISODE", fill: "#0B7D52" },
  plantowatch: { label: "PLAN TO WATCH", fill: "#F0A23A" },
  completed: { label: "NEW SEASON", fill: "#7050F5" },
};
// The dub tag has its own accent so it is never confused with a status.
export const DUB_FILLS = { ready: "#1673C4", behind: "#4A5568" };

// ---------------------------------------------------------------- text ----
function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

// Always shows the season (TheTVDB numbering, as in Nuvio's episode list):
//   "S3 · E16 Aired · Next E15"   same season, behind
//   "S2E1 Aired · Next S1E10"     different seasons
//   "S3 · Next E15"               caught up to the latest release
//   "S1 · E12 Aired"              Plan to Watch
// Two lines for distance viewing: the big line is what you act on, the small
// line is context.  { main: "Next S1 E2", sub: "E13 aired" }
export function topTabLines(badge) {
  const tags = badge?.tags ?? {};
  const aired = finite(tags.aired);
  const next = finite(tags.next);
  const airedSeason = finite(tags.airedSeason) ?? finite(tags.season) ?? 1;
  const nextSeason = finite(tags.nextSeason) ?? finite(tags.season) ?? 1;
  if (badge?.status === "plantowatch" || !next) return aired ? { main: `S${airedSeason} E${aired}`, sub: "latest aired" } : null;
  const ahead = aired && (airedSeason > nextSeason || (airedSeason === nextSeason && aired > next));
  const main = `Next S${nextSeason} E${next}`;
  if (badge?.status !== "completed" && ahead) return { main, sub: `S${airedSeason} E${aired} aired` };
  return { main, sub: null };
}

export function topTabText(badge) {
  const tags = badge?.tags ?? {};
  const aired = finite(tags.aired);
  const next = finite(tags.next);
  const airedSeason = finite(tags.airedSeason) ?? finite(tags.season) ?? 1;
  const nextSeason = finite(tags.nextSeason) ?? finite(tags.season) ?? 1;
  if (badge?.status === "plantowatch" || !next) return aired ? `S${airedSeason} · E${aired} Aired` : null;
  const ahead = aired && (airedSeason > nextSeason || (airedSeason === nextSeason && aired > next));
  if (badge?.status !== "completed" && ahead) {
    return airedSeason === nextSeason
      ? `S${nextSeason} · E${aired} Aired · Next E${next}`
      : `S${airedSeason}E${aired} Aired · Next S${nextSeason}E${next}`;
  }
  return `S${nextSeason} · Next E${next}`;
}

// Dub tag, with the season (same TheTVDB numbering as the top tab):
//   "DUB ✓ S3 E11" dub has reached your next episode
//   "DUB S3 E13"   dub is behind
//   "DUB ✓ S1 ALL" fully dubbed      "DUB S2 AIRING" dub airing, episode unknown
export function dubTag(badge) {
  const dub = badge?.dub;
  const episode = finite(dub?.episode);
  if (!dub || (!episode && !dub.full && !dub.airing && !dub.unknown)) return null;
  const tags = badge?.tags ?? {};
  const season = finite(dub.season) ?? finite(tags.nextSeason) ?? finite(tags.airedSeason) ?? finite(tags.season) ?? 1;
  if (dub.full) return { text: `DUB ✓ S${season} ALL`, state: "ready" };
  if (!episode && dub.airing) return { text: `DUB S${season} AIRING`, state: "behind" };
  if (!episode) return { text: `DUB S${season}`, state: "behind" };          // dub exists, progress unknown
  const label = `S${season} E${episode}`;
  if (dub.numberingMismatch) return { text: `DUB ${label}`, state: "behind" };
  if (badge.status === "plantowatch") return { text: `DUB ✓ ${label}`, state: "ready" };
  const next = finite(tags.next);
  const nextSeason = finite(tags.nextSeason) ?? finite(tags.season) ?? season;
  if (!next) return { text: `DUB ${label}`, state: "behind" };
  const reached = season > nextSeason || (season === nextSeason && episode >= next);
  return reached ? { text: `DUB ✓ ${label}`, state: "ready" } : { text: `DUB ${label}`, state: "behind" };
}

// ------------------------------------------------------------- colour ----
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, s, l];
}
function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}
function relLum(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
export function contrast(a, b) {
  const [x, y] = [relLum(a), relLum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
export function inkFor(fill) {
  return contrast(fill, "#FFFFFF") >= contrast(fill, "#161616") ? "#FFFFFF" : "#161616";
}

// Whole-poster analysis: brightness, dominant hue, and how much of the poster
// is that hue in a strong mid-tone form (same rules as Recently Dubbed).
async function analyzePoster(buffer) {
  const { data, info } = await sharp(buffer).resize(40, 60, { fit: "fill" }).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const N = data.length / info.channels, B = 24;
  const w = Array(B).fill(0), hx = Array(B).fill(0), hy = Array(B).fill(0), ss = Array(B).fill(0), vivid = Array(B).fill(0);
  let sumL = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    sumL += l;
    if (l < 0.06 || l > 0.95) continue;
    const chroma = s * (1 - Math.abs(2 * l - 1));
    if (chroma < 0.06) continue;
    const b = Math.floor(h / (360 / B)) % B;
    w[b] += chroma; ss[b] += s * chroma;
    hx[b] += Math.cos((h * Math.PI) / 180) * chroma; hy[b] += Math.sin((h * Math.PI) / 180) * chroma;
    if (s > 0.45 && l > 0.3 && l < 0.72) vivid[b] += 1;
  }
  let best = -1, bestW = 0;
  for (let b = 0; b < B; b += 1) {
    const total = w[b] + 0.5 * (w[(b + 1) % B] + w[(b + B - 1) % B]);
    if (total > bestW) { bestW = total; best = b; }
  }
  if (best < 0) return { meanL: sumL / N, hue: 210, sat: 0.05, vividShare: 0 };
  let hue = (Math.atan2(hy[best], hx[best]) * 180) / Math.PI; if (hue < 0) hue += 360;
  const near = [best, (best + 1) % B, (best + B - 1) % B];
  return { meanL: sumL / N, hue, sat: ss[best] / w[best], vividShare: near.reduce((a, b) => a + vivid[b], 0) / N };
}

export function adaptiveTabFill({ hue: h, sat: s, meanL, vividShare }, target = 7) {
  let fill;
  if (vividShare > 0.16) fill = hslToHex(h, Math.min(0.78, Math.max(0.5, s)), 0.5);           // vivid
  else if (meanL >= 0.42) fill = hslToHex(h, Math.min(0.4, Math.max(0.1, s * 0.6)), 0.86);   // pale
  else if (s > 0.3) fill = hslToHex(h, Math.min(0.45, s * 0.8), 0.31);                        // mid-tone
  else fill = hslToHex(h, Math.min(0.25, s), 0.19);                                           // deep
  // Push the fill until its text reaches 7:1 (WCAG AAA): darker for white
  // text, lighter for dark text.
  const [fh, fs, fl] = rgbToHsl(...[1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16)));
  const whiteText = inkFor(fill) === "#FFFFFF";
  for (let l = fl, i = 0; contrast(fill, inkFor(fill)) < target && i < 40; i += 1) {
    l = whiteText ? Math.max(0.08, l - 0.02) : Math.min(0.95, l + 0.02);
    fill = hslToHex(fh, fs, l);
  }
  return fill;
}

// ------------------------------------------------------------ drawing ----
function escapeMarkup(value) {
  return String(value).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
}

async function rawText(text, color, px, { alpha = "100%", width, align } = {}) {
  const out = await sharp({
    text: {
      text: `<span foreground="${color}" fgalpha="${alpha}">${escapeMarkup(text)}</span>`,
      font: `${FONT} ${px}`,
      fontfile: FONT_FILE,
      rgba: true,
      dpi: 72,
      ...(width ? { width, align: align ?? "centre", wrap: "word" } : {}),
    },
  }).png().toBuffer({ resolveWithObject: true });
  return { img: out.data, w: out.info.width, h: out.info.height };
}

// Text. The outline is decided by the style: black outline on white text
// and/or white outline on black text, thin or bold. Text sitting straight on
// artwork (the score) can also get a soft shadow.
async function label(text, color, px, options = {}) {
  const main = await rawText(text, color, px, options);
  const darkText = color.toUpperCase() === "#161616";
  const style = options.style ?? DEFAULT_POSTER_STYLE;
  const wantOutline = options.outline ?? (darkText ? style.outlineOnDarkText : style.outlineOnWhiteText);
  const weight = style.outlineWeight === "bold" ? 0.075 : 0.055;
  const r = wantOutline ? Math.max(2, Math.round(px * weight)) : 0;
  const pad = r + 8;
  const none = { r: 0, g: 0, b: 0, alpha: 0 };
  const canvas = { width: main.w + pad * 2, height: main.h + pad * 2 + 3, channels: 4, background: none };
  const layers = [];
  if (options.shadow) {
    const src = await rawText(text, "#000000", px, { ...options, alpha: options.shadowAlpha ?? "70%" });
    const shadow = await sharp(src.img).extend({ top: pad, bottom: pad, left: pad, right: pad, background: none }).blur(3).png().toBuffer();
    layers.push({ input: shadow, top: 3, left: 0 });
  }
  if (r) {
    const stampSrc = await rawText(text, darkText ? "#FFFFFF" : "#000000", px, { ...options, alpha: darkText ? "85%" : "92%" });
    const inset = pad - r;
    const stamp = await sharp(stampSrc.img).extend({ top: inset, bottom: inset, left: inset, right: inset, background: none }).blur(0.4).png().toBuffer();
    for (const dx of [-r, 0, r]) for (const dy of [-r, 0, r]) {
      if (dx || dy) layers.push({ input: stamp, top: r + dy, left: r + dx });
    }
  }
  layers.push({ input: main.img, top: pad, left: pad });
  const img = await sharp({ create: canvas }).composite(layers).png().toBuffer();
  return { img, w: main.w, h: main.h, pad };
}

// Coloured drop shadows: every tag casts a soft shadow in a deeper shade of
// its own colour, drawn as one layer underneath all the tags.
export function shadowShade(fill) {
  const [h, s, l] = rgbToHsl(...[1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16)));
  return hslToHex(h, Math.min(1, s * 1.15 + 0.05), Math.max(0.07, l * 0.5));
}
function tagShadowLayer(shadows) {
  if (!shadows.length) return null;
  const shapes = shadows.map(({ x, y, shape, fill }) =>
    `<g transform="translate(${x} ${y + 9})"><path d="${shape}" fill="${shadowShade(fill)}" fill-opacity="1"/></g>`).join("");
  return Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="s" x="-20%" y="-20%" width="140%" height="160%"><feGaussianBlur stdDeviation="9"/></filter></defs>
    <g filter="url(#s)">${shapes}</g></svg>`);
}

const roundRect = (w, h, r) => `M${r} 0 H${w - r} Q${w} 0 ${w} ${r} V${h - r} Q${w} ${h} ${w - r} ${h} H${r} Q0 ${h} 0 ${h - r} V${r} Q0 0 ${r} 0 Z`;
const topTabShape = (w, h, r) => `M0 0 H${w} V${h - r} Q${w} ${h} ${w - r} ${h} H${r} Q0 ${h} 0 ${h - r} Z`;
const leftTagShape = (w, h, r) => `M0 0 H${w - r} Q${w} 0 ${w} ${r} V${h - r} Q${w} ${h} ${w - r} ${h} H0 Z`;

// Frosted shape: blurred poster patch with a tint over it, clipped to `shape`.
async function frosted(poster, left, top, w, h, shape, fill, opacity = 0.86) {
  const svg = (paint) => Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><path d="${shape}" ${paint}/></svg>`);
  return sharp(poster).extract({ left, top, width: w, height: h }).blur(8)
    .composite([{ input: svg(`fill="${fill}" fill-opacity="${opacity}"`) }, { input: svg('fill="#fff"'), blend: "dest-in" }])
    .png().toBuffer();
}

function place(layer, left, top) {
  return { input: layer.img, left: Math.round(left - layer.pad), top: Math.round(top - layer.pad) };
}

async function bottomBand(poster, L) {
  const top = L.bandTop, h = H - top;
  const shade = Buffer.from(`<svg width="${W}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.05"/><stop offset="1" stop-color="#000" stop-opacity="0.62"/></linearGradient></defs>
    <rect width="${W}" height="${h}" fill="url(#d)"/></svg>`);
  const fade = Buffer.from(`<svg width="${W}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="1"/></linearGradient></defs>
    <rect width="${W}" height="${h}" fill="url(#a)"/></svg>`);
  const img = await sharp(poster).extract({ left: 0, top, width: W, height: h }).blur(14)
    .composite([{ input: shade }, { input: fade, blend: "dest-in" }]).png().toBuffer();
  return { input: img, left: 0, top };
}

export async function prepareTaggedLogo(buffer, L = SIZE_PRESETS.large) {
  const output = await sharp(buffer, { failOn: "error" })
    .ensureAlpha()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({ width: L.logoMaxW, height: L.logoMaxH, fit: "inside", withoutEnlargement: false })
    .png().toBuffer({ resolveWithObject: true });
  return {
    input: output.data,
    left: Math.round((W - output.info.width) / 2),
    top: Math.max(L.logoMinTop, L.logoBottom - output.info.height),
  };
}

async function fallbackTitle(name, L, style) {
  const text = String(name ?? "").trim().toUpperCase() || "UNTITLED";
  let px = text.length > 28 ? 34 : 42;
  let layer;
  for (;;) {
    layer = await label(text, "#FFFFFF", px, { width: L.logoMaxW, style, outline: true, shadow: true });
    if (layer.h <= L.logoMaxH || px <= 26) break;
    px -= 3;
  }
  return place(layer, (W - layer.w) / 2, L.logoBottom - layer.h);
}

// Tab tints for both contrast settings (the studio previews either).
export async function posterTints(poster) {
  const base = await sharp(poster, { failOn: "error" }).resize(W, H, { fit: "cover", position: "centre" }).png().toBuffer();
  const analysis = await analyzePoster(base);
  return { max: adaptiveTabFill(analysis, 7), standard: adaptiveTabFill(analysis, 4.5) };
}

const rightChipShape = (w, h, r) => `M${w} 0 H${r} Q0 0 0 ${r} V${h - r} Q0 ${h} ${r} ${h} H${w} Z`;

// poster: image buffer (any size; covered to 500x750). logo: optional buffer.
// style: see poster-style.mjs (defaults to 1.11.1 without the white outline).
export async function composeTaggedPoster({ poster, logo, name, badge, style: rawStyle, tints }) {
  const style = normalizePosterStyle(rawStyle ?? DEFAULT_POSTER_STYLE);
  const L = layoutFor(style);
  const base = await sharp(poster, { failOn: "error" }).resize(W, H, { fit: "cover", position: "centre" }).png().toBuffer();
  const layers = [await bottomBand(base, L)];
  const shadows = [];
  const text = (value, color, px, extra = {}) => label(value, color, px, { style, ...extra });

  // Title logo (above the band row) or, on textless artwork only, the name.
  let title = null;
  if (logo) {
    try { title = await prepareTaggedLogo(logo, L); } catch { title = null; }
  }
  if (!title && badge.textless) title = await fallbackTitle(name, L, style);
  if (title) layers.push(title);

  // Bottom row: [STATUS] ★ score.
  const status = STATUS_TAGS[badge.status];
  if (!status) throw new Error(`Unsupported poster status: ${badge.status}`);
  const statusText = await text(status.label, inkFor(status.fill), L.pillFont);
  const pillW = statusText.w + L.pillPad * 2;
  const rating = badge.malScore
    ? await text(`★ ${badge.malScore}`, "#FFFFFF", L.ratingFont, { shadow: style.ratingShadow, shadowAlpha: "85%" })
    : null;
  const rowW = pillW + (rating ? L.rowGap + rating.w : 0);
  const rowX = Math.round((W - rowW) / 2);
  const tagsStart = layers.length;
  shadows.push({ x: rowX, y: L.rowY, shape: roundRect(pillW, L.pillH, L.pillRadius), fill: status.fill });
  layers.push({ input: await frosted(base, rowX, L.rowY, pillW, L.pillH, roundRect(pillW, L.pillH, L.pillRadius), status.fill, 0.92), left: rowX, top: L.rowY });
  layers.push(place(statusText, rowX + L.pillPad, L.rowY + (L.pillH - statusText.h) / 2));
  if (rating) layers.push(place(rating, rowX + pillW + L.rowGap, L.rowY + (L.pillH - rating.h) / 2));

  // Top tab, in one of four layouts.
  const lines = topTabLines(badge);
  const single = topTabText(badge);
  let tint = null;
  let tabH = 0;
  if (lines) {
    if (tints) tint = style.contrast === "standard" ? tints.standard : tints.max;
    else tint = adaptiveTabFill(await analyzePoster(base), style.contrast === "standard" ? 4.5 : 7);
    const ink = inkFor(tint);
    const fit = async (value, startPx, maxW) => {
      let px = startPx, layer;
      for (;;) {
        layer = await text(value, ink, px);
        if (layer.w <= maxW || px <= L.tabMinFont) return layer;
        px -= 2;
      }
    };
    const twoLines = (style.topTab === "boxed" || style.topTab === "band") && lines.sub;
    if (style.topTab === "single") {
      const main = await fit(single, L.tabFont - 6, W * 0.9 - L.tabPad * 2);
      tabH = L.tabH;
      const tabW = main.w + L.tabPad * 2;
      const tabX = Math.round((W - tabW) / 2);
      shadows.push({ x: tabX, y: 0, shape: topTabShape(tabW, tabH, L.tabRadius), fill: tint });
      layers.push({ input: await frosted(base, tabX, 0, tabW, tabH, topTabShape(tabW, tabH, L.tabRadius), tint, L.tabOpacity), left: tabX, top: 0 });
      layers.push(place(main, (W - main.w) / 2, (tabH - main.h) / 2));
    } else if (twoLines) {
      const full = style.topTab === "band";
      const main = await fit(lines.main, L.tabFont + (full ? 2 : 0), W * 0.96 - L.tabPad * 2);
      const sub = await text(lines.sub, ink, L.tabSubFont, { alpha: "90%" });
      const gap = 5;
      tabH = Math.round(main.h + gap + sub.h + 22);
      const tabW = full ? Math.round(W * 0.98) : Math.max(main.w, sub.w) + L.tabPad * 2;
      const tabX = Math.round((W - tabW) / 2);
      shadows.push({ x: tabX, y: 0, shape: topTabShape(tabW, tabH, L.tabRadius), fill: tint });
      layers.push({ input: await frosted(base, tabX, 0, tabW, tabH, topTabShape(tabW, tabH, L.tabRadius), tint, L.tabOpacity), left: tabX, top: 0 });
      const y0 = (tabH - (main.h + gap + sub.h)) / 2;
      layers.push(place(main, (W - main.w) / 2, y0));
      layers.push(place(sub, (W - sub.w) / 2, y0 + main.h + gap));
    } else {
      // "chip" (and two-line layouts with nothing to put on line two).
      const main = await fit(lines.main, L.tabFont, W * 0.9 - L.tabPad * 2);
      tabH = L.tabH;
      const tabW = main.w + L.tabPad * 2;
      const tabX = Math.round((W - tabW) / 2);
      shadows.push({ x: tabX, y: 0, shape: topTabShape(tabW, tabH, L.tabRadius), fill: tint });
      layers.push({ input: await frosted(base, tabX, 0, tabW, tabH, topTabShape(tabW, tabH, L.tabRadius), tint, L.tabOpacity), left: tabX, top: 0 });
      layers.push(place(main, (W - main.w) / 2, (tabH - main.h) / 2));
    }
  }

  // Chips under the tab: dub on the left; in "chip" mode the aired info on the right.
  const chipY = (tabH || L.tabH) + L.chipGap;
  const dub = dubTag(badge);
  let leftW = 0;
  if (dub) {
    const ready = dub.state === "ready";
    const label_ = await text(dub.text, "#FFFFFF", L.chipFont);
    leftW = label_.w + L.chipPad * 2;
    shadows.push({ x: 0, y: chipY, shape: leftTagShape(leftW, L.chipH, L.chipRadius), fill: DUB_FILLS[dub.state] });
    layers.push({ input: await frosted(base, 0, chipY, leftW, L.chipH, leftTagShape(leftW, L.chipH, L.chipRadius), DUB_FILLS[dub.state], ready ? L.chipOpacity : 0.9), left: 0, top: chipY });
    layers.push(place(label_, L.chipPad, chipY + (L.chipH - label_.h) / 2));
  }
  if (style.topTab === "chip" && lines?.sub) {
    const label_ = await text(lines.sub, inkFor(tint), L.chipFont);
    const w = label_.w + L.chipPad * 2;
    const y = leftW + w + 16 > W ? chipY + L.chipH + 8 : chipY;
    const x = W - w;
    shadows.push({ x, y, shape: rightChipShape(w, L.chipH, L.chipRadius), fill: tint });
    layers.push({ input: await frosted(base, x, y, w, L.chipH, rightChipShape(w, L.chipH, L.chipRadius), tint, L.chipOpacity), left: x, top: y });
    layers.push(place(label_, x + L.chipPad, y + (L.chipH - label_.h) / 2));
  }

  if (style.tagShadow === "coloured") {
    const shadowLayer = tagShadowLayer(shadows);
    if (shadowLayer) layers.splice(tagsStart, 0, { input: shadowLayer, left: 0, top: 0 });
  }
  return sharp(base).composite(layers).webp({ quality: 90, effort: 5 }).toBuffer();
}

export function taggedSignatureParts(badge, style) {
  return {
    tagStyle: TAG_STYLE_VERSION,
    style: normalizePosterStyle(style ?? DEFAULT_POSTER_STYLE),
    top: topTabText(badge),
    dub: dubTag(badge)?.text ?? null,
    mal: badge?.malScore ?? null,
    textless: Boolean(badge?.textless),
  };
}
