// BetterPosters is the BASE IMAGE only. No overlays are sent to BetterPosters.
// These top tags are locally injected into its finished poster, like the
// existing anime top tab + dub-style left chip, without any PTW bottom badge.
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const W = 500;
const H = 750;
const MAX_BYTES = 12 * 1024 * 1024;
function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
export function movieOverlaySvg(tags) {
  const main = escapeXml(tags.main);
  const sub = escapeXml(tags.sub);
  const chip = escapeXml(tags.chip);
  const mainSize = tags.main.length > 15 ? 34 : 42;
  const subSize = tags.sub.length > 29 ? 21 : 26;
  const chipWidth = Math.min(390, Math.max(170, Math.ceil(tags.chip.length * 17 + 36)));
  const chipSize = tags.chip.length > 18 ? 23 : 27;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><filter id="shadow"><feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#000" flood-opacity=".75"/></filter></defs>
    <g filter="url(#shadow)">
      <rect x="7" y="0" width="486" height="102" rx="13" fill="#10283a" fill-opacity=".95" stroke="#ffffff" stroke-opacity=".4" stroke-width="2"/>
      <rect x="0" y="115" width="${chipWidth}" height="51" rx="10" fill="${tags.label === 'COMING SOON' ? '#A96B16' : '#1673C4'}" fill-opacity=".96"/>
    </g>
    <g font-family="Arial, Helvetica, sans-serif" font-weight="900" fill="#fff" text-anchor="middle" paint-order="stroke fill" stroke="#000" stroke-opacity=".75" stroke-width="2">
      <text x="250" y="49" font-size="${mainSize}">${main}</text>
      <text x="250" y="85" font-size="${subSize}">${sub}</text>
      <text x="${chipWidth / 2}" y="150" font-size="${chipSize}">${chip}</text>
    </g>
  </svg>`);
}

function safeSource(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['btttr.cc', 'image.tmdb.org'].includes(parsed.hostname)) {
    throw new Error(`Movie poster host not permitted: ${parsed.hostname}`);
  }
  return url;
}
async function fetchPoster(url, fetchImpl) {
  safeSource(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'image/jpeg,image/webp,image/png,*/*' } });
    if (!response.ok) throw new Error(`Poster returned HTTP ${response.status}`);
    if (response.url) safeSource(response.url);
    const mime = response.headers?.get?.('content-type') || '';
    if (mime && !mime.startsWith('image/')) throw new Error(`Poster returned ${mime}`);
    const size = Number(response.headers?.get?.('content-length') || 0);
    if (size > MAX_BYTES) throw new Error('Poster exceeds size limit');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Invalid poster size');
    return bytes;
  } finally { clearTimeout(timer); }
}

export async function renderMoviePosters(entries, { outputDirectory, baseUrl, fetchImpl = fetch } = {}) {
  const directory = path.join(outputDirectory, 'posters', 'movie-releases');
  await mkdir(directory, { recursive: true });
  const warnings = [];
  const result = Array(entries.length);
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const index = cursor++;
      const entry = entries[index];
      const meta = structuredClone(entry.meta);
    let bytes;
    try {
      bytes = await fetchPoster(meta.poster, fetchImpl);
    } catch (error) {
      // BetterPosters is an optional base-image provider: if it is down, use
      // TMDB artwork while preserving the release tags and movie catalog.
      const tmdbPoster = entry.tmdbPoster;
      if (!tmdbPoster) {
        throw new Error(`Cannot publish ${meta.id} without its tagged poster: ${error.message}`);
      }
      try {
        bytes = await fetchPoster(tmdbPoster, fetchImpl);
        warnings.push({ id: meta.id, warning: `BetterPosters fallback to TMDB: ${error.message}` });
      } catch (fallbackError) {
        throw new Error(`Cannot publish ${meta.id}: BetterPosters and TMDB artwork unavailable (${fallbackError.message})`);
      }
    }
    try {
      const signature = JSON.stringify({ v: 2, source: meta.poster, tags: entry.tags, tmdbPoster: entry.tmdbPoster });
      const name = `${createHash('sha256').update(signature).update(bytes).digest('hex').slice(0, 24)}.webp`;
      const overlay = movieOverlaySvg(entry.tags);
      // Make the base opaque and preserve BetterPosters' own lower styling.
      const base = await sharp(bytes, { failOn: 'error' }).resize(W, H, { fit: 'cover' }).png().toBuffer();
      const rendered = await sharp(base).composite([{ input: overlay, left: 0, top: 0 }])
        .webp({ quality: 91, effort: 5 }).toBuffer();
      await writeFile(path.join(directory, name), rendered);
      meta.poster = `${baseUrl.replace(/\/$/, '')}/posters/movie-releases/${name}`;
    } catch (error) {
      throw new Error(`Cannot publish ${meta.id} without the required release tags: ${error.message}`);
    }
      result[index] = meta;
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, () => worker()));
  return { metas: result, warnings };
}
