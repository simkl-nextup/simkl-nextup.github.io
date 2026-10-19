// BetterPosters is the BASE IMAGE only. No overlays are sent to BetterPosters.
// These top tags are locally injected into its finished poster, like the
// existing anime top tab + dub-style left chip, without any PTW bottom badge.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { posterTints } from './poster-tags.mjs';

import { composeMovieReleasePoster, TAG_STYLE_VERSION } from './poster-tags.mjs';
import { normalizePosterStyle } from './poster-style.mjs';

const MAX_BYTES = 12 * 1024 * 1024;
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

export async function renderMoviePosters(entries, { outputDirectory, baseUrl, fetchImpl = fetch, tvStyle, animeStyle, posterFolder = "movie-releases", skipFailures = false, studioSamples = 0 } = {}) {
  const directory = path.join(outputDirectory, 'posters', posterFolder);
  await mkdir(directory, { recursive: true });
  const warnings = [];
  const result = Array(entries.length);
  const studio = Array(entries.length).fill(null);
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const index = cursor++;
      const entry = entries[index];
      try {
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
      const signature = JSON.stringify({ v: 3, tagRenderer: TAG_STYLE_VERSION, source: meta.poster, tags: entry.tags, tmdbPoster: entry.tmdbPoster, tv: normalizePosterStyle(tvStyle), anime: normalizePosterStyle(animeStyle) });
      const name = `${createHash('sha256').update(signature).update(bytes).digest('hex').slice(0, 24)}.webp`;
      // Import the *same* top tab and dub-chip rendering code used by the
      // live TV and anime posters. BetterPosters supplies the base image.
      const rendered = await composeMovieReleasePoster({
        poster: bytes, tags: entry.tags, tvStyle, animeStyle,
      });
      await writeFile(path.join(directory, name), rendered);
      meta.poster = `${baseUrl.replace(/\/$/, '')}/posters/${posterFolder}/${name}`;
      if (index < studioSamples) {
        try {
          const baseName = `base-${name}`;
          const previewDir = path.join(outputDirectory, 'studio', 'base', posterFolder);
          await mkdir(previewDir, { recursive: true });
          await writeFile(path.join(previewDir, baseName),
            await sharp(bytes).resize(500, 750, { fit: 'cover', position: 'centre' }).webp({quality: 88}).toBuffer());
          studio[index] = {
            name: meta.name, id: meta.id, tags: entry.tags,
            poster: `account-2/studio/base/${posterFolder}/${baseName}`,
            tints: await posterTints(bytes),
          };
        } catch (err) {
          warnings.push({ id: meta.id, warning: `Studio preview unavailable: ${err.message}` });
        }
      }
    } catch (error) {
      throw new Error(`Cannot publish ${meta.id} without the required release tags: ${error.message}`);
    }
      result[index] = meta;
      } catch (error) {
        if (!skipFailures) throw error;
        warnings.push({ id: entry.meta?.id, warning: error.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, () => worker()));
  return { metas: result.filter(Boolean), warnings, studio: studio.filter(Boolean) };
}
