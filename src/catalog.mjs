import {
  ADDON_ID,
  APP_VERSION,
  CATALOG_ID,
  CATALOG_NAME,
  DEFAULT_MAX_ITEMS,
} from "./constants.mjs";
import { mediaFor, simklIdFor } from "./state.mjs";

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
  return `https://simkl.com/anime/${id}${slug}`;
}

function normalizeCalendarPayload(payload) {
  if (!Array.isArray(payload)) {
    return {
      calendar: Array.isArray(payload?.calendar) ? payload.calendar : [],
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
      episode: entry.episode,
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
      if (info && Number(info.episode) === Number(entry.episode?.episode)) {
        info.date = entry.date || info.date;
        info.title = entry.episode?.title || info.title;
      }
    }

    const candidateDate = validDate(entry.date);
    const savedDate = validDate(item._addonLatestAiredInfo?.date);
    const episodeNumber = Number(entry.episode?.episode);
    if (candidateDate && candidateDate <= now && Number.isFinite(episodeNumber) && (!savedDate || candidateDate >= savedDate)) {
      item._addonLatestAiredInfo = {
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

export function mergeAnimeDetails(item, details) {
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

function seasonFromMediaTitle(title) {
  const value = String(title ?? "");
  const match = value.match(/(?:^|\s)(?:season|series)\s*(\d{1,2})(?:\s|$|:|-)/i)
    || value.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i);
  return match ? finiteNumber(match[1]) : null;
}

function videoById(seriesMeta, id) {
  if (!id || !Array.isArray(seriesMeta?.videos)) return null;
  return seriesMeta.videos.find((video) => video.id === id) ?? null;
}

function badgeEpisodeLabel(info, seriesMeta, mediaTitle, { preferMatchedVideo = false } = {}) {
  let episode = finiteNumber(info?.episode);
  if (episode === null) return episodeLabel(info);

  if (preferMatchedVideo) {
    const matched = videoById(seriesMeta, seriesMeta?.matchedVideoId);
    if (matched && finiteNumber(matched.season) !== null && finiteNumber(matched.episode) !== null) {
      return `S${finiteNumber(matched.season)} E${finiteNumber(matched.episode)}`;
    }
  }

  let season = finiteNumber(info?.season);
  if (season === null) {
    season = finiteNumber(seriesMeta?.matchedSeasonNumber);
    if (season !== null) episode += finiteNumber(seriesMeta?.matchedEpisodeOffset) ?? 0;
  }
  if (season === null) season = seasonFromMediaTitle(mediaTitle);

  if (season === null && Array.isArray(seriesMeta?.videos)) {
    const regularSeasons = [...new Set(
      seriesMeta.videos
        .map((video) => finiteNumber(video?.season))
        .filter((value) => value !== null && value > 0),
    )];
    if (regularSeasons.length === 1) season = regularSeasons[0];
  }

  // A standalone anime title without an explicit season is conventionally its
  // first season. TVDB-enriched grouped titles normally resolve above.
  if (season === null) season = 1;
  return `S${season} E${episode}`;
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

function buildDescription({ item, info, episode, airedAt, sortAt, latestAiredInfo }) {
  if (item.status === "plantowatch") {
    return `From your Plan to Watch list: latest release ${episode}${info.title ? ` — ${info.title}` : ""}, aired ${displayDate(airedAt)}. Data from Simkl.`;
  }
  if (item.status === "completed") {
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

export function buildCatalog(items, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const maxItems = Number(options.maxItems ?? DEFAULT_MAX_ITEMS);
  const includedById = new Map();
  const skipped = [];

  for (const item of Object.values(items ?? {})) {
    if (!isCatalogCandidate(item, now)) continue;
    const info = item.status === "watching" ? item.next_to_watch_info : item._addonLatestAiredInfo;
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
    const description = buildDescription({ item, info, episode, airedAt, sortAt, latestAiredInfo });
    const name = seriesMeta?.name || media.title;
    const poster = seriesMeta?.poster || visuals.poster || posterUrl(media.poster);
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

    const primaryBadgeEpisode = badgeEpisodeLabel(info, seriesMeta, media.title, {
      preferMatchedVideo: true,
    });
    const latestBadgeInfo = latestAiredInfo?.episode ? latestAiredInfo : info;
    const latestEpisode = badgeEpisodeLabel(latestBadgeInfo, seriesMeta, media.title, {
      preferMatchedVideo: Number(latestBadgeInfo?.episode) === Number(info?.episode),
    });
    const nextEpisode = item.status === "watching" ? primaryBadgeEpisode : null;

    const entry = {
      airedAt: sortAt,
      status: item.status,
      posterBadge: {
        id,
        status: item.status,
        episode: primaryBadgeEpisode,
        latestEpisode,
        nextEpisode,
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

export function isCatalogCandidate(item, nowInput = new Date()) {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  if (!["watching", "plantowatch", "completed"].includes(item?.status)) return false;

  const info = item.status === "watching" ? item.next_to_watch_info : item._addonLatestAiredInfo;
  const airedAt = validDate(info?.date);
  if (!info?.episode || !airedAt || airedAt > now) return false;

  if (item.status === "completed") {
    const watchedCount = Number(item.watched_episodes_count ?? 0);
    const releasedEpisode = Number(info.episode);
    if (!Number.isFinite(releasedEpisode) || releasedEpisode <= watchedCount) return false;
  }
  return true;
}

export function buildManifest() {
  return {
    id: ADDON_ID,
    version: APP_VERSION,
    name: "Simkl Anime Up Next",
    description: "A personalized Simkl anime row with optional TheTVDB unified seasons, canonical episode IDs, and high-resolution episode artwork.",
    resources: ["catalog", "meta"],
    types: ["series"],
    idPrefixes: ["simkl-tvdb-unified:", "tt", "tvdb:", "tmdb:", "kitsu:", "mal:", "simkl:"],
    catalogs: [
      {
        type: "series",
        id: CATALOG_ID,
        name: CATALOG_NAME,
      },
    ],
    behaviorHints: {
      configurable: false,
      newEpisodeNotifications: true,
    },
  };
}
