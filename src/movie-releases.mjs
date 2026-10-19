// Account 2 home-release movie catalog. No theatrical / premiere / TV dates.
// All comparisons use UTC calendar dates because TMDB's release dates are
// date-level information, not guaranteed local release timestamps.
export const MOVIE_CATALOG_ID = 'simkl-plan-to-watch-home-releases-account2';
export const MOVIE_CATALOG_NAME = 'Movies · Home Releases · Simkl';
export const COMING_SOON_DAYS = 30;

function utcDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const date = value.slice(0, 10);
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date ? date : null;
}

// Actual first-ever home availability determines whether a movie is new enough.
// This prevents a 2002 film with a 2026 disc reissue from filling the row.
export const RELEASE_HISTORY_MONTHS = 6;

function monthsAgo(today, count) {
  const [year, month, day] = today.split('-').map(Number);
  const startOfTarget = new Date(Date.UTC(year, month - 1 - count, 1));
  const endOfTarget = new Date(Date.UTC(startOfTarget.getUTCFullYear(), startOfTarget.getUTCMonth() + 1, 0)).getUTCDate();
  startOfTarget.setUTCDate(Math.min(day, endOfTarget));
  return startOfTarget.toISOString().slice(0, 10);
}

function plusDays(today, days) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// When choosing what to show, prioritize an actual US release if one has
// happened; otherwise use international availability. Only the earliest
// release within each country/format counts, not later reissues.
function chooseFormat(events, today, deadline) {
  const byCountry = new Map();
  for (const event of events) {
    const previous = byCountry.get(event.country);
    if (!previous || event.date < previous.date) byCountry.set(event.country, event);
  }
  const firstByCountry = [...byCountry.values()];
  const released = firstByCountry.filter((event) => event.date <= today);
  const usReleased = released.find((event) => event.country === 'US');
  if (usReleased) return { ...usReleased, released: true };
  if (released.length) {
    return { ...released.sort((a, b) => a.date.localeCompare(b.date))[0], released: true };
  }
  const upcoming = firstByCountry.filter((event) => event.date > today && event.date <= deadline)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!upcoming.length) return null;
  // Worldwide earliest determines eligibility, but an eligible US date
  // takes precedence on the poster where possible.
  return { ...(upcoming.find((event) => event.country === 'US') ?? upcoming[0]), released: false };
}

export function classifyHomeReleases(releaseDates, { now = new Date(), comingSoonDays = COMING_SOON_DAYS, releaseHistoryMonths = RELEASE_HISTORY_MONTHS } = {}) {
  const today = new Date(now).toISOString().slice(0, 10);
  const cutoff = monthsAgo(today, releaseHistoryMonths);
  const deadline = plusDays(today, comingSoonDays);
  const events = { digital: [], physical: [] };
  for (const region of releaseDates?.results ?? []) {
    for (const release of region.release_dates ?? []) {
      const format = Number(release.type) === 4 ? 'digital' : Number(release.type) === 5 ? 'physical' : null;
      const date = utcDay(release.release_date);
      if (format && date) events[format].push({ format, date, country: String(region.iso_3166_1 || '').toUpperCase() });
    }
  }
  const all = [...events.digital, ...events.physical];
  if (!all.length) return null; // No digital/physical event at all.
  const firstHomeDate = all.reduce((earliest, event) => event.date < earliest ? event.date : earliest, all[0].date);
  if (firstHomeDate < cutoff || firstHomeDate > deadline) return null;

  const digital = chooseFormat(events.digital, today, deadline);
  const physical = chooseFormat(events.physical, today, deadline);
  const published = [digital, physical].filter((event) => event?.released);
  const upcoming = [digital, physical].filter((event) => event && !event.released);
  if (!published.length && !upcoming.length) return null;
  // Prefer the newest real home-release event for sorting (e.g. a physical
  // release of a newly digital movie), never the Simkl watchlist-add date.
  const latest = published.sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  const next = upcoming.sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  return { digital, physical, released: Boolean(latest), event: latest ?? next,
    sortDate: latest?.date ?? next.date, firstHomeDate, today };
}

export function formatMovieDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  const monthName = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  return `${monthName} ${day}`;
}

export function movieTags(release) {
  const { digital, physical, released, event } = release;
  const both = Boolean(digital?.released && physical?.released);
  const bothSoon = !released && digital && physical && !digital.released && !physical.released && digital.date === physical.date;
  const label = both ? 'DIGITAL + PHYSICAL'
    : digital?.released ? 'DIGITAL OUT'
      : physical?.released ? 'PHYSICAL OUT' : 'COMING SOON';
  const chip = (both || bothSoon) ? 'DIGITAL + PHYSICAL'
    : digital?.released ? 'DIGITAL'
      : physical?.released ? 'PHYSICAL' : event.format.toUpperCase();
  // Just the home-release date in the TV row's one-line top tab.
  const main = released ? formatMovieDate(event.date) : `COMING SOON · ${formatMovieDate(event.date)}`;
  return { main, chip, label, released };
}

export function buildMovieCatalog(movies, { now = new Date(), comingSoonDays = COMING_SOON_DAYS, maxItems = 50 } = {}) {
  const metas = [];
  for (const movie of movies ?? []) {
    if (movie.status && movie.status !== 'plantowatch') continue;
    const tmdb = movie.tmdb;
    if (!tmdb?.id) continue;
    const release = classifyHomeReleases(tmdb.release_dates, { now, comingSoonDays });
    if (!release) continue;
    const imdb = /^tt\d+$/.test(tmdb.imdb_id || movie.ids?.imdb || '') ? (tmdb.imdb_id || movie.ids.imdb) : null;
    const id = imdb || `tmdb:${tmdb.id}`;
    const tags = movieTags(release);
    const poster = imdb
      ? `https://btttr.cc/poster/imdb/poster-default/${imdb}.jpg?tag=none`
      : tmdb.poster_path ? `https://image.tmdb.org/t/p/w500${tmdb.poster_path}` : null;
    if (!poster) continue;
    const base = {
      id, type: 'movie', name: tmdb.title || movie.title || 'Untitled',
      poster,
      ...(tmdb.backdrop_path ? { background: `https://image.tmdb.org/t/p/w1280${tmdb.backdrop_path}` } : {}),
      ...(tmdb.release_date ? { year: Number(tmdb.release_date.slice(0, 4)) } : {}),
      ...(tmdb.runtime ? { runtime: `${tmdb.runtime} min` } : {}),
      ...(tmdb.genres?.length ? { genres: tmdb.genres.map((g) => g.name).filter(Boolean) } : {}),
      releaseInfo: tags.label,
      description: `${tags.label} · ${formatMovieDate(release.event.date)} (${release.event.country || 'international'}). ${tmdb.overview || ''}`.trim(),
      links: [
        { name: 'View on Simkl', category: 'simkl', url: `https://simkl.com/movies/${movie.simklId}` },
        { name: 'View on TMDB', category: 'tmdb', url: `https://www.themoviedb.org/movie/${tmdb.id}` },
      ],
    };
    metas.push({ meta: base, release, tags, tmdbPoster: tmdb.poster_path ? `https://image.tmdb.org/t/p/w500${tmdb.poster_path}` : null });
  }
  // Every release-state update reorders deterministically. Nothing moves to
  // the top merely because the title was added to Simkl or API data refreshed.
  metas.sort((a, b) => Number(b.release.released) - Number(a.release.released)
    || (a.release.released ? b.release.sortDate.localeCompare(a.release.sortDate) : a.release.sortDate.localeCompare(b.release.sortDate))
    || a.meta.name.localeCompare(b.meta.name));
  const unique = new Set();
  return metas.filter((entry) => {
    if (unique.has(entry.meta.id)) return false;
    unique.add(entry.meta.id);
    return true;
  }).slice(0, maxItems);
}
