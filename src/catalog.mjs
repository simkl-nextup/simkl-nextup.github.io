import {
  ADDON_ID,
  APP_VERSION,
  CATALOG_ID,
  CATALOG_NAME,
  DEFAULT_MAX_ITEMS,
} from "./constants.mjs";
import { effectiveStatus, mediaFor, simklIdFor } from "./state.mjs";

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function posterUrl(path) {
  if (!path) return "https://simkl.in/poster_no_pic_c.png";
  return `https://wsrv.nl/?url=https://simkl.in/posters/${path}_m.webp&q=90`;
}

export function fanartUrl(path) {
  if (!path) return undefined;
  return `https://wsrv.nl/?url=https://simkl.in/fanart/${path}_medium.webp&q=90`;
}

export function chooseCatalogId(ids = {}) {
  if (typeof ids.imdb === "string" && /^tt\d+$/.test(ids.imdb)) return ids.imdb;
  if (ids.tmdb) return `tmdb:${ids.tmdb}`;
  if (ids.tvdb) return `tvdb:${ids.tvdb}`;
  if (ids.kitsu) return `kitsu:${ids.kitsu}`;
  if (ids.mal) return `mal:${ids.mal}`;
  const simkl = ids.simkl ?? ids.simkl_id;
  return simkl ? `simkl:${simkl}` : null;
}

function publishedCatalogId(item, media) {
  const unified = item?._addonTvdbMeta;
  if (unified?.parentId && Array.isArray(unified.videos) && unified.videos.length) return unified.parentId;
  return chooseCatalogId(media?.ids);
}

export function simklUrl(item) {
  const media = mediaFor(item);
  const id = simklIdFor(item);
  if (!id) return "https://simkl.com";
  const slug = media?.ids?.slug ? `/${media.ids.slug}` : "";
  const section = item?.show ? "tv" : "anime";
  return `https://simkl.com/${section}/${id}${slug}`;
}

function calendarEpisode(entry) {
  if (entry?.episode && typeof entry.episode === "object") return entry.episode;
  const episode = Number(entry?.episode ?? entry?.episode_number);
  const season = Number(entry?.season ?? entry?.season_number);
  return {
    episode: Number.isFinite(episode) ? episode : undefined,
    season: Number.isFinite(season) ? season : undefined,
    title: entry?.episode_title || entry?.episode_name || undefined,
  };
}

function normalizeCalendarPayload(payload) {
  if (!Array.isArray(payload)) {
    const rawCalendar = Array.isArray(payload?.calendar) ? payload.calendar : [];
    return {
      calendar: rawCalendar.map((entry) => ({ ...entry, episode: calendarEpisode(entry) })),
      metadata: payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : {},
    };
  }

  const calendar = [];
  const metadata = {};
  for (const entry of payload) {
    const simklId = entry?.simkl_id ?? entry?.ids?.simkl ?? entry?.ids?.simkl_id;
    if (simklId === undefined || simklId === null) continue;
    const key = String(simklId);
    calendar.push({
      simkl_id: simklId,
      date: entry.date,
      episode: calendarEpisode(entry),
    });
    const existing = metadata[key] ?? {};
    metadata[key] = {
      title: existing.title || entry.title,
      poster: existing.poster || entry.poster,
      fanart: existing.fanart || entry.fanart,
      year: existing.year || entry.year,
      ids: {
        ...(existing.ids ?? {}),
        ...(entry.ids ?? {}),
        simkl: simklId,
      },
    };
  }
  return { calendar, metadata };
}

export function mergeCalendar(items, calendarPayload, options = {}) {
  const next = structuredClone(items ?? {});
  const { calendar, metadata } = normalizeCalendarPayload(calendarPayload);
  const now = options.now ? new Date(options.now) : new Date();

  for (const entry of calendar) {
    const key = String(entry.simkl_id);
    const item = next[key];
    if (!item || !["watching", "plantowatch", "completed"].includes(item.status)) continue;

    if (item.status === "watching") {
      const info = item.next_to_watch_info;
      const sameEpisode = info && Number(info.episode) === Number(entry.episode?.episode);
      const sameSeason = !Number.isFinite(Number(info?.season))
        || !Number.isFinite(Number(entry.episode?.season))
        || Number(info.season) === Number(entry.episode.season);
      if (sameEpisode && sameSeason) {
        info.date = entry.date || info.date;
        info.title = entry.episode?.title || info.title;
        if (entry.episode?.season !== undefined) info.season ??= entry.episode.season;
      }
    }

    const candidateDate = validDate(entry.date);
    const savedDate = validDate(item._addonLatestAiredInfo?.date);
    const episodeNumber = Number(entry.episode?.episode);
    if (candidateDate && candidateDate <= now && Number.isFinite(episodeNumber) && (!savedDate || candidateDate >= savedDate)) {
      item._addonLatestAiredInfo = {
        ...(Number.isFinite(Number(entry.episode?.season)) ? { season: Number(entry.episode.season) } : {}),
        episode: episodeNumber,
        title: entry.episode?.title || undefined,
        date: candidateDate.toISOString(),
      };
    }

    const media = mediaFor(item);
    const calendarMedia = metadata[key];
    if (media && calendarMedia) {
      media.title ||= calendarMedia.title;
      media.poster ||= calendarMedia.poster;
      media.fanart ||= calendarMedia.fanart;
      media.ids = { ...(calendarMedia.ids ?? {}), ...(media.ids ?? {}) };
      media.ids.simkl ??= entry.simkl_id;
    }
  }
  return next;
}

export function mergeMediaDetails(item, details) {
  if (!details || Array.isArray(details)) return item;
  const next = structuredClone(item);
  const media = mediaFor(next);
  if (!media) return next;
  media.title ||= details.title || details.en_title;
  media.poster ||= details.poster;
  media.fanart ||= details.fanart;
  media.year ||= details.year;
  media.ids = { ...(details.ids ?? {}), ...(media.ids ?? {}) };
  return next;
}

export function mergeAnimeDetails(item, details) {
  return mergeMediaDetails(item, details);
}

function episodeLabel(info) {
  if (info?.season !== undefined && info?.season !== null) {
    return `S${String(info.season).padStart(2, "0")}E${String(info.episode).padStart(2, "0")}`;
  }
  return `Ep. ${info.episode}`;
}

function displayDate(date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function findDefaultVideoId(seriesMeta, info) {
  if (seriesMeta?.matchedVideoId) return seriesMeta.matchedVideoId;
  if (!seriesMeta?.videos?.length || !Number.isFinite(Number(info?.episode))) return null;
  const localEpisode = Number(info.episode);
  const episode = localEpisode + Number(seriesMeta.matchedEpisodeOffset ?? 0);
  const preferredSeasons = [
    finiteNumber(info?.season),
    finiteNumber(seriesMeta.matchedSeasonNumber),
  ].filter((value, index, values) => value !== null && values.indexOf(value) === index);

  for (const season of preferredSeasons) {
    const match = seriesMeta.videos.find((video) => video.season === season && video.episode === episode);
    if (match) return match.id;
  }

  const regularSeasons = [...new Set(seriesMeta.videos.filter((video) => video.season > 0).map((video) => video.season))];
  if (regularSeasons.length === 1) {
    const match = seriesMeta.videos.find((video) => video.season === regularSeasons[0] && video.episode === episode);
    if (match) return match.id;
  }

  const matches = seriesMeta.videos.filter((video) => video.episode === episode && video.season > 0);
  return matches.length === 1 ? matches[0].id : null;
}

function trackingEpisodeCount(seriesMeta) {
  if (!Array.isArray(seriesMeta?.videos)) return 0;
  return seriesMeta.videos.filter((video) =>
    /^(?:tt\d+|tvdb:\d+):\d+:\d+$/.test(String(video?.id ?? "")),
  ).length;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// How long a freshly-revived season premiere still counts as "just revived"
// if you haven't watched it yet. A rolling window from the actual air date
// (rather than a calendar-year cutoff) avoids a title silently flipping from
// purple to green on January 1st just because the year rolled over.
const REVIVAL_FRESHNESS_DAYS = 365;

// Simkl's own next_to_watch_info is already "the next episode you haven't
// watched, in show order" — so if it points at episode 1 of a season past
// the first, every earlier season was necessarily watched already. That's
// what makes checking "season > 1, episode === 1" a reliable stand-in for
// "the previous season was completed", without needing separate watched-
// count bookkeeping.
function resolveSeasonPosition(seriesMeta, info) {
  if (Number.isFinite(Number(info?.season)) && Number.isFinite(Number(info?.episode))) {
    return { season: Number(info.season), episode: Number(info.episode) };
  }
  if (!seriesMeta?.videos?.length || !Number.isFinite(Number(info?.episode))) return null;
  const localEpisode = Number(info.episode);
  const episode = localEpisode + Number(seriesMeta.matchedEpisodeOffset ?? 0);
  const season = finiteNumber(seriesMeta.matchedSeasonNumber);
  if (season !== null) {
    const match = seriesMeta.videos.find((video) => video.season === season && video.episode === episode);
    if (match) return { season: match.season, episode: match.episode };
  }
  const matches = seriesMeta.videos.filter((video) => video.episode === episode && video.season > 0);
  return matches.length === 1 ? { season: matches[0].season, episode: matches[0].episode } : null;
}

// A title Simkl has already auto-promoted to "watching" whose very next
// unwatched episode is a fresh season premiere. Treated as a revived
// Completed title (purple badge) until that one episode is watched.
function isFreshSeasonPremiere(seriesMeta, info, airedAt, now) {
  if (!airedAt) return false;
  const ageDays = (now.getTime() - airedAt.getTime()) / MS_PER_DAY;
  if (ageDays < 0 || ageDays >= REVIVAL_FRESHNESS_DAYS) return false;
  const position = resolveSeasonPosition(seriesMeta, info);
  return Boolean(position && position.episode === 1 && position.season > 1);
}

function dubSentence(dub) {
  if (!dub) return "";
  if (dub.full) return " English dub: fully dubbed.";
  if (dub.airing && !dub.episode) return " English dub: airing.";
  if (dub.unknown && !dub.episode) return " English dub: available (progress unknown).";
  return dub.episode ? ` English dub: up to episode ${dub.episode}.` : "";
}

// Season from an anime title: "Season 3", "3rd Season", "Part 2" is NOT a season,
// trailing roman numerals ("Mushoku Tensei III").
const ROMAN = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
function seasonFromTitle(title) {
  const text = String(title ?? "");
  const match = text.match(/\bseason\s*(\d+)/i) || text.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i);
  if (match) return Number(match[1]);
  const roman = text.replace(/[:\-–].*$/, "").trim().match(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)$/i);
  return roman ? ROMAN[roman[1].toLowerCase()] : null;
}

// Map a Simkl episode onto the TheTVDB season/episode that Nuvio's detail page
// lists, so the poster and the episode list always agree.
function tvdbPosition(seriesMeta, info, { allowMatchedVideo = false } = {}) {
  if (!seriesMeta?.videos?.length || !Number.isFinite(Number(info?.episode))) return null;
  // Simkl numbers each anime entry as its own "season 1"; when TheTVDB has
  // matched this entry to a unified season, that season wins.
  const lookup = finiteNumber(seriesMeta.matchedSeasonNumber) !== null ? { ...info, season: undefined } : info;
  const id = allowMatchedVideo
    ? findDefaultVideoId(seriesMeta, lookup)
    : findDefaultVideoId({ ...seriesMeta, matchedVideoId: null }, lookup);
  const video = id ? seriesMeta.videos.find((candidate) => candidate.id === id) : null;
  return video && video.season > 0 ? { season: video.season, episode: video.episode } : null;
}

// Dub episode → the same TheTVDB season/episode numbering as the top tab.
// The season shown always belongs to the DUB, never to your own progress:
//   - a later season's dub keeps the season from its AnimeSchedule page;
//   - a fully dubbed entry shows this entry's own season;
//   - a number we could not place keeps this entry's season;
//   - no episode number at all → no season (the tag says "DUB ONGOING").
function dubDisplay(dub, { seriesMeta, info, tags }) {
  if (!dub) return null;
  const entrySeason = finiteNumber(seriesMeta?.matchedSeasonNumber)
    ?? tags?.nextSeason ?? tags?.airedSeason ?? tags?.season ?? 1;
  const episode = finiteNumber(dub.episode);
  if (dub.laterSeason) return { ...dub, season: finiteNumber(dub.season) ?? entrySeason, episode };
  if (dub.full) return { ...dub, season: entrySeason };
  if (!episode) return { ...dub, season: null };
  const videos = (seriesMeta?.videos ?? []).filter((video) => video.season > 0);
  const byAbsolute = () => {
    const found = videos.filter((video) => Number(video.absoluteNumber) === episode);
    return found.length === 1 ? { season: found[0].season, episode: found[0].episode } : null;
  };
  // Long runners (One Piece) count dub episodes across the whole show: a number
  // bigger than any single season can only be an absolute episode number.
  const longestSeason = videos.reduce((max, video) => Math.max(max, Number(video.episode) || 0), 0);
  const position = (longestSeason && episode > longestSeason ? byAbsolute() : null)
    ?? tvdbPosition(seriesMeta, { episode, season: info?.season })
    ?? byAbsolute();
  if (position) return { ...dub, season: position.season, episode: position.episode };
  return { ...dub, season: entrySeason };
}

// Season/episode numbers for the "tags" poster: latest aired and next to watch.
function posterTagNumbers({ status, info, latestAiredInfo, seriesMeta, title }) {
  const fallbackSeason = (value) => {
    const simkl = finiteNumber(value?.season);
    return (simkl && simkl > 1 ? simkl : null) ?? seasonFromTitle(title) ?? simkl ?? 1;
  };
  const position = (value, allowMatchedVideo) => {
    if (!value || !Number.isFinite(Number(value.episode))) return null;
    return tvdbPosition(seriesMeta, value, { allowMatchedVideo })
      ?? { season: fallbackSeason(value), episode: Number(value.episode) };
  };
  const later = (a, b) => (!a ? b : !b ? a : (a.season > b.season || (a.season === b.season && a.episode >= b.episode)) ? a : b);

  if (status === "plantowatch") {
    const aired = position(latestAiredInfo ?? info, false);
    return { season: aired?.season ?? null, aired: aired?.episode ?? null, airedSeason: aired?.season ?? null, next: null, nextSeason: null };
  }
  const next = position(info, true);
  const aired = later(position(latestAiredInfo, false), next);
  return {
    season: next?.season ?? null,
    aired: aired?.episode ?? null,
    airedSeason: aired?.season ?? null,
    next: next?.episode ?? null,
    nextSeason: next?.season ?? null,
  };
}

function buildDescription({ status, info, episode, airedAt, sortAt, latestAiredInfo }) {
  if (status === "plantowatch") {
    return `From your Plan to Watch list: latest release ${episode}${info.title ? ` — ${info.title}` : ""}, aired ${displayDate(airedAt)}. Data from Simkl.`;
  }
  if (status === "completed") {
    return `Previously completed: new release ${episode}${info.title ? ` — ${info.title}` : ""}, aired ${displayDate(airedAt)}. Data from Simkl.`;
  }
  return `Next unwatched: ${episode}${info.title ? ` — ${info.title}` : ""}. ${sortAt > airedAt && latestAiredInfo?.episode ? `Latest release: ${episodeLabel(latestAiredInfo)}, aired ${displayDate(sortAt)}. ` : ""}Data from Simkl.`;
}

function buildLinks(item, visuals, seriesMeta) {
  const links = [
    {
      name: "View on Simkl",
      category: "simkl",
      url: simklUrl(item),
    },
  ];
  if (seriesMeta?.tvdbId) {
    links.push({
      name: "View on TheTVDB",
      category: "tvdb",
      url: `https://thetvdb.com/series/${seriesMeta.tvdbId}`,
    });
  }
  if (item?._addonAnimeScheduleRoute) {
    // AnimeSchedule's API terms ask for a visible credit/link.
    links.push({
      name: "View on AnimeSchedule",
      category: "animeschedule",
      url: `https://animeschedule.net/anime/${encodeURIComponent(item._addonAnimeScheduleRoute)}`,
    });
  }
  if (visuals.tmdbId) {
    const tmdbMediaType = visuals.tmdbMediaType === "movie" ? "movie" : "tv";
    links.push({
      name: "View on TMDB",
      category: "tmdb",
      url: `https://www.themoviedb.org/${tmdbMediaType}/${visuals.tmdbId}`,
    });
  }
  return links;
}

// The ★ score drawn on a poster: MyAnimeList for anime, TMDB for the TV row
// (only with enough votes to mean something).
export const TMDB_MIN_VOTES = 20;
function posterScore(item, visuals, options) {
  if (item._addonMalScore) return String(item._addonMalScore);
  if (!options.tmdbScores) return null;
  const rating = Number(visuals?.tmdbRating);
  if (!(rating > 0) || Number(visuals?.tmdbVoteCount) < TMDB_MIN_VOTES) return null;
  return rating.toFixed(1);
}

export function buildCatalog(items, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const maxItems = Number(options.maxItems ?? DEFAULT_MAX_ITEMS);
  const includedById = new Map();
  const skipped = [];

  for (const item of Object.values(items ?? {})) {
    if (!isCatalogCandidate(item, now)) continue;
    const info = resolveInfo(item);
    const airedAt = validDate(info?.date);
    if (!info?.episode || !airedAt || airedAt > now) continue;

    const latestAiredInfo = item._addonLatestAiredInfo;
    const latestAiredAt = validDate(latestAiredInfo?.date);
    const sortAt = latestAiredAt && latestAiredAt <= now && latestAiredAt > airedAt
      ? latestAiredAt
      : airedAt;

    const media = mediaFor(item);
    const id = publishedCatalogId(item, media);
    if (!media?.title || !id) {
      skipped.push({ simklId: simklIdFor(item), reason: "missing title or usable ID" });
      continue;
    }

    const seriesMeta = item._addonTvdbMeta;
    const episode = episodeLabel(info);
    const visuals = item._addonVisuals ?? {};
    const links = buildLinks(item, visuals, seriesMeta);
    // Simkl's own status can already say "watching" for a title the user
    // has not actually started. Prefer the precise TVDB season-boundary
    // check (isFreshSeasonPremiere) when season data is available; fall
    // back to the watched-count snapshot (effectiveStatus, in state.mjs)
    // for titles Simkl hasn't matched to TVDB.
    const status = item.status === "watching" && isFreshSeasonPremiere(seriesMeta, info, airedAt, now)
      ? "completed"
      : effectiveStatus(item);
    const description = buildDescription({ status, info, episode, airedAt, sortAt, latestAiredInfo })
      .replace(/ Data from Simkl\.$/, `${dubSentence(item._addonDub)} Data from Simkl.`);
    const name = seriesMeta?.name || media.title;
    const poster = visuals.poster || seriesMeta?.poster || posterUrl(media.poster);
    const background = seriesMeta?.background || visuals.background || fanartUrl(media.fanart);
    const defaultVideoId = findDefaultVideoId(seriesMeta, info);

    const basePreview = {
      id,
      type: "series",
      name,
      poster,
      background,
      releaseInfo: episode,
      description,
      links,
    };

    const detail = seriesMeta?.videos?.length
      ? {
          id,
          type: "series",
          name,
          poster,
          background,
          description: seriesMeta.description ? `${description}

${seriesMeta.description}` : description,
          releaseInfo: seriesMeta.releaseInfo || episode,
          genres: seriesMeta.genres?.length ? seriesMeta.genres : undefined,
          runtime: seriesMeta.runtime || undefined,
          videos: seriesMeta.videos,
          links,
          behaviorHints: defaultVideoId ? { defaultVideoId } : undefined,
        }
      : basePreview;

    // Nuvio Desktop currently has a less complete custom-meta path than the
    // Android clients. Publishing the unified videos in the catalog preview
    // gives it the same season data even when it does not perform the follow-up
    // /meta request for a private parent ID. Standards-compliant clients still
    // receive the dedicated full metadata response below.
    const preview = seriesMeta?.videos?.length
      ? {
          ...basePreview,
          releaseInfo: detail.releaseInfo,
          genres: detail.genres,
          runtime: detail.runtime,
          videos: detail.videos,
          behaviorHints: detail.behaviorHints,
        }
      : basePreview;

    const latestEpisode = latestAiredInfo?.episode
      ? episodeLabel(latestAiredInfo)
      : episode;
    const nextEpisode = status === "watching" ? episode : null;
    const tags = posterTagNumbers({ status, info, latestAiredInfo, seriesMeta, title: media.title });

    const entry = {
      airedAt: sortAt,
      status,
      posterBadge: {
        id,
        status,
        episode,
        latestEpisode,
        nextEpisode,
        tags,
        ...(item._addonDub ? { dub: dubDisplay(item._addonDub, { seriesMeta, info, tags }) } : {}),
        ...(item._addonMalScore ? { malScore: item._addonMalScore } : {}),
        ...(media.ids?.mal ? { mal: Number(media.ids.mal) } : {}),
        ...(posterScore(item, visuals, options) ? { score: posterScore(item, visuals, options) } : {}),
        // Official title logo: TMDB first, then TheTVDB's ClearLogo.
        ...((visuals.logo || seriesMeta?.logo) ? { logo: visuals.logo || seriesMeta.logo } : {}),
        ...(visuals.posterTextless && poster === visuals.poster ? { textless: true } : {}),
      },
      meta: preview,
      detail,
      unified: Boolean(seriesMeta?.videos?.length),
      unifiedSeasonCount: seriesMeta?.seasonCount ?? 0,
      unifiedEpisodeCount: seriesMeta?.episodeCount ?? 0,
      unifiedTrackingEpisodeCount: trackingEpisodeCount(seriesMeta),
    };

    const existing = includedById.get(id);
    if (!existing || entry.airedAt > existing.airedAt) includedById.set(id, entry);
  }

  const included = [...includedById.values()]
    .sort((a, b) => b.airedAt - a.airedAt || a.meta.name.localeCompare(b.meta.name));
  const selected = included.slice(0, maxItems);
  const sourceCounts = {
    watching: selected.filter((entry) => entry.status === "watching").length,
    planToWatch: selected.filter((entry) => entry.status === "plantowatch").length,
    completed: selected.filter((entry) => entry.status === "completed").length,
  };
  return {
    catalog: { metas: selected.map((entry) => entry.meta) },
    metadata: selected.map((entry) => entry.detail),
    posterBadges: selected.map((entry) => entry.posterBadge),
    skipped,
    sourceCounts,
    unifiedStats: {
      titles: selected.filter((entry) => entry.unified).length,
      seasons: selected.reduce((sum, entry) => sum + entry.unifiedSeasonCount, 0),
      episodes: selected.reduce((sum, entry) => sum + entry.unifiedEpisodeCount, 0),
      trackingEpisodes: selected.reduce((sum, entry) => sum + entry.unifiedTrackingEpisodeCount, 0),
    },
  };
}

// Simkl doesn't populate next_to_watch_info for Completed titles at all
// (that's only computed for Watching/Plan to Watch) — so for a Completed
// show with unwatched new episodes, the addon previously fell back to
// "whichever episode most recently aired" via the calendar. That's wrong
// for a weekly-airing revival: it climbs forward every week (E1, E2, ... E8)
// even though nothing has actually been watched. Pin it instead to the real
// next episode in absolute order using TVDB's per-episode absolute
// numbering, which stays fixed until watched_episodes_count itself moves.
function resolveNextUnwatchedFromTvdb(item) {
  const watched = Number(item?.watched_episodes_count);
  const videos = item?._addonTvdbMeta?.videos;
  if (!Number.isFinite(watched) || !Array.isArray(videos) || !videos.length) return null;
  const target = watched + 1;
  const matches = videos.filter((video) => video.season > 0 && Number(video.absoluteNumber) === target);
  if (matches.length !== 1) return null;
  const video = matches[0];
  if (!validDate(video.released)) return null;
  return { season: video.season, episode: video.episode, title: video.title, date: video.released };
}

function resolveInfo(item) {
  if (item.status === "watching") return item.next_to_watch_info;
  if (item.status === "completed") return resolveNextUnwatchedFromTvdb(item) ?? item._addonLatestAiredInfo;
  return item._addonLatestAiredInfo;
}

export function isCatalogCandidate(item, nowInput = new Date()) {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  if (!["watching", "plantowatch", "completed"].includes(item?.status)) return false;

  const info = resolveInfo(item);
  const airedAt = validDate(info?.date);
  if (!info?.episode || !airedAt || airedAt > now) return false;

  if (item.status === "completed") {
    // A Completed title only comes back for a genuinely NEW release. Without
    // this, a gap in old watch history (e.g. S1E15 from 2021 left unticked on
    // Simkl) resurfaced the title as "NEW SEASON".
    if ((now.getTime() - airedAt.getTime()) / MS_PER_DAY > REVIVAL_FRESHNESS_DAYS) return false;
    const watchedCount = Number(item.watched_episodes_count ?? 0);
    const totalCount = Number(item.total_episodes_count);

    // Anime records are often a single numbered run, so comparing the latest
    // episode number to the watched count works. Normal TV resets its episode
    // number every season (for example S06E01 after 50 watched episodes), so
    // prefer Simkl's cumulative totals whenever they are available.
    if (Number.isFinite(totalCount) && totalCount > watchedCount) return true;

    const releasedEpisode = Number(info.episode);
    if (!Number.isFinite(releasedEpisode) || releasedEpisode <= watchedCount) return false;
  }
  return true;
}

export function buildManifest({
  addonId = ADDON_ID,
  catalogId = CATALOG_ID,
  catalogName = CATALOG_NAME,
  addonName = "Simkl Anime Up Next",
  version = APP_VERSION,
  mediaType = "anime",
} = {}) {
  return {
    id: addonId,
    version,
    name: addonName,
    description: mediaType === "tv"
      ? "A personalized Simkl TV Up Next row with TheTVDB seasons, canonical episode IDs, and high-resolution episode artwork."
      : "A personalized Simkl anime row with optional TheTVDB unified seasons, canonical episode IDs, and high-resolution episode artwork.",
    resources: ["catalog", "meta"],
    types: ["series"],
    idPrefixes: ["simkl-tvdb-unified:", "tt", "tvdb:", "tmdb:", "kitsu:", "mal:", "simkl:"],
    catalogs: [
      {
        type: "series",
        id: catalogId,
        name: catalogName,
      },
    ],
    behaviorHints: {
      configurable: false,
      newEpisodeNotifications: true,
    },
  };
}
