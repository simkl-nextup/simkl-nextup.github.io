// Adds the movie home-release catalog INSIDE account 2's existing manifest.
// Must run after scripts/update.mjs, which regenerates public/account-2.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOVIE_CATALOG_ID, MOVIE_CATALOG_NAME, COMING_SOON_DAYS, buildMovieCatalog } from '../src/movie-releases.mjs';
import { renderMoviePosters } from '../src/movie-posters.mjs';
import { loadPosterConfig } from '../src/poster-style.mjs';
import { appendPublicPath, deriveBaseUrl } from '../src/site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY_MS = 86400000;
const VERSION = 1;

async function getJson(fetchImpl, url, headers = {}) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json', ...headers } });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; }
  catch { throw new Error(`Non-JSON response from ${new URL(url).hostname}: HTTP ${response.status}`); }
  if (!response.ok) {
    const error = new Error(`${new URL(url).hostname}: HTTP ${response.status}: ${data?.status_message || data?.message || data?.error || 'Unknown error'}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function loadCache(file) {
  try {
    const json = JSON.parse(await readFile(file, 'utf8'));
    return json.version === VERSION && json.movies && typeof json.movies === 'object' ? json : { version: VERSION, movies: {} };
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return { version: VERSION, movies: {} };
    throw error;
  }
}

function stale(cached, now) {
  if (!cached?.fetchedAt) return true;
  const time = Date.parse(cached.fetchedAt);
  if (!Number.isFinite(time)) return true;
  const oldestRelevantRelease = cached?.tmdb?.release_dates?.results?.flatMap((v) => v.release_dates ?? [])
    .filter((v) => v.type === 4 || v.type === 5)
    .map((v) => Date.parse(v.release_date))
    .filter(Number.isFinite).sort((a, b) => b - a)[0];
  const oldRelease = Number.isFinite(oldestRelevantRelease) && now.getTime() - oldestRelevantRelease > 60 * DAY_MS;
  return now.getTime() - time > (oldRelease ? 72 : 3) * 3600 * 1000;
}

async function tmdbDetails(movie, { token, fetchImpl, clientId }) {
  const auth = { Authorization: `Bearer ${token}` };
  let ids = movie.ids ?? {};
  if (!ids.tmdb && !ids.imdb && movie.simklId) {
    const url = new URL(`https://api.simkl.com/movies/${encodeURIComponent(movie.simklId)}`);
    url.searchParams.set('client_id', clientId);
    const result = await getJson(fetchImpl, url, { 'simkl-api-key': clientId });
    ids = { ...result?.ids, ...ids };
  }
  let id = ids.tmdb;
  if (!id && /^tt\d+$/.test(String(ids.imdb ?? ''))) {
    const found = await getJson(fetchImpl,
      `https://api.themoviedb.org/3/find/${encodeURIComponent(ids.imdb)}?external_source=imdb_id`, auth);
    id = found?.movie_results?.[0]?.id;
  }
  if (!id || !/^\d+$/.test(String(id))) return null;
  const tmdb = await getJson(fetchImpl,
    `https://api.themoviedb.org/3/movie/${encodeURIComponent(id)}?append_to_response=release_dates,external_ids&language=en-US`, auth);
  if (!tmdb?.id || !tmdb.release_dates || !Array.isArray(tmdb.release_dates.results)) {
    throw new Error(`TMDB ${id} lacks the release_dates response`);
  }
  tmdb.imdb_id ||= ids.imdb ?? tmdb.external_ids?.imdb_id ?? null;
  return tmdb;
}

function normalizeSimklMovies(payload) {
  if (!Array.isArray(payload?.movies)) throw new Error('Simkl movies Plan to Watch response is missing its movies array.');
  return payload.movies.filter((row) => !row.status || row.status === 'plantowatch').map((row) => {
    const movie = row.movie ?? {};
    const id = movie.ids?.simkl ?? movie.ids?.simkl_id;
    return {
      status: row.status || 'plantowatch',
      simklId: id == null ? null : String(id),
      title: movie.title,
      ids: movie.ids || {},
    };
  }).filter((movie) => movie.simklId);
}

export async function refreshMovieRow({
  clientId, accessToken, tmdbToken, fetchImpl = fetch,
  now = new Date(), comingSoonDays = COMING_SOON_DAYS,
  maxItems = 50, outputDirectory = path.join(root, 'public/account-2'),
  stateFile = path.join(root, 'state/account-2/movie-release-state.json'),
  baseUrl = appendPublicPath(deriveBaseUrl({
    explicitBaseUrl: process.env.PUBLIC_BASE_URL,
    githubRepository: process.env.GITHUB_REPOSITORY,
  }), 'account-2'),
} = {}) {
  if (!clientId || !accessToken) throw new Error('Account 2 Simkl token and client ID are required for the movie row.');
  if (!tmdbToken) throw new Error('TMDB_READ_ACCESS_TOKEN is required to distinguish digital from physical releases.');
  if (!baseUrl?.startsWith('https://')) throw new Error('The movie row needs a valid HTTPS public base URL.');
  const listUrl = new URL('https://api.simkl.com/sync/all-items/movies/plantowatch');
  listUrl.searchParams.set('client_id', clientId);
  const payload = await getJson(fetchImpl, listUrl, {
    'simkl-api-key': clientId, Authorization: `Bearer ${accessToken}`,
  });
  const movies = normalizeSimklMovies(payload);
  const cache = await loadCache(stateFile);
  const warnings = [];
  const nextCache = { version: VERSION, movies: {} };
  // Only watchlist items are carried forward. Removed / watched movies cannot
  // stay in the row merely because the API cache still holds their old data.
  const resolved = [];
  for (let i = 0; i < movies.length; i += 4) {
    const batch = movies.slice(i, i + 4);
    const results = await Promise.all(batch.map(async (movie) => {
      const cached = cache.movies[movie.simklId];
      let tmdb = cached?.tmdb ?? null;
      let fetchedAt = cached?.fetchedAt;
      if (stale(cached, now)) {
        try {
          tmdb = await tmdbDetails(movie, { token: tmdbToken, fetchImpl, clientId });
          fetchedAt = now.toISOString();
        } catch (error) {
          if (error.status === 401 || error.status === 403) throw error;
          warnings.push(`TMDB lookup ${movie.title || movie.simklId}: ${error.message}`);
          // Retry next time instead of incorrectly caching a failed request.
          if (!tmdb) fetchedAt = null;
        }
      }
      nextCache.movies[movie.simklId] = { fetchedAt, tmdb };
      return { ...movie, tmdb };
    }));
    resolved.push(...results);
  }
  const entries = buildMovieCatalog(resolved, { now, comingSoonDays, maxItems });
  // Read live Studio settings every refresh; the TV tab and anime dub chip
  // may be configured independently by the user.
  const posterConfig = await loadPosterConfig(path.join(root, 'config/poster-style.json'));
  const rendered = await renderMoviePosters(entries, {
    outputDirectory, baseUrl, fetchImpl,
    tvStyle: posterConfig.tv, animeStyle: posterConfig.anime,
  });
  const manifestPath = path.join(outputDirectory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.id !== 'community.simkl.new-tv-episodes.account2'
      || manifest.catalogs?.[0]?.id !== 'simkl-new-tv-episodes-account2') {
    throw new Error('Refusing to attach movies to a different addon: account 2 TV manifest was not found.');
  }
  if (!manifest.types.includes('movie')) manifest.types.push('movie');
  manifest.catalogs = manifest.catalogs.filter((catalog) => catalog.id !== MOVIE_CATALOG_ID);
  manifest.catalogs.push({ type: 'movie', id: MOVIE_CATALOG_ID, name: MOVIE_CATALOG_NAME });
  if (!manifest.idPrefixes.includes('tmdb:')) manifest.idPrefixes.push('tmdb:');
  manifest.description += ' Includes a second movie row showing digital/physical home releases and 30-day Coming Soon titles from Account 2 Plan to Watch.';
  // Do not expose private Simkl/TMDB account information or cache in public.
  const movieDir = path.join(outputDirectory, 'catalog', 'movie');
  const metaDir = path.join(outputDirectory, 'meta', 'movie');
  await mkdir(movieDir, { recursive: true });
  await mkdir(metaDir, { recursive: true });
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path.join(movieDir, `${MOVIE_CATALOG_ID}.json`), json({ metas: rendered.metas }));
  for (const meta of rendered.metas) {
    if (!/^(?:tt\d+|tmdb:\d+)$/.test(meta.id)) throw new Error(`Unexpected movie ID ${meta.id}`);
    await writeFile(path.join(metaDir, `${meta.id}.json`), json({ meta }));
  }
  await writeFile(manifestPath, json(manifest));
  const statusPath = path.join(outputDirectory, 'status.json');
  const status = JSON.parse(await readFile(statusPath, 'utf8'));
  status.movieRow = {
    catalogId: MOVIE_CATALOG_ID,
    trackedPlanToWatch: movies.length,
    published: rendered.metas.length,
    released: entries.filter((e) => e.release.released).length,
    comingSoon: entries.filter((e) => !e.release.released).length,
    comingSoonDays,
    releaseHistoryMonths: 6,
    releaseProvider: 'TMDB (type 4 digital / type 5 physical, all countries, US preferred)',
    skippedByReleaseRules: resolved.length - buildMovieCatalog(resolved, { now, comingSoonDays, maxItems: Infinity }).length,
    warnings: [...warnings, ...rendered.warnings.map((w) => `${w.id}: ${w.warning}`)].slice(0, 25),
  };
  await writeFile(statusPath, json(status));
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, json(nextCache));
  return { movies: rendered.metas, status: status.movieRow };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await refreshMovieRow({
      clientId: process.env.SIMKL_CLIENT_ID_2 || process.env.SIMKL_CLIENT_ID,
      accessToken: process.env.SIMKL_ACCESS_TOKEN_2,
      tmdbToken: process.env.TMDB_READ_ACCESS_TOKEN,
      comingSoonDays: Number(process.env.MOVIE_COMING_SOON_DAYS || COMING_SOON_DAYS),
      maxItems: Number(process.env.MAX_MOVIE_ITEMS || 50),
    });
    console.log(`Account 2 movie row: ${result.movies.length} published (${result.status.released} released, ${result.status.comingSoon} coming soon).`);
    for (const warning of result.status.warnings) console.warn(warning);
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}
