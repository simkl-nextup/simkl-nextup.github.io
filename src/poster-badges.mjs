import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const POSTER_WIDTH = 500;
const POSTER_HEIGHT = 750;
const MAX_POSTER_BYTES = 12 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const ALLOWED_POSTER_HOSTS = new Set([
  "image.tmdb.org",
  "simkl.in",
  "wsrv.nl",
]);

const STATUS_STYLES = {
  watching: { label: "WATCHING", color: "#6D5DFC" },
  plantowatch: { label: "PLAN TO WATCH", color: "#D88A00" },
  completed: { label: "NEW EPISODE", color: "#139A67" },
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

function pillWidth(label, minimum) {
  return Math.max(minimum, Math.round(label.length * 14.2 + 38));
}

export function buildPosterBadgeSvg({ status, episode }) {
  const style = STATUS_STYLES[status];
  if (!style) throw new Error(`Unsupported poster badge status: ${status}`);
  const statusLabel = style.label;
  const episodeLabel = normalizedEpisodeLabel(episode);
  if (!episodeLabel) throw new Error("Poster badge episode label is required.");

  const statusWidth = pillWidth(statusLabel, 142);
  const episodeWidth = pillWidth(episodeLabel, 92);
  const episodeX = 18;
  const episodeY = 74;

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}" viewBox="0 0 ${POSTER_WIDTH} ${POSTER_HEIGHT}">
  <defs>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000000" flood-opacity="0.62"/>
    </filter>
  </defs>
  <g filter="url(#shadow)" font-family="Inter, Arial, Helvetica, sans-serif" font-size="21" font-weight="800" letter-spacing="0.6">
    <rect x="18" y="18" width="${statusWidth}" height="46" rx="23" fill="${style.color}" fill-opacity="0.96" stroke="#FFFFFF" stroke-opacity="0.22"/>
    <text x="${18 + statusWidth / 2}" y="48" fill="#FFFFFF" text-anchor="middle">${escapeXml(statusLabel)}</text>
    <rect x="${episodeX}" y="${episodeY}" width="${episodeWidth}" height="46" rx="23" fill="#090B10" fill-opacity="0.91" stroke="#FFFFFF" stroke-opacity="0.28"/>
    <text x="${episodeX + episodeWidth / 2}" y="${episodeY + 30}" fill="#FFFFFF" text-anchor="middle">${escapeXml(episodeLabel)}</text>
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
    version: 1,
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
