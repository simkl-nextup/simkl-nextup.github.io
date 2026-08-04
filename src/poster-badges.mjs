import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const POSTER_WIDTH = 500;
const POSTER_HEIGHT = 750;
const POSTER_BADGE_STYLE_VERSION = 5;
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

function normalizedEpisodeLabel(value) {
  const label = String(value ?? "").trim();
  const seasonEpisode = label.match(/^S(\d+)E(\d+)$/i);
  if (seasonEpisode) {
    return `S${seasonEpisode[1].padStart(2, "0")} · E${seasonEpisode[2].padStart(2, "0")}`;
  }
  const episode = label.match(/^Ep\.\s*(\d+)$/i);
  if (episode) return `EP ${episode[1]}`;
  return label.toUpperCase().slice(0, 18);
}

function statusRibbonWidth(label) {
  return Math.max(260, Math.round(label.length * 21.5 + 68));
}

function episodeRibbonWidth(label) {
  return Math.max(144, Math.round(label.length * 18 + 48));
}

export function buildPosterBadgeSvg({ status, episode }) {
  const style = STATUS_STYLES[status];
  if (!style) throw new Error(`Unsupported poster badge status: ${status}`);
  const statusLabel = style.label;
  const episodeLabel = normalizedEpisodeLabel(episode);
  if (!episodeLabel) throw new Error("Poster badge episode label is required.");

  const statusWidth = statusRibbonWidth(statusLabel);
  const episodeWidth = episodeRibbonWidth(episodeLabel);
  const statusTop = 18;
  const statusBottom = 96;
  const statusPoint = statusWidth;
  const statusBody = statusWidth - 22;
  const episodeTop = 108;
  const episodeBottom = 176;
  const episodePoint = episodeWidth;
  const episodeBody = episodeWidth - 18;
  const statusMiddle = (statusTop + statusBottom) / 2;
  const episodeMiddle = (episodeTop + episodeBottom) / 2;

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}" viewBox="0 0 ${POSTER_WIDTH} ${POSTER_HEIGHT}">
  <defs>
    <linearGradient id="statusGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${style.start}"/>
      <stop offset="52%" stop-color="${style.middle}"/>
      <stop offset="100%" stop-color="${style.end}"/>
    </linearGradient>
    <linearGradient id="episodeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#252A35"/>
      <stop offset="52%" stop-color="#10131A"/>
      <stop offset="100%" stop-color="#020306"/>
    </linearGradient>
    <linearGradient id="glossGradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0"/>
      <stop offset="50%" stop-color="#FFFFFF" stop-opacity="0.52"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="statusClip">
      <path d="M0 ${statusTop} H${statusBody} L${statusPoint} ${statusMiddle} L${statusBody} ${statusBottom} H0 Z"/>
    </clipPath>
    <clipPath id="episodeClip">
      <path d="M0 ${episodeTop} H${episodeBody} L${episodePoint} ${episodeMiddle} L${episodeBody} ${episodeBottom} H0 Z"/>
    </clipPath>
    <filter id="shadow" x="-30%" y="-35%" width="170%" height="190%">
      <feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#000000" flood-opacity="0.72"/>
    </filter>
  </defs>
  <g filter="url(#shadow)" font-family="Arial Black, Inter, Arial, Helvetica, sans-serif" font-weight="900">
    <path d="M0 ${statusTop} H${statusBody} L${statusPoint} ${statusMiddle} L${statusBody} ${statusBottom} H0 Z" fill="url(#statusGradient)" stroke="#FFFFFF" stroke-opacity="0.32" stroke-width="1.5"/>
    <path d="M${Math.round(statusWidth * 0.24)} ${statusTop - 18} L${Math.round(statusWidth * 0.53)} ${statusTop - 18} L${Math.round(statusWidth * 0.31)} ${statusBottom + 18} L${Math.round(statusWidth * 0.02)} ${statusBottom + 18} Z" fill="url(#glossGradient)" opacity="0.62" clip-path="url(#statusClip)"/>
    <path d="M0 ${statusTop + 2} H${statusBody - 2}" fill="none" stroke="#FFFFFF" stroke-opacity="0.58" stroke-width="3"/>
    <path d="M0 ${statusBottom - 2} H${statusBody - 2}" fill="none" stroke="#000000" stroke-opacity="0.24" stroke-width="3"/>
    <text x="${statusBody / 2}" y="70" fill="#FFFFFF" stroke="#000000" stroke-opacity="0.2" stroke-width="1.2" paint-order="stroke fill" text-anchor="middle" font-size="39" letter-spacing="0.15">${escapeXml(statusLabel)}</text>
    <path d="M0 ${episodeTop} H${episodeBody} L${episodePoint} ${episodeMiddle} L${episodeBody} ${episodeBottom} H0 Z" fill="url(#episodeGradient)" stroke="#FFFFFF" stroke-opacity="0.36" stroke-width="1.5"/>
    <path d="M${Math.round(episodeWidth * 0.18)} ${episodeTop - 12} L${Math.round(episodeWidth * 0.5)} ${episodeTop - 12} L${Math.round(episodeWidth * 0.28)} ${episodeBottom + 12} L0 ${episodeBottom + 12} Z" fill="url(#glossGradient)" opacity="0.34" clip-path="url(#episodeClip)"/>
    <path d="M0 ${episodeTop + 2} H${episodeBody - 2}" fill="none" stroke="#FFFFFF" stroke-opacity="0.42" stroke-width="2.5"/>
    <text x="${episodeBody / 2}" y="${episodeTop + 47}" fill="#FFFFFF" stroke="#000000" stroke-opacity="0.28" stroke-width="1.1" paint-order="stroke fill" text-anchor="middle" font-size="35" letter-spacing="0.1">${escapeXml(episodeLabel)}</text>
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
    episode: normalizedEpisodeLabel(badge.episode),
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
