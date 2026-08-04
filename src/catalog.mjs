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

export function buildCatalog(items, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const maxItems = Number(options.maxItems ?? DEFAULT_MAX_ITEMS);
  const included = [];
  const skipped = [];

  for (const item of Object.values(items ?? {})) {
    if (!isCatalogCandidate(item, now)) continue;
    const isPlanned = item.status === "plantowatch";
    const isRevived = item.status === "completed";
    const info = isPlanned || isRevived ? item._addonLatestAiredInfo : item.next_to_watch_info;
    const airedAt = validDate(info?.date);
    if (!info?.episode || !airedAt || airedAt > now) continue;

    const latestAiredInfo = item._addonLatestAiredInfo;
    const latestAiredAt = validDate(latestAiredInfo?.date);
    const sortAt = latestAiredAt && latestAiredAt <= now && latestAiredAt > airedAt
      ? latestAiredAt
      : airedAt;

    const media = mediaFor(item);
    const id = chooseCatalogId(media?.ids);
    if (!media?.title || !id) {
      skipped.push({ simklId: simklIdFor(item), reason: "missing title or usable ID" });
      continue;
    }

    const episode = episodeLabel(info);
    const visuals = item._addonVisuals ?? {};
    const links = [
      {
        name: "View on Simkl",
        category: "simkl",
        url: simklUrl(item),
      },
    ];
    if (visuals.tmdbId) {
      const tmdbMediaType = visuals.tmdbMediaType === "movie" ? "movie" : "tv";
      links.push({
        name: "View on TMDB",
        category: "tmdb",
        url: `https://www.themoviedb.org/${tmdbMediaType}/${visuals.tmdbId}`,
      });
    }
    included.push({
      airedAt: sortAt,
      status: item.status,
      posterBadge: {
        id,
        status: item.status,
        episode,
      },
      meta: {
        id,
        type: "series",
        name: media.title,
        poster: visuals.poster || posterUrl(media.poster),
        background: visuals.background || fanartUrl(media.fanart),
        releaseInfo: episode,
        description: isPlanned
          ? `From your Plan to Watch list: latest release ${episode}${info.title ? ` — ${info.title}` : ""}, aired ${displayDate(airedAt)}. Data from Simkl.`
          : isRevived
            ? `Previously completed: new release ${episode}${info.title ? ` — ${info.title}` : ""}, aired ${displayDate(airedAt)}. Data from Simkl.`
            : `Next unwatched: ${episode}${info.title ? ` — ${info.title}` : ""}. ${sortAt > airedAt && latestAiredInfo?.episode ? `Latest release: ${episodeLabel(latestAiredInfo)}, aired ${displayDate(sortAt)}. ` : ""}Data from Simkl.`,
        links,
      },
    });
  }

  included.sort((a, b) => b.airedAt - a.airedAt || a.meta.name.localeCompare(b.meta.name));
  const selected = included.slice(0, maxItems);
  const sourceCounts = {
    watching: selected.filter((entry) => entry.status === "watching").length,
    planToWatch: selected.filter((entry) => entry.status === "plantowatch").length,
    completed: selected.filter((entry) => entry.status === "completed").length,
  };
  return {
    catalog: { metas: selected.map((entry) => entry.meta) },
    posterBadges: selected.map((entry) => entry.posterBadge),
    skipped,
    sourceCounts,
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
    description: "One personalized row that bumps Watching, Plan to Watch, and newly revived Completed anime when an episode airs.",
    resources: [
      "catalog",
      {
        name: "meta",
        types: ["series"],
        idPrefixes: ["tmdb:", "tvdb:", "kitsu:", "mal:", "simkl:"],
      },
    ],
    types: ["series"],
    catalogs: [
      {
        type: "series",
        id: CATALOG_ID,
        name: CATALOG_NAME,
      },
    ],
    behaviorHints: {
      configurable: false,
    },
  };
}
