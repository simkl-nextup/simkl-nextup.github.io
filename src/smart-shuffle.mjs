// Additional Account 2 Simkl movie catalog, independent from Home Releases.
// Interleave one chronologically-ordered fresh home release with two random
// Plan-to-Watch movies. The *entire* list remains eligible, not just six months.
import { randomInt } from 'node:crypto';
import { classifyHomeReleases, formatMovieDate, movieTags } from './movie-releases.mjs';

export const SMART_SHUFFLE_ID = 'simkl-movies-smart-shuffle-account2';
export const SMART_SHUFFLE_NAME = 'Movies · Smart Shuffle · Simkl';
export const SMART_PAGE_SIZE = 50;
export const RANDOM_BETWEEN_RELEASES = 2;

function plusMonthsBack(now, months) {
  const d = new Date(now);
  const year = d.getUTCFullYear(), month = d.getUTCMonth(), day = d.getUTCDate();
  const first = new Date(Date.UTC(year, month - months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0,10);
}

// Inject rng for deterministic tests. Live builds use crypto randomInt, not a
// fixed seed, so the uncategorized portion changes with each generated build.
export function shuffleList(values, rng = (limit) => randomInt(limit)) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng(i + 1));
    if (!Number.isInteger(j) || j < 0 || j > i) throw new Error('Random index out of range');
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function interleaveSmartMovies(entries, {
  now = new Date(), randomBetween = RANDOM_BETWEEN_RELEASES, rng,
} = {}) {
  if (!Number.isInteger(randomBetween) || randomBetween < 0 || randomBetween > 20) {
    throw new Error('randomBetween must be an integer from 0 to 20');
  }
  const today = new Date(now).toISOString().slice(0,10);
  const cutoff = plusMonthsBack(now, 6);
  const seen = new Set(), featured = [], ordinary = [];
  for (const entry of entries) {
    if (!entry?.meta?.id || seen.has(entry.meta.id)) continue;
    seen.add(entry.meta.id);
    const info = entry.release;
    const first = info?.firstHomeDate;
    const recent = first && first >= cutoff && first <= today && info?.released;
    const imminent = first && first > today && info && !info.released;
    if (recent || imminent) featured.push(entry);
    else ordinary.push(entry);
  }
  featured.sort((a,b) => Number(b.release.released) - Number(a.release.released)
    || (a.release.released
      ? b.release.sortDate.localeCompare(a.release.sortDate)
      : a.release.sortDate.localeCompare(b.release.sortDate))
    || a.meta.id.localeCompare(b.meta.id));
  const shuffled = shuffleList(ordinary, rng);
  const result = [];
  let i = 0, j = 0;
  while (i < featured.length || j < shuffled.length) {
    if (i < featured.length) result.push(featured[i++]);
    for (let k=0; k<randomBetween && j<shuffled.length; k++) result.push(shuffled[j++]);
    // Once releases run out, just append the remaining shuffled titles.
    if (i >= featured.length) { result.push(...shuffled.slice(j)); break; }
    // If randomBetween=0, release titles come first and random entries still
    // remain present at the end; never silently lose those entries.
  }
  return { entries: result, featured: featured.length, shuffled: ordinary.length };
}

function posterFor(movie, tmdb, imdb) {
  if (imdb) return `https://btttr.cc/poster/imdb/poster-default/${imdb}.jpg?tag=none`;
  if (tmdb?.poster_path) return `https://image.tmdb.org/t/p/w500${tmdb.poster_path}`;
  if (movie.poster) return `https://wsrv.nl/?url=https://simkl.in/posters/${movie.poster}_m.webp&q=90`;
  return 'https://simkl.in/poster_no_pic_c.png';
}

function oldReleaseTags(release) {
  const tags = movieTags(release);
  // Old movie releases need the year, otherwise "OCT 6" falsely looks new.
  if (release.released) {
    const year = release.event.date.slice(2,4);
    tags.main = `${formatMovieDate(release.event.date)} '${year}`;
    tags.compactDate = true;
  }
  return tags;
}

export function buildSmartEntries(movies, cacheMovies = {}, { now = new Date() } = {}) {
  const result = [], skipped = [];
  for (const row of movies) {
    if (row.status && row.status !== 'plantowatch') continue;
    const movie = row.movie ?? {};
    const ids = movie.ids ?? {};
    const simklId = ids.simkl ?? ids.simkl_id;
    const cached = cacheMovies[String(simklId)]?.tmdb ?? null;
    const imdb = [cached?.imdb_id, cached?.external_ids?.imdb_id, ids.imdb]
      .find(value => typeof value === 'string' && /^tt\d+$/.test(value));
    const tmdbId = cached?.id || ids.tmdb;
    const id = imdb || (tmdbId && /^\d+$/.test(String(tmdbId)) ? `tmdb:${tmdbId}` : simklId ? `simkl:${simklId}` : null);
    if (!id || (!cached?.title && !movie.title)) {
      skipped.push({ id: simklId, reason: 'missing ID or title' }); continue;
    }
    // The Home Releases row intentionally applies a six-month cutoff. Here
    // we inspect all available history so old movies can still carry tags.
    const release = cached?.release_dates ? classifyHomeReleases(cached.release_dates, {
      now, comingSoonDays: 30, releaseHistoryMonths: 2400,
    }) : null;
    const tags = release ? (release.firstHomeDate < plusMonthsBack(now, 6) ? oldReleaseTags(release) : movieTags(release)) : null;
    const meta = {
      id, type:'movie', name: cached?.title || movie.title,
      poster: posterFor(movie, cached, imdb),
      ...(cached?.backdrop_path ? { background:`https://image.tmdb.org/t/p/w1280${cached.backdrop_path}` } : {}),
      ...(movie.year || cached?.release_date ? { year: Number(movie.year || cached.release_date?.slice(0,4)) } : {}),
      ...(cached?.genres?.length ? { genres: cached.genres.map(g=>g.name).filter(Boolean) } : {}),
      ...(cached?.runtime ? {runtime:`${cached.runtime} min`} : {}),
      ...(tags ? {releaseInfo:tags.label} : {}),
      description: `${release ? `${tags.label} · ${formatMovieDate(release.event.date)} ${release.event.date.slice(0,4)} (${release.event.country || 'international'}). ` : 'Home release date not verified. '}${cached?.overview || ''}`.trim(),
      links: [
        ...(simklId ? [{name:'View on Simkl',category:'simkl',url:`https://simkl.com/movies/${simklId}`}] : []),
        ...(tmdbId ? [{name:'View on TMDB',category:'tmdb',url:`https://www.themoviedb.org/movie/${tmdbId}`}] : []),
      ],
    };
    result.push({ meta, release, tags, tmdbPoster:cached?.poster_path ? `https://image.tmdb.org/t/p/w500${cached.poster_path}` : null });
  }
  return { entries:result, skipped };
}

export function paginateSmartCatalog(entries, pageSize = SMART_PAGE_SIZE) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Invalid page size');
  const pages = [];
  // Publish skip=0 and base even for an empty catalog.
  for (let skip=0; skip<Math.max(entries.length,1); skip += pageSize) {
    pages.push({ skip, metas:entries.slice(skip, skip+pageSize) });
  }
  return pages;
}
