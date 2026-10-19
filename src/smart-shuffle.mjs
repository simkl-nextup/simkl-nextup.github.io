// Additional Account 2 Simkl movie catalog, independent from Home Releases.
// One movie from the *published* Home Releases row followed by two randomly
// selected movies from the rest of Plan to Watch, repeated until all are used.
// Home Releases movies inherit their finished posters. Theatrical-only new
// films may get a cinema chip without becoming featured/release-slot items.
import { randomInt } from 'node:crypto';

export const SMART_SHUFFLE_ID = 'simkl-movies-smart-shuffle-account2';
export const SMART_SHUFFLE_NAME = 'Movies · Smart Shuffle · Simkl';
export const SMART_PAGE_SIZE = 50;
export const RANDOM_BETWEEN_RELEASES = 2;

// Live builds use crypto randomInt, not a fixed seed. A new sequence is
// generated on every successful scheduled build, not every client request.
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
  randomBetween = RANDOM_BETWEEN_RELEASES, rng,
} = {}) {
  if (!Number.isInteger(randomBetween) || randomBetween < 0 || randomBetween > 20) {
    throw new Error('randomBetween must be an integer from 0 to 20');
  }
  const seen = new Set(), featured = [], ordinary = [];
  for (const entry of entries) {
    if (!entry?.meta?.id || seen.has(entry.meta.id)) continue;
    seen.add(entry.meta.id);
    // The source of truth is actual membership in the published Home
    // Releases row (not an independently calculated or historical date).
    if (Number.isInteger(entry.homeRank) && entry.homeRank >= 0) featured.push(entry);
    else ordinary.push(entry);
  }
  // Preserve Home Releases' published order: released newest first, then
  // confirmed Coming Soon, nearest first.
  featured.sort((a, b) => a.homeRank - b.homeRank);
  const shuffled = shuffleList(ordinary, rng);
  const result = [];
  let i = 0, j = 0;
  while (i < featured.length || j < shuffled.length) {
    if (i < featured.length) result.push(featured[i++]);
    for (let k = 0; k < randomBetween && j < shuffled.length; k++) result.push(shuffled[j++]);
    if (i >= featured.length) { result.push(...shuffled.slice(j)); break; }
  }
  return { entries: result, featured: featured.length, shuffled: ordinary.length };
}

function posterFor(movie, tmdb, imdb) {
  if (imdb) return `https://btttr.cc/poster/imdb/poster-default/${imdb}.jpg?tag=none`;
  if (tmdb?.poster_path) return `https://image.tmdb.org/t/p/w500${tmdb.poster_path}`;
  if (movie.poster) return `https://wsrv.nl/?url=https://simkl.in/posters/${movie.poster}_m.webp&q=90`;
  return 'https://simkl.in/poster_no_pic_c.png';
}

// Cinema tags apply ONLY to movies on the Plan to Watch list and NOT in the
// already-published Home Releases row. A scheduled premiere is distinct from
// a recent theatrical premiere; neither counts as a home release.
export const THEATRICAL_RECENCY_DAYS = 60;
export const THEATRICAL_UPCOMING_DAYS = 90;
function validReleaseDay(value) {
  const date=String(value||'').slice(0,10);
  if(!/^\d{4}-\d\d-\d\d$/.test(date))return null;
  const parsed=Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0,10)===date?date:null;
}
const CINEMA_KINDS={1:'PREMIERE',2:'LIMITED',3:'THEATRICAL'};
export function theatricalPremiere(tmdb, {
  now=new Date(),pastDays=THEATRICAL_RECENCY_DAYS,futureDays=THEATRICAL_UPCOMING_DAYS,
}={}) {
  const current=now instanceof Date?now:new Date(now);
  if(!Number.isFinite(current.getTime()))return null;
  const today=current.toISOString().slice(0,10);
  const from=new Date(Date.parse(`${today}T00:00:00Z`)-pastDays*86400000).toISOString().slice(0,10);
  const through=new Date(Date.parse(`${today}T00:00:00Z`)+futureDays*86400000).toISOString().slice(0,10);
  const cinemas=[];
  for(const region of tmdb?.release_dates?.results||[]) {
    for(const event of region.release_dates||[]) {
      const date=validReleaseDay(event.release_date),type=Number(event.type);
      if(!date)continue;
      // If a legitimate digital or physical release happened anywhere, this
      // belongs to Home Releases (if eligible), never a cinema-only label.
      if([4,5].includes(type) && date<=today)return null;
      if(CINEMA_KINDS[type])cinemas.push({date,type,kind:CINEMA_KINDS[type],country:String(region.iso_3166_1||'').toUpperCase()});
    }
  }
  // Reissues / late country rollouts of old films must not appear as upcoming.
  // Consider real theatrical dates first; festival-only PREMIERE is fallback.
  const commercial=cinemas.filter(e=>[2,3].includes(e.type));
  const pool=commercial.length?commercial:cinemas;
  if(!pool.length)return null;
  const firstWorldwide=pool.reduce((min,e)=>e.date<min?e.date:min,pool[0].date);
  if(firstWorldwide<from)return null;
  const candidates=pool.filter(e=>e.date>=from && e.date<=through);
  // When a movie already opened abroad recently but has a future US opening,
  // honor the confirmed US date. Otherwise choose the most relevant window.
  const upcomingUS=candidates.filter(e=>e.country==='US' && e.date>today)
    .sort((a,b)=>a.date.localeCompare(b.date));
  const pastUS=candidates.filter(e=>e.country==='US' && e.date<=today)
    .sort((a,b)=>b.date.localeCompare(a.date));
  const upcomingGlobal=candidates.filter(e=>e.date>today)
    .sort((a,b)=>a.date.localeCompare(b.date));
  const pastGlobal=candidates.filter(e=>e.date<=today)
    .sort((a,b)=>b.date.localeCompare(a.date));
  const selected=upcomingUS[0] || pastUS[0] || upcomingGlobal[0] || pastGlobal[0];
  return selected?{...selected,upcoming:selected.date>today,firstWorldwide}:null;
}
// Backward-compatible helper used by the existing theatrical tests and
// callers wanting strictly past/current cinema launches.
export function recentTheatricalPremiere(tmdb,{now=new Date(),days=THEATRICAL_RECENCY_DAYS}={}) {
  const event=theatricalPremiere(tmdb,{now,pastDays:days,futureDays:0});
  return event && [2,3].includes(event.type)?event:null;
}

// The Home Releases JSON has already applied ALL of the original rules,
// including six months, 30-day Coming Soon, US priority and max row size.
// Matching against that output ensures exactly the same tagged titles and
// allows us to reuse its final rendered posters, rather than recomposing.
export function buildSmartEntries(movies, cacheMovies = {}, { homeCatalog = [], now = new Date() } = {}) {
  const homeById = new Map();
  for (const [index, meta] of homeCatalog.entries()) {
    if (meta?.type === 'movie' && typeof meta.id === 'string' && !homeById.has(meta.id)) {
      homeById.set(meta.id, { rank: index, meta });
    }
  }
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
    const home = homeById.get(id);
    const theatrical = home ? null : theatricalPremiere(cached,{now});
    const meta = {
      id, type: 'movie', name: cached?.title || movie.title,
      // Home Releases titles get precisely the SAME final rendered poster.
      // Ordinary shuffled titles get plain BetterPosters, no home-release tabs.
      poster: home?.meta?.poster || posterFor(movie, cached, imdb),
      ...(cached?.backdrop_path ? { background: `https://image.tmdb.org/t/p/w1280${cached.backdrop_path}` } : {}),
      ...(movie.year || cached?.release_date ? { year: Number(movie.year || cached.release_date?.slice(0, 4)) } : {}),
      ...(cached?.genres?.length ? { genres: cached.genres.map(g => g.name).filter(Boolean) } : {}),
      ...(cached?.runtime ? { runtime: `${cached.runtime} min` } : {}),
      // No date/status hint for random titles. Even if a 2018 digital date
      // exists in the cache, that title should have no Home Releases tag.
      ...(home?.meta?.releaseInfo ? { releaseInfo: home.meta.releaseInfo }
        : theatrical ? {releaseInfo: theatrical.upcoming?`${theatrical.kind} · ${theatrical.date}`:'IN THEATERS'} : {}),
      description: (home?.meta?.description || (theatrical
        ? `${theatrical.upcoming?'Scheduled':'Recent'} ${theatrical.kind.toLowerCase()} premiere: ${theatrical.date} (${theatrical.country || 'international'}). ${cached?.overview || ''}`
        : cached?.overview || '')).trim(),
      links: [
        ...(simklId ? [{ name: 'View on Simkl', category: 'simkl', url: `https://simkl.com/movies/${simklId}` }] : []),
        ...(tmdbId ? [{ name: 'View on TMDB', category: 'tmdb', url: `https://www.themoviedb.org/movie/${tmdbId}` }] : []),
      ],
    };
    result.push({ meta, homeRank: home?.rank ?? null, theatrical, tmdbPoster: cached?.poster_path ? `https://image.tmdb.org/t/p/w500${cached.poster_path}` : null });
  }
  return { entries: result, skipped };
}

export function paginateSmartCatalog(entries, pageSize = SMART_PAGE_SIZE) {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('Invalid page size');
  const pages = [];
  for (let skip = 0; skip < Math.max(entries.length, 1); skip += pageSize) {
    pages.push({ skip, metas: entries.slice(skip, skip + pageSize) });
  }
  return pages;
}
