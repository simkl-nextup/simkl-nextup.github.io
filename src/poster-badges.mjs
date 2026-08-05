import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const POSTER_WIDTH = 500;
const POSTER_HEIGHT = 750;
const POSTER_BADGE_STYLE_VERSION = 8;
const MAX_POSTER_BYTES = 12 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const ALLOWED_POSTER_HOSTS = new Set([
  "image.tmdb.org",
  "artworks.thetvdb.com",
  "simkl.in",
  "wsrv.nl",
]);

// BTTTR-inspired hierarchy for television cards:
//   1. one compact, centred state pill at the very top;
//   2. a separate title logo above the lower controls;
//   3. episode numbers anchored to the bottom edge.
const BADGE_LAYOUT = {
  margin: 14,
  statusY: 14,
  statusHeight: 64,
  statusRadius: 11,
  detailY: 658,
  detailWidth: 472,
  detailHeight: 78,
  detailRadius: 12,
  logoMaxWidth: 410,
  logoMaxHeight: 132,
  logoBottomGap: 18,
};

const STATUS_STYLES = {
  watching: {
    label: "New Episode",
    accent: "#19D993",
    detailAccent: "#73FFD3",
  },
  plantowatch: {
    label: "Plan to Watch",
    accent: "#FFC14A",
    detailAccent: "#FFD877",
  },
  completed: {
    label: "New Season",
    accent: "#A99AFF",
    detailAccent: "#C9C0FF",
  },
};

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function compactEpisodeLabel(value) {
  const label = String(value ?? "").trim();
  const seasonEpisode = label.match(/^S0*(\d+)E0*(\d+)$/i)
    || label.match(/^S0*(\d+)\s*[·-]\s*E0*(\d+)$/i);
  if (seasonEpisode) return `S${seasonEpisode[1]} E${seasonEpisode[2]}`;
  const episode = label.match(/^(?:Ep\.?|EP)\s*(\d+)$/i);
  if (episode) return `EP ${episode[1]}`;
  return label.toUpperCase().slice(0, 16);
}

function statusPanelWidth(label) {
  const estimated = Math.ceil(label.length * 23 + 54);
  return Math.max(278, Math.min(374, estimated));
}

function statusFontSize(label) {
  return label.length > 12 ? 35 : 39;
}

function episodeFontSize(label, cellCount) {
  const cellWidth = BADGE_LAYOUT.detailWidth / cellCount;
  const maxSize = cellCount === 1 ? 39 : 35;
  const minSize = cellCount === 1 ? 31 : 28;
  const availableWidth = cellWidth - 24;
  const estimated = Math.floor(availableWidth / (Math.max(1, label.length) * 0.6));
  return Math.max(minSize, Math.min(maxSize, estimated));
}

function infoRows({ status, episode, latestEpisode, nextEpisode }) {
  const fallback = compactEpisodeLabel(episode);
  const latest = compactEpisodeLabel(latestEpisode || episode);
  const next = compactEpisodeLabel(nextEpisode || episode);

  if (status === "watching") {
    return [
      { cue: "NEW", episode: latest || fallback, accent: "#73FFD3" },
      { cue: "NEXT", episode: next || fallback, accent: "#72CEFF" },
    ];
  }

  return [{
    cue: status === "plantowatch" ? "LATEST" : "NEW",
    episode: latest || fallback,
    accent: STATUS_STYLES[status].detailAccent,
  }];
}

function detailPanelSvg(rows) {
  const {
    margin,
    detailY,
    detailWidth,
    detailHeight,
    detailRadius,
  } = BADGE_LAYOUT;
  const cellWidth = detailWidth / rows.length;
  const cueY = detailY + 27;
  const episodeY = detailY + 64;

  const cells = rows.map((row, index) => {
    const x = margin + cellWidth * index;
    const centerX = x + cellWidth / 2;
    const fontSize = episodeFontSize(row.episode, rows.length);
    return `
      <rect x="${x}" y="${detailY}" width="${cellWidth}" height="5" fill="${row.accent}" clip-path="url(#detailClip)"/>
      <text x="${centerX}" y="${cueY}" class="infoCue" text-anchor="middle" fill="${row.accent}">${escapeXml(row.cue)}</text>
      <text x="${centerX}" y="${episodeY}" class="infoEpisode" text-anchor="middle" font-size="${fontSize}px">${escapeXml(row.episode)}</text>`;
  }).join("");

  const dividers = rows.slice(1).map((_, index) => {
    const x = margin + cellWidth * (index + 1);
    return `<path d="M${x} ${detailY + 13} V${detailY + detailHeight - 10}" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="2"/>`;
  }).join("");

  return `
    <rect id="bottomEpisodePanel" x="${margin}" y="${detailY}" width="${detailWidth}" height="${detailHeight}" rx="${detailRadius}" fill="#030507" fill-opacity="0.95" stroke="#FFFFFF" stroke-opacity="0.28" stroke-width="2"/>
    ${cells}
    ${dividers}`;
}

export function buildPosterBadgeSvg({ status, episode, latestEpisode, nextEpisode }) {
  const style = STATUS_STYLES[status];
  if (!style) throw new Error(`Unsupported poster badge status: ${status}`);
  const rows = infoRows({ status, episode, latestEpisode, nextEpisode });
  if (!rows.every((row) => row.episode)) throw new Error("Poster badge episode label is required.");

  const statusWidth = statusPanelWidth(style.label);
  const statusX = (POSTER_WIDTH - statusWidth) / 2;
  const statusTextY = BADGE_LAYOUT.statusY + 44;

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}" viewBox="0 0 ${POSTER_WIDTH} ${POSTER_HEIGHT}">
  <defs>
    <clipPath id="statusClip">
      <rect x="${statusX}" y="${BADGE_LAYOUT.statusY}" width="${statusWidth}" height="${BADGE_LAYOUT.statusHeight}" rx="${BADGE_LAYOUT.statusRadius}"/>
    </clipPath>
    <clipPath id="detailClip">
      <rect x="${BADGE_LAYOUT.margin}" y="${BADGE_LAYOUT.detailY}" width="${BADGE_LAYOUT.detailWidth}" height="${BADGE_LAYOUT.detailHeight}" rx="${BADGE_LAYOUT.detailRadius}"/>
    </clipPath>
    <filter id="panelShadow" x="-25%" y="-35%" width="160%" height="190%">
      <feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#000000" flood-opacity="0.9"/>
    </filter>
    <filter id="textShadow" x="-25%" y="-40%" width="160%" height="190%">
      <feDropShadow dx="0" dy="2" stdDeviation="1.2" flood-color="#000000" flood-opacity="1"/>
    </filter>
    <style>
      .statusText,.infoCue,.infoEpisode{font-family:Arial Black,Arial,Helvetica,sans-serif;font-weight:900;filter:url(#textShadow)}
      .statusText{font-size:${statusFontSize(style.label)}px;fill:#FFFFFF;letter-spacing:.15px}
      .infoCue{font-size:${rows.length === 1 ? 23 : 21}px;letter-spacing:.7px}
      .infoEpisode{fill:#FFFFFF;letter-spacing:.15px}
    </style>
  </defs>
  <g filter="url(#panelShadow)">
    <rect id="topStatusPanel" x="${statusX}" y="${BADGE_LAYOUT.statusY}" width="${statusWidth}" height="${BADGE_LAYOUT.statusHeight}" rx="${BADGE_LAYOUT.statusRadius}" fill="#060708" fill-opacity="0.91" stroke="#FFFFFF" stroke-opacity="0.2" stroke-width="2"/>
    <rect x="${statusX}" y="${BADGE_LAYOUT.statusY + BADGE_LAYOUT.statusHeight - 5}" width="${statusWidth}" height="5" fill="${style.accent}" clip-path="url(#statusClip)"/>
    <text x="${POSTER_WIDTH / 2}" y="${statusTextY}" class="statusText" text-anchor="middle">${escapeXml(style.label)}</text>
    ${detailPanelSvg(rows)}
  </g>
</svg>`);
}

function buildLowerVignetteSvg() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}" viewBox="0 0 ${POSTER_WIDTH} ${POSTER_HEIGHT}">
    <defs>
      <linearGradient id="lowerVignette" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="48%" stop-color="#000000" stop-opacity="0.12"/>
        <stop offset="78%" stop-color="#000000" stop-opacity="0.48"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.78"/>
      </linearGradient>
    </defs>
    <rect x="0" y="430" width="${POSTER_WIDTH}" height="320" fill="url(#lowerVignette)"/>
  </svg>`);
}

function splitTitle(value) {
  const words = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return ["Untitled"];
  if (words.join(" ").length <= 22) return [words.join(" ")];

  const lines = ["", ""];
  for (const word of words) {
    const target = lines[0].length <= lines[1].length ? 0 : 1;
    lines[target] = `${lines[target]} ${word}`.trim();
  }
  return lines.filter(Boolean).slice(0, 2);
}

function buildFallbackTitleSvg(name) {
  const lines = splitTitle(name);
  const longest = Math.max(...lines.map((line) => line.length));
  const fontSize = Math.max(30, Math.min(lines.length === 1 ? 49 : 42, Math.floor(620 / Math.max(1, longest))));
  const lineHeight = Math.round(fontSize * 1.02);
  const bottom = BADGE_LAYOUT.detailY - BADGE_LAYOUT.logoBottomGap;
  const firstY = bottom - (lines.length - 1) * lineHeight;
  const tspans = lines.map((line, index) => `<tspan x="250" y="${firstY + index * lineHeight}">${escapeXml(line.toUpperCase())}</tspan>`).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}" viewBox="0 0 ${POSTER_WIDTH} ${POSTER_HEIGHT}">
    <defs>
      <filter id="titleShadow" x="-30%" y="-40%" width="170%" height="200%">
        <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000000" flood-opacity="1"/>
      </filter>
      <style>.fallbackTitle{font-family:Arial Black,Arial,Helvetica,sans-serif;font-size:${fontSize}px;font-weight:900;fill:#FFFFFF;stroke:#000000;stroke-width:4px;paint-order:stroke fill;filter:url(#titleShadow);letter-spacing:.2px}</style>
    </defs>
    <text class="fallbackTitle" text-anchor="middle">${tspans}</text>
  </svg>`);
}

function validatePosterUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Poster URL must use HTTPS.");
  const hostname = url.hostname.toLowerCase();
  const allowed = ALLOWED_POSTER_HOSTS.has(hostname) || hostname.endsWith(".simkl.in");
  if (!allowed) throw new Error(`Poster host is not allowed: ${hostname}`);
  return url;
}

async function downloadImage(url, fetchImpl) {
  validatePosterUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/svg+xml,*/*" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Image download returned HTTP ${response.status}.`);
    if (response.url) validatePosterUrl(response.url);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.toLowerCase().startsWith("image/")) {
      throw new Error(`Image download returned ${contentType} instead of an image.`);
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_POSTER_BYTES) throw new Error("Image download is larger than 12 MB.");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error("Image download was empty.");
    if (buffer.length > MAX_POSTER_BYTES) throw new Error("Image download is larger than 12 MB.");
    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

async function prepareTitleLogo(buffer) {
  const logo = sharp(buffer, { failOn: "error" })
    .ensureAlpha()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({
      width: BADGE_LAYOUT.logoMaxWidth,
      height: BADGE_LAYOUT.logoMaxHeight,
      fit: "inside",
      withoutEnlargement: false,
    });
  const output = await logo.png().toBuffer({ resolveWithObject: true });
  return {
    input: output.data,
    left: Math.round((POSTER_WIDTH - output.info.width) / 2),
    top: Math.max(454, Math.round(BADGE_LAYOUT.detailY - BADGE_LAYOUT.logoBottomGap - output.info.height)),
  };
}

function posterFileName(meta, badge) {
  const signature = JSON.stringify({
    version: POSTER_BADGE_STYLE_VERSION,
    id: meta.id,
    poster: meta.poster,
    name: badge.name || meta.name,
    logo: badge.logo || null,
    status: badge.status,
    episode: compactEpisodeLabel(badge.episode),
    latestEpisode: compactEpisodeLabel(badge.latestEpisode),
    nextEpisode: compactEpisodeLabel(badge.nextEpisode),
  });
  return `${createHash("sha256").update(signature).digest("hex").slice(0, 24)}.webp`;
}

export async function decorateCatalogPosters(catalog, badges, {
  outputDirectory,
  baseUrl,
  enabled = true,
  fetchImpl = fetch,
  concurrency = 4,
} = {}) {
  const next = structuredClone(catalog ?? { metas: [] });
  const warnings = [];
  if (!enabled || !baseUrl || !next.metas.length) {
    return { catalog: next, generated: 0, warnings };
  }

  const badgeById = new Map((badges ?? []).map((badge) => [badge.id, badge]));
  const posterDirectory = path.join(outputDirectory, "posters");
  await mkdir(posterDirectory, { recursive: true });
  let cursor = 0;
  let generated = 0;

  async function worker() {
    while (cursor < next.metas.length) {
      const index = cursor;
      cursor += 1;
      const meta = next.metas[index];
      const badge = badgeById.get(meta.id);
      if (!badge || !meta.poster) continue;

      try {
        const originalPoster = await downloadImage(meta.poster, fetchImpl);
        let titleComposite = { input: buildFallbackTitleSvg(badge.name || meta.name) };
        if (badge.logo) {
          try {
            const logo = await downloadImage(badge.logo, fetchImpl);
            titleComposite = await prepareTitleLogo(logo);
          } catch {
            // A missing logo must not block poster generation. The show name is
            // rendered as high-contrast text in the same reserved logo area.
          }
        }

        const filename = posterFileName(meta, badge);
        await sharp(originalPoster, { failOn: "error" })
          .resize(POSTER_WIDTH, POSTER_HEIGHT, { fit: "cover", position: "centre" })
          .composite([
            { input: buildLowerVignetteSvg(), gravity: "northwest" },
            titleComposite,
            { input: buildPosterBadgeSvg(badge), gravity: "northwest" },
          ])
          .webp({ quality: 90, effort: 5 })
          .toFile(path.join(posterDirectory, filename));
        meta.poster = `${baseUrl.replace(/\/$/, "")}/posters/${filename}`;
        generated += 1;
      } catch (error) {
        warnings.push({
          id: meta.id,
          name: meta.name,
          message: error.name === "AbortError" ? "Poster download timed out." : error.message,
        });
      }
    }
  }

  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, next.metas.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { catalog: next, generated, warnings };
}
