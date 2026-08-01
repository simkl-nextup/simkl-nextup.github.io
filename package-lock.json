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

export function mergeCalendar(items, calendarPayload) {
  const next = structuredClone(items ?? {});
  const calendar = calendarPayload?.calendar ?? [];
  const metadata = calendarPayload?.metadata ?? {};

  for (const entry of calendar) {
    const key = String(entry.simkl_id);
    const item = next[key];
    if (!item || item.status !== "watching") continue;

    const info = item.next_to_watch_info;
    if (!info || Number(info.episode) !== Number(entry.episode?.episode)) continue;

    info.date = entry.date || info.date;
    info.title = entry.episode?.title || info.title;

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
    if (item?.status !== "watching") continue;
    const info = item.next_to_watch_info;
    const airedAt = validDate(info?.date);
    if (!info?.episode || !airedAt || airedAt > now) continue;

    const media = mediaFor(item);
    const id = chooseCatalogId(media?.ids);
    if (!media?.title || !id) {
      skipped.push({ simklId: simklIdFor(item), reason: "missing title or usable ID" });
      continue;
    }

    const episode = episodeLabel(info);
    included.push({
      airedAt,
      meta: {
        id,
        type: "series",
        name: media.title,
        poster: posterUrl(media.poster),
        background: fanartUrl(media.fanart),
        releaseInfo: episode,
        description: `Next unwatched: ${episode}${info.title ? ` — ${info.title}` : ""}. Aired ${displayDate(airedAt)}. Data from Simkl.`,
        links: [
          {
            name: "View on Simkl",
            category: "simkl",
            url: simklUrl(item),
          },
        ],
      },
    });
  }

  included.sort((a, b) => b.airedAt - a.airedAt || a.meta.name.localeCompare(b.meta.name));
  return {
    catalog: { metas: included.slice(0, maxItems).map((entry) => entry.meta) },
    skipped,
  };
}

export function buildManifest() {
  return {
    id: ADDON_ID,
    version: APP_VERSION,
    name: "Simkl New Anime Episodes",
    description: "One personalized row containing only aired but unwatched episodes from anime you are watching on Simkl.",
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

