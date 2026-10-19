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

function chooseEvent(events, today, soonDays) {
  const released = events.filter((event) => event.date <= today);
  const usReleased = released.filter((event) => event.country === 'US');
  if (released.length) {
    // Global availability wins over an announced-but-still-future US release.
    // Among releases that actually happened, US dates take precedence.
    const chosen = (usReleased.length ? usReleased : released)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    return { ...chosen, released: true };
  }
  const deadline = new Date(`${today}T00:00:00Z`);
  deadline.setUTCDate(deadline.getUTCDate() + soonDays);
  const upcoming = events.filter((event) => event.date > today && event.date <= deadline.toISOString().slice(0, 10));
  if (!upcoming.length) return null;
  // Prefer US details if they are within the eligible 30-day window;
  // otherwise fall back to the earliest known release anywhere.
  const usUpcoming = upcoming.filter((event) => event.country === 'US');
  return { ...(usUpcoming.length ? usUpcoming : upcoming)
    .sort((a, b) => a.date.localeCompare(b.date))[0], released: false };
}

export function classifyHomeReleases(releaseDates, { now = new Date(), comingSoonDays = COMING_SOON_DAYS } = {}) {
  const today = new Date(now).toISOString().slice(0, 10);
  const events = { digital: [], physical: [] };
  for (const region of releaseDates?.results ?? []) {
    for (const release of region.release_dates ?? []) {
      const format = release.type === 4 ? 'digital' : release.type === 5 ? 'physical' : null;
      const date = utcDay(release.release_date);
      if (format && date) events[format].push({ format, date, country: String(region.iso_3166_1 || '').toUpperCase() });
    }
  }
  const digital = chooseEvent(events.digital, today, comingSoonDays);
  const physical = chooseEvent(events.physical, today, comingSoonDays);
  const published = [digital, physical].filter((event) => event?.released);
  const upcoming = [digital, physical].filter((event) => event && !event.released);
  if (!published.length && !upcoming.length) return null;
  const latest = published.sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  const next = upcoming.sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  // Released content sorts first by most recent actual home-release event.
  // Upcoming titles sort by the soonest upcoming digital/physical date.
  const sortDate = latest?.date ?? next.date;
  return { digital, physical, released: Boolean(latest), event: latest ?? next, sortDate, today };
}

export function formatMovieDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  const monthName = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  return `${monthName} ${day}`;
}

export function movieTags(release) {
  const { digital, physical, released, event } = release;
  const both = digital?.released && physical?.released;
  const releaseFormats = both ? 'DIGITAL + PHYSICAL'
    : digital?.released ? 'DIGITAL OUT'
      : physical?.released ? 'PHYSICAL OUT' : 'COMING SOON';
  const nextDate = released ? event.date : (event?.date ?? release.sortDate);
  const main = released ? `OUT ${formatMovieDate(nextDate)}` : formatMovieDate(nextDate);
  const upcomingFormats = [digital, physical].filter((value) => value && !value.released);
  const formatLabel = both ? 'DIGITAL + PHYSICAL'
    : digital?.released ? 'DIGITAL' : physical?.released ? 'PHYSICAL'
      : event.format.toUpperCase();
  const otherSoon = upcomingFormats.find((value) => value.format !== event.format);
  const sub = released
    ? (both ? `DIG ${formatMovieDate(digital.date)} · PHY ${formatMovieDate(physical.date)}`
      : otherSoon ? `${releaseFormats} · ${otherSoon.format.toUpperCase()} ${formatMovieDate(otherSoon.date)}` : releaseFormats)
    : `COMING SOON · ${event.format.toUpperCase()} · ${event.country || 'WORLDWIDE'}`;
  return { main, sub, chip: formatLabel, label: releaseFormats };
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
