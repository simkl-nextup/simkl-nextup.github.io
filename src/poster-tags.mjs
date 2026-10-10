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

export const TAG_STYLE_VERSION = 4;
const W = 500;
const H = 750;
const FONT_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "fonts", "Inter-ExtraBold.otf");
const FONT = "Inter ExtraBold";

const LAYOUT = {
  tabH: 64, tabPad: 30, tabRadius: 10, tabFont: 34, tabMinFont: 24,
  sideGap: 18, sideH: 54, sidePad: 16, sideRadius: 10, sideFont: 28,
  // Measured from BetterPosters: logo ends ~82% down and can be large; the
  // status/score line is centred ~90% down.
  bandTop: 540, rowY: 652, pillH: 52, pillPad: 16, pillRadius: 10, pillFont: 26, ratingFont: 32, rowGap: 14,
  logoMaxW: 420, logoMaxH: 190, logoBottom: 626, logoMinTop: 400,
};

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

export function topTabText(badge) {
  const tags = badge?.tags ?? {};
  const aired = finite(tags.aired);
  const next = finite(tags.next);
  const season = finite(tags.season);
  if (badge?.status === "completed") {
    if (!next) return aired ? `E${aired} Aired` : null;
    // Simkl splits anime into one entry per season, so "S1" carries no
    // information; only show a season number when it is 2 or higher.
    return season && season > 1 ? `S${season} · Next E${next}` : `Next E${next}`;
  }
  if (badge?.status === "plantowatch") return aired ? `E${aired} Aired` : null;
  if (aired && next && aired > next) return `E${aired} Aired · Next E${next}`;
  if (next) return `Next E${next}`;
  return aired ? `E${aired} Aired` : null;
}

export function dubTag(badge) {
  const dub = badge?.dub;
  const episode = finite(dub?.episode);
  if (!dub || (!episode && !dub.full)) return null;
  if (dub.full) return { text: "DUB ✓ ALL", state: "ready" };
  if (dub.numberingMismatch) return { text: `DUB E${episode}`, state: "behind" };
  const next = badge.status === "plantowatch" ? 1 : finite(badge?.tags?.next);
  if (!next) return { text: `DUB E${episode}`, state: "behind" };
  return episode >= next
    ? { text: `DUB ✓ E${episode}`, state: "ready" }
    : { text: `DUB E${episode}`, state: "behind" };
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

export function adaptiveTabFill({ hue: h, sat: s, meanL, vividShare }) {
  let fill;
  if (vividShare > 0.16) fill = hslToHex(h, Math.min(0.78, Math.max(0.5, s)), 0.5);           // vivid
  else if (meanL >= 0.42) fill = hslToHex(h, Math.min(0.4, Math.max(0.1, s * 0.6)), 0.86);   // pale
  else if (s > 0.3) fill = hslToHex(h, Math.min(0.45, s * 0.8), 0.31);                        // mid-tone
  else fill = hslToHex(h, Math.min(0.25, s), 0.19);                                           // deep
  if (inkFor(fill) === "#FFFFFF" && contrast(fill, "#FFFFFF") < 4.5) {
    const [fh, fs] = rgbToHsl(...[1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16)));
    for (let l = 0.48; l >= 0.25; l -= 0.02) {
      fill = hslToHex(fh, fs, l);
      if (contrast(fill, "#FFFFFF") >= 4.5) break;
    }
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

// Heavy type with a soft dark outline + drop shadow on light text (the
// legibility trick from the original badges, toned down for flat tags).
// Returns an image padded by `pad` on every side.
async function label(text, color, px, options = {}) {
  const main = await rawText(text, color, px, options);
  const pad = 4;
  const canvas = { width: main.w + pad * 2, height: main.h + pad * 2 + 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } };
  const layers = [];
  if (color.toUpperCase() !== "#161616") {
    const dark = await rawText(text, "#000000", px, { ...options, alpha: options.haloAlpha ?? "60%" });
    const halo = await sharp(dark.img).extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .blur(1.3).png().toBuffer();
    layers.push({ input: halo, top: 0, left: 0 }, { input: halo, top: 2, left: 0 });
  }
  layers.push({ input: main.img, top: pad, left: pad });
  const img = await sharp({ create: canvas }).composite(layers).png().toBuffer();
  return { img, w: main.w, h: main.h, pad };
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

async function bottomBand(poster) {
  const top = LAYOUT.bandTop, h = H - top;
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

export async function prepareTaggedLogo(buffer) {
  const output = await sharp(buffer, { failOn: "error" })
    .ensureAlpha()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({ width: LAYOUT.logoMaxW, height: LAYOUT.logoMaxH, fit: "inside", withoutEnlargement: false })
    .png().toBuffer({ resolveWithObject: true });
  return {
    input: output.data,
    left: Math.round((W - output.info.width) / 2),
    top: Math.max(LAYOUT.logoMinTop, LAYOUT.logoBottom - output.info.height),
  };
}

async function fallbackTitle(name) {
  const text = String(name ?? "").trim().toUpperCase() || "UNTITLED";
  let px = text.length > 28 ? 34 : 42;
  let layer;
  for (;;) {
    layer = await label(text, "#FFFFFF", px, { width: LAYOUT.logoMaxW, haloAlpha: "85%" });
    if (layer.h <= LAYOUT.logoMaxH || px <= 26) break;
    px -= 3;
  }
  return place(layer, (W - layer.w) / 2, LAYOUT.logoBottom - layer.h);
}

// poster: image buffer (any size; covered to 500x750). logo: optional buffer.
export async function composeTaggedPoster({ poster, logo, name, badge }) {
  const base = await sharp(poster, { failOn: "error" }).resize(W, H, { fit: "cover", position: "centre" }).png().toBuffer();
  const layers = [await bottomBand(base)];

  // Title logo (above the band row) or the show name as text.
  // Draw the name as text only on artwork without its own title text;
  // otherwise it would be printed twice.
  let title = null;
  if (logo) {
    try { title = await prepareTaggedLogo(logo); } catch { title = null; }
  }
  if (!title && badge.textless) title = await fallbackTitle(name);
  if (title) layers.push(title);

  // Bottom row: [STATUS] ★ score.
  const status = STATUS_TAGS[badge.status];
  if (!status) throw new Error(`Unsupported poster status: ${badge.status}`);
  const statusInk = inkFor(status.fill);
  const statusText = await label(status.label, statusInk, LAYOUT.pillFont);
  const pillW = statusText.w + LAYOUT.pillPad * 2;
  const rating = badge.malScore ? await label(`★ ${badge.malScore}`, "#F4F4F4", LAYOUT.ratingFont, { haloAlpha: "85%" }) : null;
  const rowW = pillW + (rating ? LAYOUT.rowGap + rating.w : 0);
  const rowX = Math.round((W - rowW) / 2);
  const { rowY, pillH } = LAYOUT;
  layers.push({ input: await frosted(base, rowX, rowY, pillW, pillH, roundRect(pillW, pillH, LAYOUT.pillRadius), status.fill, 0.92), left: rowX, top: rowY });
  layers.push(place(statusText, rowX + LAYOUT.pillPad, rowY + (pillH - statusText.h) / 2));
  if (rating) layers.push(place(rating, rowX + pillW + LAYOUT.rowGap, rowY + (pillH - rating.h) / 2));

  // Top tab: episode info, tinted from the poster.
  const tabText = topTabText(badge);
  if (tabText) {
    const fill = adaptiveTabFill(await analyzePoster(base));
    const ink = inkFor(fill);
    let px = LAYOUT.tabFont, text;
    for (;;) {
      text = await label(tabText, ink, px);
      if (text.w + LAYOUT.tabPad * 2 <= W * 0.88 || px <= LAYOUT.tabMinFont) break;
      px -= 2;
    }
    const tabW = text.w + LAYOUT.tabPad * 2;
    const tabX = Math.round((W - tabW) / 2);
    layers.push({ input: await frosted(base, tabX, 0, tabW, LAYOUT.tabH, topTabShape(tabW, LAYOUT.tabH, LAYOUT.tabRadius), fill), left: tabX, top: 0 });
    layers.push(place(text, (W - text.w) / 2, (LAYOUT.tabH - text.h) / 2));
  }

  // Left dub tag, just under the top tab. Omitted when there is no dub.
  const dub = dubTag(badge);
  if (dub) {
    const ready = dub.state === "ready";
    const text = await label(dub.text, ready ? "#FFFFFF" : "#E4E8EE", LAYOUT.sideFont);
    const w = text.w + LAYOUT.sidePad * 2;
    const y = LAYOUT.tabH + LAYOUT.sideGap;
    layers.push({ input: await frosted(base, 0, y, w, LAYOUT.sideH, leftTagShape(w, LAYOUT.sideH, LAYOUT.sideRadius), DUB_FILLS[dub.state], ready ? 0.92 : 0.86), left: 0, top: y });
    layers.push(place(text, LAYOUT.sidePad, y + (LAYOUT.sideH - text.h) / 2));
  }

  return sharp(base).composite(layers).webp({ quality: 90, effort: 5 }).toBuffer();
}

export function taggedSignatureParts(badge) {
  return {
    tagStyle: TAG_STYLE_VERSION,
    top: topTabText(badge),
    dub: dubTag(badge)?.text ?? null,
    mal: badge?.malScore ?? null,
    textless: Boolean(badge?.textless),
  };
}
