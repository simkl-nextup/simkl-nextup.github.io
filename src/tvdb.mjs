import { mediaFor, simklIdFor } from "./state.mjs";

const TVDB_API_BASE = "https://api4.thetvdb.com/v4/";
const TVDB_ARTWORK_BASE = "https://artworks.thetvdb.com/banners/";
const SUCCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 6 * 60 * 60 * 1000;
const TVDB_METADATA_VERSION = 2;
const MAX_EPISODE_PAGES = 100;

export class TvdbApiError extends Error {
  constructor(message, status, body) {
    super(`TVDB request failed: ${message}`);
    this.name = "TvdbApiError";
    this.provider = "TVDB";
    this.status = status;
    this.body = body;
  }
}

async function readResponse(response) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new TvdbApiError("non-JSON response", response.status, text.slice(0, 500));
  }
  if (!response.ok) {
    const reason = body?.message || body?.error || body?.status || response.statusText;
    throw new TvdbApiError(reason || `HTTP ${response.status}`, response.status, body);
  }
  return body;
}

function positiveInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function integer(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function validImdbId(value) {
  return typeof value === "string" && /^tt\d+$/.test(value) ? value : null;
}

function unwrapData(body) {
  return body?.data ?? body ?? null;
}

function seriesIdFromRemoteSearch(body) {
  const raw = unwrapData(body);
  const results = Array.isArray(raw) ? raw : Array.isArray(raw?.results) ? raw.results : [];
  for (const result of results) {
    const type = String(result?.type ?? result?.objectType ?? result?.entityType ?? "").toLowerCase();
    if (type && !type.includes("series") && !type.includes("show")) continue;
    const id = positiveInteger(
      result?.tvdb_id
      ?? result?.tvdbId
      ?? result?.seriesId
      ?? result?.series?.id
      ?? result?.id,
    );
    if (id) return id;
  }
  return null;
}

function nextPageFrom(body, currentPage) {
  const links = body?.links ?? body?.data?.links ?? null;
  const next = links?.next;
  if (next === null || next === undefined || next === "") return null;
  if (Number.isInteger(Number(next))) return Number(next);
  try {
    const url = new URL(String(next), TVDB_API_BASE);
    const page = Number(url.searchParams.get("page"));
    return Number.isInteger(page) && page > currentPage ? page : currentPage + 1;
  } catch {
    return currentPage + 1;
  }
}

function episodesFrom(body) {
  const data = unwrapData(body);
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.episodes) ? data.episodes : [];
}

export function createTvdbClient({ apiKey, pin, fetchImpl = fetch } = {}) {
  if (!apiKey) return null;
  let tokenPromise = null;

  async function login() {
    const payload = { apikey: apiKey };
    if (pin) payload.pin = pin;
    const response = await fetchImpl(new URL("login", TVDB_API_BASE), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await readResponse(response);
    const token = body?.data?.token ?? body?.token;
    if (!token) throw new TvdbApiError("login response did not contain a bearer token", response.status, body);
    return token;
  }

  async function token() {
    tokenPromise ??= login();
    return tokenPromise;
  }

  async function get(path, params = {}) {
    const url = new URL(String(path).replace(/^\//, ""), TVDB_API_BASE);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${await token()}`,
      },
    });
    return readResponse(response);
  }

  async function episodePages(seriesId, seasonType, language, localized) {
    const all = [];
    let page = 0;
    const seenPages = new Set();
    while (page !== null && !seenPages.has(page) && seenPages.size < MAX_EPISODE_PAGES) {
      seenPages.add(page);
      const suffix = localized && language ? `/${encodeURIComponent(language)}` : "";
      const body = await get(
        `series/${encodeURIComponent(seriesId)}/episodes/${encodeURIComponent(seasonType)}${suffix}`,
        { page },
      );
      all.push(...episodesFrom(body));
      page = nextPageFrom(body, page);
    }
    return all;
  }

  return {
    async resolveSeriesId(ids = {}) {
      const direct = positiveInteger(ids.tvdb ?? ids.tvdb_id);
      if (direct) return direct;
      const imdb = validImdbId(ids.imdb ?? ids.imdb_id);
      if (!imdb) return null;
      return seriesIdFromRemoteSearch(await get(`search/remoteid/${encodeURIComponent(imdb)}`));
    },

    async getSeriesExtended(seriesId) {
      return unwrapData(await get(`series/${encodeURIComponent(seriesId)}/extended`, { meta: "translations" }));
    },

    async getSeriesTranslation(seriesId, language = "eng") {
      if (!language) return null;
      try {
        return unwrapData(await get(`series/${encodeURIComponent(seriesId)}/translations/${encodeURIComponent(language)}`));
      } catch (error) {
        if (!(error instanceof TvdbApiError) || ![400, 404].includes(error.status)) throw error;
        return null;
      }
    },

    async getSeriesEpisodes(seriesId, { seasonType = "default", language = "eng" } = {}) {
      try {
        return await episodePages(seriesId, seasonType, language, true);
      } catch (error) {
        if (!(error instanceof TvdbApiError) || ![400, 404].includes(error.status)) throw error;
        return episodePages(seriesId, seasonType, language, false);
      }
    },
  };
}

export function tvdbImage(value) {
  const candidate = typeof value === "string"
    ? value
    : value?.image || value?.url || value?.thumbnail || null;
  if (!candidate) return null;
  if (/^https:\/\//i.test(candidate)) return candidate;
  if (/^http:\/\//i.test(candidate)) return candidate.replace(/^http:/i, "https:");
  if (candidate.startsWith("//")) return `https:${candidate}`;
  const path = candidate.replace(/^\/+/, "").replace(/^banners\//, "");
  return path ? `${TVDB_ARTWORK_BASE}${path}` : null;
}

function artworkKind(artwork) {
  return String(
    artwork?.typeName
    ?? artwork?.type_name
    ?? artwork?.type?.name
    ?? artwork?.type
    ?? "",
  ).toLowerCase();
}

function artworkRatio(artwork) {
  const width = Number(artwork?.width);
  const height = Number(artwork?.height);
  return width > 0 && height > 0 ? width / height : null;
}

function pickArtwork(series, purpose) {
  const artworks = Array.isArray(series?.artworks) ? series.artworks : [];
  const scored = artworks
    .map((artwork) => {
      const kind = artworkKind(artwork);
      const ratio = artworkRatio(artwork);
      let score = Number(artwork?.score ?? 0);
      if (purpose === "poster") {
        if (kind.includes("poster")) score += 1000;
        if (ratio !== null && ratio < 0.9) score += 200;
      } else {
        if (kind.includes("background") || kind.includes("fan") || kind.includes("cinematic")) score += 1000;
        if (ratio !== null && ratio > 1.4) score += 200;
      }
      return { url: tvdbImage(artwork), score };
    })
    .filter((entry) => entry.url)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.url ?? null;
}

function remoteIdFor(series, pattern) {
  const remoteIds = Array.isArray(series?.remoteIds)
    ? series.remoteIds
    : Array.isArray(series?.remote_ids)
      ? series.remote_ids
      : [];
  for (const remote of remoteIds) {
    const source = String(remote?.sourceName ?? remote?.source_name ?? remote?.type ?? "").toLowerCase();
    const id = remote?.id ?? remote?.remoteId ?? remote?.remote_id;
    if (pattern.test(source) || (pattern.test("imdb") && validImdbId(id))) return id;
  }
  return null;
}

function isoDate(value) {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function yearOf(value) {
  const match = String(value ?? "").match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

function releaseInfoForSeries(series, videos) {
  const start = yearOf(series?.firstAired ?? series?.first_aired)
    ?? Math.min(...videos.map((video) => yearOf(video.released)).filter(Number.isFinite));
  if (!Number.isFinite(start)) return null;
  const status = String(series?.status?.name ?? series?.status ?? "").toLowerCase();
  const years = videos.map((video) => yearOf(video.released)).filter(Number.isFinite);
  const end = years.length ? Math.max(...years) : null;
  if (/ended|cancelled|canceled/.test(status)) return end && end !== start ? `${start}-${end}` : String(start);
  return `${start}-`;
}

function runtimeFor(series, episode) {
  const runtime = positiveInteger(episode?.runtime)
    ?? positiveInteger(series?.averageRuntime)
    ?? positiveInteger(series?.average_runtime)
    ?? null;
  return runtime ? `${runtime}m` : undefined;
}

function translationValue(translation, fields) {
  const records = Array.isArray(translation)
    ? translation
    : Array.isArray(translation?.translations)
      ? translation.translations
      : [translation];
  for (const record of records) {
    for (const field of fields) {
      const value = record?.[field];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return null;
}

function embeddedEnglishName(series) {
  const translations = series?.translations;
  const candidates = [
    translations?.nameTranslations?.eng,
    translations?.nameTranslations?.en,
    translations?.eng?.name,
    translations?.en?.name,
  ];
  return candidates.find((value) => typeof value === "string" && value.trim())?.trim() ?? null;
}

function embeddedEnglishOverview(series) {
  const translations = series?.translations;
  const candidates = [
    translations?.overviewTranslations?.eng,
    translations?.overviewTranslations?.en,
    translations?.eng?.overview,
    translations?.en?.overview,
  ];
  return candidates.find((value) => typeof value === "string" && value.trim())?.trim() ?? null;
}

function episodeRecord(series, episode, parentId, fallbackImage, now) {
  const season = integer(episode?.seasonNumber ?? episode?.season_number ?? episode?.airedSeason);
  const number = integer(episode?.number ?? episode?.episodeNumber ?? episode?.episode_number ?? episode?.airedEpisodeNumber);
  if (season === null || number === null || season < 0 || number <= 0) return null;
  const released = isoDate(episode?.aired ?? episode?.airDate ?? episode?.firstAired ?? episode?.first_aired);
  return {
    id: `${parentId}:${season}:${number}`,
    title: episode?.name || episode?.episodeName || `Episode ${number}`,
    released: released || undefined,
    available: released ? new Date(released) <= new Date(now) : false,
    season,
    episode: number,
    thumbnail: tvdbImage(episode?.image) || fallbackImage || undefined,
    overview: episode?.overview || undefined,
    runtime: runtimeFor(series, episode),
    tvdbEpisodeId: positiveInteger(episode?.id) || undefined,
    absoluteNumber: positiveInteger(episode?.absoluteNumber ?? episode?.absolute_number) || undefined,
  };
}

function deduplicateVideos(videos) {
  const byPosition = new Map();
  for (const video of videos) {
    const key = `${video.season}:${video.episode}`;
    const existing = byPosition.get(key);
    if (!existing) {
      byPosition.set(key, video);
      continue;
    }
    const existingScore = Number(Boolean(existing.thumbnail)) * 4 + Number(Boolean(existing.overview)) * 2 + Number(Boolean(existing.released));
    const candidateScore = Number(Boolean(video.thumbnail)) * 4 + Number(Boolean(video.overview)) * 2 + Number(Boolean(video.released));
    if (candidateScore > existingScore) byPosition.set(key, video);
  }
  return [...byPosition.values()].sort((a, b) => a.season - b.season || a.episode - b.episode);
}

export function buildTvdbSeriesMetadata(series, episodes, {
  seasonType = "default",
  language = "eng",
  now = new Date(),
  signature = null,
  translation = null,
  fallbackName = null,
} = {}) {
  const tvdbId = positiveInteger(series?.id);
  if (!tvdbId) return null;
  const imdbId = validImdbId(remoteIdFor(series, /imdb/i));
  const parentId = imdbId || `tvdb:${tvdbId}`;
  const poster = tvdbImage(series?.image) || pickArtwork(series, "poster");
  const background = pickArtwork(series, "background") || poster;
  const videos = deduplicateVideos(
    (Array.isArray(episodes) ? episodes : [])
      .map((episode) => episodeRecord(series, episode, parentId, background || poster, now))
      .filter(Boolean),
  );
  if (!videos.length) return null;
  const seasonNumbers = [...new Set(videos.map((video) => video.season))];
  const genres = (Array.isArray(series?.genres) ? series.genres : [])
    .map((genre) => genre?.name || genre)
    .filter(Boolean);
  const translatedName = translationValue(translation, ["name", "title"])
    || embeddedEnglishName(series);
  const translatedOverview = translationValue(translation, ["overview", "description"])
    || embeddedEnglishOverview(series);
  return {
    version: TVDB_METADATA_VERSION,
    signature,
    attemptedAt: new Date(now).toISOString(),
    provider: "tvdb",
    tvdbId,
    imdbId,
    parentId,
    seasonType,
    language,
    name: translatedName || fallbackName || series?.name || null,
    originalName: series?.name || null,
    description: translatedOverview || series?.overview || null,
    releaseInfo: releaseInfoForSeries(series, videos),
    genres,
    runtime: runtimeFor(series, {}),
    poster,
    background,
    seasonCount: seasonNumbers.filter((season) => season > 0).length,
    specialSeasonIncluded: seasonNumbers.includes(0),
    episodeCount: videos.length,
    videos,
    matchedSeasonNumber: null,
    matchedEpisodeOffset: 0,
  };
}

function dateKey(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function dayDistance(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const left = new Date(`${a}T00:00:00.000Z`).getTime();
  const right = new Date(`${b}T00:00:00.000Z`).getTime();
  return Math.abs(left - right) / 86_400_000;
}

function normalizedTitle(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function itemHints(item) {
  return [item?.next_to_watch_info, item?._addonLatestAiredInfo]
    .filter(Boolean)
    .map((info) => ({
      episode: positiveInteger(info?.episode),
      season: integer(info?.season),
      date: dateKey(info?.date),
      title: normalizedTitle(info?.title),
    }))
    .filter((hint) => hint.episode);
}

function seasonFromTitle(title) {
  const value = String(title ?? "");
  const match = value.match(/(?:^|\s)(?:season|series)\s*(\d{1,2})(?:\s|$|:|-)/i)
    || value.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i)
    || value.match(/\bseason\s+(ii|iii|iv|v|vi|vii|viii|ix|x)\b/i)
    || value.match(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)(?:\s*[:\-]|\s*$)/i);
  if (!match) return /\bfinal\s+season\b/i.test(value) ? Number.MAX_SAFE_INTEGER : null;
  if (/^\d+$/.test(match[1])) return positiveInteger(match[1]);
  const roman = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
  return roman[String(match[1]).toLowerCase()] ?? null;
}

function trackedLibraryItem(item) {
  return ["watching", "plantowatch", "completed"].includes(item?.status);
}

function firstReleasedAt(meta) {
  const times = (meta?.videos ?? [])
    .map((video) => new Date(video?.released ?? "").getTime())
    .filter(Number.isFinite);
  return times.length ? Math.min(...times) : Number.POSITIVE_INFINITY;
}

function tmdbSeasonHint(item) {
  const media = mediaFor(item);
  const visuals = item?._addonVisuals;
  const seasons = Array.isArray(visuals?.tmdbSeasons)
    ? visuals.tmdbSeasons.filter((season) => Number(season?.seasonNumber) > 0)
    : [];
  const explicit = seasonFromTitle(media?.title);
  if (explicit !== null && explicit !== Number.MAX_SAFE_INTEGER) return explicit;

  const firstYear = yearOf(item?._addonTvdbMeta?.videos?.find((video) => video.season > 0)?.released);
  const mediaYear = positiveInteger(media?.year) ?? firstYear;
  if (mediaYear) {
    const matches = seasons.filter((season) => yearOf(season?.airDate) === mediaYear);
    if (matches.length === 1) return positiveInteger(matches[0].seasonNumber);
  }
  return null;
}

function hasSequelMarker(value) {
  const title = String(value ?? "");
  return /\b(?:season|series|part|cour)\s*(?:\d+|ii|iii|iv|v|vi|vii|viii|ix|x)\b/i.test(title)
    || /\b\d+(?:st|nd|rd|th)\s+season\b/i.test(title)
    || /\bfinal\s+season\b/i.test(title)
    || /\b(?:ii|iii|iv|v|vi|vii|viii|ix|x)(?:\s*[:\-]|\s*$)/i.test(title);
}

function titleFamilyKey(item) {
  const mediaTitle = mediaFor(item)?.title;
  const tvdbTitle = item?._addonTvdbMeta?.name;
  let value = String(mediaTitle || tvdbTitle || "").trim();
  if (!value) return null;

  const colon = value.indexOf(":");
  if (colon >= 4) {
    const prefix = value.slice(0, colon);
    const suffix = value.slice(colon + 1);
    if (hasSequelMarker(prefix) || hasSequelMarker(suffix) || prefix.split(/\s+/).length >= 2) value = prefix;
  }

  value = value
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:the\s+)?final\s+season\b/gi, " ")
    .replace(/\b(?:season|series|part|cour)\s*(?:\d+|ii|iii|iv|v|vi|vii|viii|ix|x)\b/gi, " ")
    .replace(/\b\d+(?:st|nd|rd|th)\s+season\b/gi, " ")
    .replace(/\b(?:ii|iii|iv|v|vi|vii|viii|ix|x)\b(?=\s*$)/gi, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
  return value.length >= 4 ? value : null;
}

function tvdbGroupingKey(item) {
  const meta = item?._addonTvdbMeta;
  if (!meta?.tvdbId || !Array.isArray(meta.videos) || !meta.videos.length) return null;
  const visuals = item?._addonVisuals;
  if (visuals?.tmdbMediaType === "tv" && positiveInteger(visuals?.tmdbId)) {
    return `tmdb:${positiveInteger(visuals.tmdbId)}`;
  }
  const family = titleFamilyKey(item);
  return family ? `title:${family}` : `tvdb:${meta.tvdbId}`;
}

function sourceIdentity(meta) {
  return String(meta?.tvdbId ?? meta?.parentId ?? "");
}

function nextUnusedSeason(used, preferred = null) {
  if (preferred && preferred !== Number.MAX_SAFE_INTEGER && !used.has(preferred)) return preferred;
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}

function releaseInfoForVideos(videos) {
  const years = videos.map((video) => yearOf(video?.released)).filter(Number.isFinite);
  if (!years.length) return null;
  const start = Math.min(...years);
  const end = Math.max(...years);
  return start === end ? `${start}-` : `${start}-${end}`;
}

function deduplicateMergedVideos(videos) {
  const byId = new Map();
  for (const video of videos) {
    const existing = byId.get(video.id);
    if (!existing) byId.set(video.id, video);
  }
  return [...byId.values()].sort((a, b) => a.season - b.season || a.episode - b.episode);
}

/**
 * TVDB occasionally stores anime sequels as separate series even when TMDB
 * represents the franchise as one multi-season TV show. This merges those
 * TVDB records into one static parent while retaining every source episode ID,
 * so Nuvio keeps its working watched-state reconciliation.
 */
export function unifyTvdbMetadata(items) {
  const next = structuredClone(items ?? {});
  const groups = new Map();

  for (const [key, item] of Object.entries(next)) {
    if (!trackedLibraryItem(item)) continue;
    const groupKey = tvdbGroupingKey(item);
    if (!groupKey) continue;
    const group = groups.get(groupKey) ?? [];
    group.push({ key, item });
    groups.set(groupKey, group);
  }

  for (const [groupKey, group] of groups) {
    const sourceEntries = new Map();
    for (const entry of group) {
      const identity = sourceIdentity(entry.item._addonTvdbMeta);
      const existing = sourceEntries.get(identity);
      if (!existing || (entry.item._addonTvdbMeta?.videos?.length ?? 0) > (existing.item._addonTvdbMeta?.videos?.length ?? 0)) {
        sourceEntries.set(identity, entry);
      }
    }

    const representatives = [...sourceEntries.values()].sort((a, b) => {
      const aHint = tmdbSeasonHint(a.item);
      const bHint = tmdbSeasonHint(b.item);
      return firstReleasedAt(a.item._addonTvdbMeta) - firstReleasedAt(b.item._addonTvdbMeta)
        || (aHint ?? Number.MAX_SAFE_INTEGER) - (bHint ?? Number.MAX_SAFE_INTEGER)
        || String(a.key).localeCompare(String(b.key));
    });
    if (!representatives.length) continue;

    if (groupKey.startsWith("title:") && representatives.length > 1) {
      const containsSequel = group.some((entry) => hasSequelMarker(mediaFor(entry.item)?.title)
        || hasSequelMarker(entry.item?._addonTvdbMeta?.name));
      if (!containsSequel) continue;
    }

    const sameSource = representatives.length === 1;
    const usedSeasons = new Set();
    const sourceSeasonMaps = new Map();
    const mergedVideos = [];

    for (const representative of representatives) {
      const meta = representative.item._addonTvdbMeta;
      const regularSeasons = [...new Set(meta.videos.filter((video) => video.season > 0).map((video) => video.season))]
        .sort((a, b) => a - b);
      const seasonMap = new Map();

      if (sameSource) {
        for (const season of regularSeasons) {
          seasonMap.set(season, season);
          usedSeasons.add(season);
        }
      } else {
        const preferred = tmdbSeasonHint(representative.item);
        const firstUnified = nextUnusedSeason(usedSeasons, preferred);
        regularSeasons.forEach((season, index) => {
          const candidate = index === 0 ? firstUnified : nextUnusedSeason(usedSeasons, firstUnified + index);
          seasonMap.set(season, candidate);
          usedSeasons.add(candidate);
        });
      }

      sourceSeasonMaps.set(sourceIdentity(meta), seasonMap);
      for (const video of meta.videos) {
        mergedVideos.push({
          ...video,
          season: video.season === 0 ? 0 : (seasonMap.get(video.season) ?? video.season),
          sourceTvdbId: meta.tvdbId,
        });
      }
    }

    const videos = deduplicateMergedVideos(mergedVideos);
    const seasonNumbers = [...new Set(videos.map((video) => video.season))];
    const newest = representatives.slice().sort((a, b) => firstReleasedAt(b.item._addonTvdbMeta) - firstReleasedAt(a.item._addonTvdbMeta))[0];
    const earliest = representatives[0];
    const englishName = group
      .map((entry) => entry.item?._addonVisuals?.tmdbName)
      .find((value) => typeof value === "string" && value.trim())
      || earliest.item._addonTvdbMeta?.name
      || mediaFor(earliest.item)?.title
      || null;
    const tmdbId = groupKey.startsWith("tmdb:") ? positiveInteger(groupKey.slice(5)) : null;
    const sourceTvdbIds = representatives
      .map((entry) => positiveInteger(entry.item._addonTvdbMeta.tvdbId))
      .filter(Boolean)
      .sort((a, b) => a - b);
    const parentId = sameSource
      ? earliest.item._addonTvdbMeta.parentId
      : `simkl-tvdb-unified:${tmdbId ?? sourceTvdbIds.join("-")}`;
    const canonical = {
      ...structuredClone(earliest.item._addonTvdbMeta),
      parentId,
      name: englishName,
      poster: newest.item._addonTvdbMeta?.poster || earliest.item._addonTvdbMeta?.poster,
      background: newest.item._addonTvdbMeta?.background || earliest.item._addonTvdbMeta?.background,
      releaseInfo: releaseInfoForVideos(videos) || earliest.item._addonTvdbMeta?.releaseInfo,
      seasonCount: seasonNumbers.filter((season) => season > 0).length,
      specialSeasonIncluded: seasonNumbers.includes(0),
      episodeCount: videos.length,
      videos,
      groupedBy: sameSource ? "tvdb" : "tmdb",
      sourceTvdbIds,
    };
    const displaySeasonByVideoId = new Map(videos.map((video) => [video.id, video.season]));

    for (const entry of group) {
      const own = entry.item._addonTvdbMeta;
      const seasonMap = sourceSeasonMaps.get(sourceIdentity(own)) ?? new Map();
      entry.item._addonTvdbMeta = {
        ...structuredClone(canonical),
        signature: own.signature,
        attemptedAt: own.attemptedAt,
        matchedVideoId: own.matchedVideoId,
        matchedSeasonNumber: own.matchedVideoId
          ? displaySeasonByVideoId.get(own.matchedVideoId) ?? own.matchedSeasonNumber
          : seasonMap.get(own.matchedSeasonNumber) ?? own.matchedSeasonNumber,
        matchedEpisodeOffset: own.matchedEpisodeOffset ?? 0,
      };
    }
  }

  return next;
}

export function inferTvdbPosition(item, seriesMeta) {
  const videos = Array.isArray(seriesMeta?.videos) ? seriesMeta.videos : [];
  if (!videos.length) return { matchedSeasonNumber: null, matchedEpisodeOffset: 0, matchedVideoId: null };
  const media = mediaFor(item);

  for (const hint of itemHints(item)) {
    if (hint.season !== null) {
      const target = videos.find((video) => video.season === hint.season && video.episode === hint.episode);
      if (target) {
        return { matchedSeasonNumber: target.season, matchedEpisodeOffset: 0, matchedVideoId: target.id };
      }
    }

    const dateMatches = videos
      .map((video) => ({ video, distance: dayDistance(hint.date, dateKey(video.released)) }))
      .filter(({ distance }) => distance <= 2)
      .sort((a, b) => a.distance - b.distance || Math.abs(a.video.episode - hint.episode) - Math.abs(b.video.episode - hint.episode));
    if (dateMatches.length) {
      const exactEpisode = dateMatches.find(({ video }) => video.episode === hint.episode);
      const selected = exactEpisode?.video ?? dateMatches[0].video;
      return {
        matchedSeasonNumber: selected.season,
        matchedEpisodeOffset: selected.episode - hint.episode,
        matchedVideoId: selected.id,
      };
    }

    if (hint.title) {
      const titleMatches = videos.filter((video) => normalizedTitle(video.title) === hint.title);
      if (titleMatches.length === 1) {
        const [selected] = titleMatches;
        return {
          matchedSeasonNumber: selected.season,
          matchedEpisodeOffset: selected.episode - hint.episode,
          matchedVideoId: selected.id,
        };
      }
    }
  }

  const namedSeason = seasonFromTitle(media?.title);
  if (namedSeason !== null && videos.some((video) => video.season === namedSeason)) {
    return { matchedSeasonNumber: namedSeason, matchedEpisodeOffset: 0, matchedVideoId: null };
  }

  const mediaYear = positiveInteger(media?.year);
  if (mediaYear) {
    const matchingSeasons = [...new Set(
      videos
        .filter((video) => yearOf(video.released) === mediaYear && video.season > 0)
        .map((video) => video.season),
    )];
    if (matchingSeasons.length === 1) {
      return { matchedSeasonNumber: matchingSeasons[0], matchedEpisodeOffset: 0, matchedVideoId: null };
    }
  }

  const regularSeasons = [...new Set(videos.filter((video) => video.season > 0).map((video) => video.season))];
  if (regularSeasons.length === 1) {
    return { matchedSeasonNumber: regularSeasons[0], matchedEpisodeOffset: 0, matchedVideoId: null };
  }
  return { matchedSeasonNumber: null, matchedEpisodeOffset: 0, matchedVideoId: null };
}

function sourceSignature(ids, seasonType, language) {
  return JSON.stringify({
    version: TVDB_METADATA_VERSION,
    seasonType,
    language,
    tvdb: ids?.tvdb ?? ids?.tvdb_id ?? null,
    imdb: ids?.imdb ?? ids?.imdb_id ?? null,
  });
}

function stillFresh(meta, signature, now) {
  if (!meta?.attemptedAt || meta.signature !== signature) return false;
  const attemptedAt = new Date(meta.attemptedAt).getTime();
  if (!Number.isFinite(attemptedAt)) return false;
  const ttl = meta.error ? FAILURE_TTL_MS : SUCCESS_TTL_MS;
  return now.getTime() - attemptedAt < ttl;
}

function isAuthenticationFailure(error) {
  return error instanceof TvdbApiError && (error.status === 401 || error.status === 403);
}

export async function enrichTvdbMetadata(items, {
  apiKey,
  pin,
  seasonType = "default",
  language = "eng",
  fetchImpl = fetch,
  now = new Date(),
  itemFilter = (item) => ["watching", "plantowatch", "completed"].includes(item?.status),
} = {}) {
  const client = createTvdbClient({ apiKey, pin, fetchImpl });
  const next = structuredClone(items ?? {});
  const warnings = [];
  if (!client) {
    for (const item of Object.values(next)) delete item._addonTvdbMeta;
    return { items: next, warnings, usesTvdb: false };
  }

  const templates = new Map();
  for (const item of Object.values(next)) {
    const meta = item?._addonTvdbMeta;
    if (meta?.tvdbId && Array.isArray(meta.videos) && meta.videos.length) {
      templates.set(String(meta.tvdbId), structuredClone(meta));
    }
  }

  for (const [key, item] of Object.entries(next)) {
    if (!itemFilter(item)) continue;
    const media = mediaFor(item);
    if (!media) continue;
    const initialSignature = sourceSignature(media.ids, seasonType, language);
    if (stillFresh(item._addonTvdbMeta, initialSignature, new Date(now))) continue;

    try {
      const seriesId = await client.resolveSeriesId(media.ids ?? {});
      if (!seriesId) {
        item._addonTvdbMeta = {
          signature: initialSignature,
          attemptedAt: new Date(now).toISOString(),
          provider: null,
          error: false,
        };
        continue;
      }
      media.ids ??= {};
      media.ids.tvdb ||= seriesId;
      const finalSignature = sourceSignature(media.ids, seasonType, language);
      let template = templates.get(String(seriesId));
      if (!template || template.version !== TVDB_METADATA_VERSION || template.seasonType !== seasonType || template.language !== language || !Array.isArray(template.videos) || !template.videos.length) {
        const [series, episodes, translation] = await Promise.all([
          client.getSeriesExtended(seriesId),
          client.getSeriesEpisodes(seriesId, { seasonType, language }),
          client.getSeriesTranslation(seriesId, language),
        ]);
        template = buildTvdbSeriesMetadata(series, episodes, {
          seasonType,
          language,
          now,
          signature: finalSignature,
          translation,
          fallbackName: item?._addonVisuals?.tmdbName || media.title,
        });
        if (template) templates.set(String(seriesId), structuredClone(template));
      }
      if (!template) {
        item._addonTvdbMeta = {
          signature: finalSignature,
          attemptedAt: new Date(now).toISOString(),
          provider: "tvdb",
          tvdbId: seriesId,
          error: true,
        };
        continue;
      }
      const position = inferTvdbPosition(item, template);
      item._addonTvdbMeta = {
        ...structuredClone(template),
        signature: finalSignature,
        attemptedAt: new Date(now).toISOString(),
        ...position,
      };
    } catch (error) {
      if (isAuthenticationFailure(error)) throw error;
      warnings.push({ simklId: simklIdFor(item), message: error.message });
      item._addonTvdbMeta = {
        ...(item._addonTvdbMeta ?? {}),
        signature: initialSignature,
        attemptedAt: new Date(now).toISOString(),
        error: true,
      };
    }
  }

  return { items: unifyTvdbMetadata(next), warnings, usesTvdb: true };
}
