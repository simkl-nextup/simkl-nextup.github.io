import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const POSTER_WIDTH = 500;
const POSTER_HEIGHT = 750;
const POSTER_BADGE_STYLE_VERSION = 7;
const MAX_POSTER_BYTES = 12 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const ALLOWED_POSTER_HOSTS = new Set([
  "image.tmdb.org",
  "artworks.thetvdb.com",
  "simkl.in",
  "wsrv.nl",
]);

const STATUS_STYLES = {
  watching: {
    label: "NEW EPISODE",
    start: "#12D98A",
    middle: "#0FAE73",
    end: "#087A56",
  },
  plantowatch: {
    label: "PLAN TO WATCH",
    start: "#FFC247",
    middle: "#ED970A",
    end: "#B85C00",
  },
  completed: {
    label: "NEW SEASON",
    start: "#9B8CFF",
    middle: "#765BFF",
    end: "#5136D5",
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

function statusRibbonWidth(label) {
  return Math.max(270, Math.min(450, Math.round(label.length * 23 + 70)));
}

function infoRibbonWidth(cue, episode, rowCount) {
  if (rowCount === 2) return 238;
  return Math.max(255, Math.min(370, Math.round(cue.length * 12 + episode.length * 17 + 80)));
}

function infoRows({ status, episode, latestEpisode, nextEpisode }) {
  const fallback = compactEpisodeLabel(episode);
  const latest = compactEpisodeLabel(latestEpisode || episode);
  const next = compactEpisodeLabel(nextEpisode || episode);

  if (status === "watching") {
    return [
      {
        cue: "NEW",
        episode: latest || fallback,
        gradient: "newInfoGradient",
        accent: "#65FFD0",
      },
      {
        cue: "NEXT",
        episode: next || fallback,
        gradient: "nextInfoGradient",
        accent: "#63C7FF",
      },
    ];
  }

  return [{
    cue: status === "plantowatch" ? "LATEST" : "START",
    episode: latest || fallback,
    gradient: "episodeGradient",
    accent: status === "plantowatch" ? "#FFD66B" : "#B6A8FF",
  }];
}

function infoRibbonSvg(row, index, rowCount) {
  const top = 110;
  const bottom = 174;
  const middle = (top + bottom) / 2;
  const gap = 12;
  const x = rowCount === 2 ? index * (238 + gap) : 0;
  const width = infoRibbonWidth(row.cue, row.episode, rowCount);
  const body = width - 16;
  const cueWidth = Math.max(72, Math.round(row.cue.length * 12 + 24));
  const dividerX = Math.min(cueWidth, body - 94);
  const episodeX = dividerX + (body - dividerX) / 2;

  return `
    <g>
      <path d="M${x} ${top} H${x + body} L${x + width} ${middle} L${x + body} ${bottom} H${x} Z" fill="url(#${row.gradient})" stroke="#FFFFFF" stroke-opacity="0.34" stroke-width="2"/>
      <path d="M${x} ${top} H${x + 7} V${bottom} H${x} Z" fill="${row.accent}"/>
      <path d="M${x + 10} ${top + 2} H${x + body - 3}" stroke="#FFFFFF" stroke-opacity="0.18" stroke-width="2"/>
      <path d="M${x + dividerX} ${top + 12} V${bottom - 12}" stroke="#FFFFFF" stroke-opacity="0.38" stroke-width="2"/>
      <text x="${Math.round(x + dividerX / 2 + 4)}" y="${top + 40}" class="infoCue" text-anchor="middle">${escapeXml(row.cue)}</text>
      <text x="${Math.round(x + episodeX)}" y="${top + 42}" class="infoEpisode" text-anchor="middle">${escapeXml(row.episode)}</text>
    </g>`;
}

export function buildPosterBadgeSvg({ status, episode, latestEpisode, nextEpisode }) {
  const style = STATUS_STYLES[status];
  if (!style) throw new Error(`Unsupported poster badge status: ${status}`);
  const statusLabel = style.label;
  const rows = infoRows({ status, episode, latestEpisode, nextEpisode });
  if (!rows.every((row) => row.episode)) throw new Error("Poster badge episode label is required.");

  const statusWidth = statusRibbonWidth(statusLabel);
  const statusTop = 18;
  const statusBottom = 96;
  const statusPoint = statusWidth;
  const statusBody = statusWidth - 22;
  const statusMiddle = (statusTop + statusBottom) / 2;

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}" viewBox="0 0 ${POSTER_WIDTH} ${POSTER_HEIGHT}">
  <defs>
    <linearGradient id="statusGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${style.start}"/>
      <stop offset="52%" stop-color="${style.middle}"/>
      <stop offset="100%" stop-color="${style.end}"/>
    </linearGradient>
    <linearGradient id="newInfoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0F5A45" stop-opacity="0.96"/>
      <stop offset="58%" stop-color="#082F29" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#020E0D" stop-opacity="0.96"/>
    </linearGradient>
    <linearGradient id="nextInfoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#153753" stop-opacity="0.96"/>
      <stop offset="58%" stop-color="#0B2034" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#02070D" stop-opacity="0.96"/>
    </linearGradient>
    <linearGradient id="episodeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2B3038" stop-opacity="0.96"/>
      <stop offset="55%" stop-color="#141820" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#030407" stop-opacity="0.96"/>
    </linearGradient>
    <linearGradient id="glossGradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0"/>
      <stop offset="50%" stop-color="#FFFFFF" stop-opacity="0.50"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="statusClip">
      <path d="M0 ${statusTop} H${statusBody} L${statusPoint} ${statusMiddle} L${statusBody} ${statusBottom} H0 Z"/>
    </clipPath>
    <filter id="ribbonShadow" x="-30%" y="-35%" width="175%" height="200%">
      <feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#000000" flood-opacity="0.76"/>
    </filter>
    <filter id="textShadow" x="-30%" y="-40%" width="170%" height="200%">
      <feDropShadow dx="0" dy="2" stdDeviation="1.6" flood-color="#000000" flood-opacity="1"/>
    </filter>
    <style>
      .statusText,.infoCue,.infoEpisode{font-family:Arial,Helvetica,sans-serif;font-weight:900;fill:#FFFFFF;stroke:#000000;stroke-opacity:.98;paint-order:stroke fill;filter:url(#textShadow)}
      .statusText{font-size:40px;stroke-width:3.8px;letter-spacing:.1px}
      .infoCue{font-size:19px;stroke-width:2.7px;letter-spacing:.5px}
      .infoEpisode{font-size:30px;stroke-width:3px;letter-spacing:.1px}
    </style>
  </defs>
  <g filter="url(#ribbonShadow)">
    <path d="M0 ${statusTop} H${statusBody} L${statusPoint} ${statusMiddle} L${statusBody} ${statusBottom} H0 Z" fill="url(#statusGradient)" stroke="#FFFFFF" stroke-opacity="0.42" stroke-width="2"/>
    <path d="M${Math.round(statusWidth * 0.24)} ${statusTop - 18} L${Math.round(statusWidth * 0.53)} ${statusTop - 18} L${Math.round(statusWidth * 0.31)} ${statusBottom + 18} L${Math.round(statusWidth * 0.02)} ${statusBottom + 18} Z" fill="url(#glossGradient)" opacity="0.52" clip-path="url(#statusClip)"/>
    <path d="M0 ${statusTop + 2} H${statusBody - 2}" fill="none" stroke="#FFFFFF" stroke-opacity="0.72" stroke-width="3"/>
    <path d="M0 ${statusBottom - 2} H${statusBody - 2}" fill="none" stroke="#000000" stroke-opacity="0.46" stroke-width="3"/>
    <text x="${statusBody / 2}" y="70" class="statusText" text-anchor="middle">${escapeXml(statusLabel)}</text>
    ${rows.map((row, index) => infoRibbonSvg(row, index, rows.length)).join("")}
  </g>
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

async function downloadPoster(url, fetchImpl) {
  validatePosterUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,*/*" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Poster download returned HTTP ${response.status}.`);
    if (response.url) validatePosterUrl(response.url);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.toLowerCase().startsWith("image/")) {
      throw new Error(`Poster download returned ${contentType} instead of an image.`);
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_POSTER_BYTES) throw new Error("Poster download is larger than 12 MB.");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error("Poster download was empty.");
    if (buffer.length > MAX_POSTER_BYTES) throw new Error("Poster download is larger than 12 MB.");
    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

function posterFileName(meta, badge) {
  const signature = JSON.stringify({
    version: POSTER_BADGE_STYLE_VERSION,
    id: meta.id,
    poster: meta.poster,
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
        const originalPoster = await downloadPoster(meta.poster, fetchImpl);
        const filename = posterFileName(meta, badge);
        await sharp(originalPoster, { failOn: "error" })
          .resize(POSTER_WIDTH, POSTER_HEIGHT, { fit: "cover", position: "centre" })
          .composite([{ input: buildPosterBadgeSvg(badge), gravity: "northwest" }])
          .webp({ quality: 88, effort: 5 })
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
