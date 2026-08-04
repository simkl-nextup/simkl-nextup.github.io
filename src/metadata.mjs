import { mediaFor, simklIdFor } from "./state.mjs";

const TMDB_API_BASE = "https://api.themoviedb.org";
const MDBLIST_API_BASE = "https://api.mdblist.com";
const SUCCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 6 * 60 * 60 * 1000;
const SERIES_METADATA_VERSION = 2;
const TMDB_SEASON_CONCURRENCY = 4;

export class MetadataApiError extends Error {
  constructor(provider, message, status, body) {
    super(`${provider} request failed: ${message}`);
    this.name = "MetadataApiError";
    this.provider = provider;
    this.status = status;
    this.body = body;
  }
}

async function readResponse(response, provider) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new MetadataApiError(provider, "non-JSON response", response.status, text.slice(0, 500));
  }
  if (!response.ok) {
    const reason = body?.status_message || body?.detail || body?.message || body?.error || response.statusText;
    throw new MetadataApiError(provider, reason, response.status, body);
  }
  return body;
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let cursor = 0;

  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}

export function createTmdbClient({ accessToken, fetchImpl = fetch }) {
  if (!accessToken) return null;

  async function get(path, params = {}) {
    const url = new URL(path, TMDB_API_BASE);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return readResponse(response, "TMDB");
  }

  async function details(mediaType, tmdbId, match = {}) {
    const result = await get(`/3/${mediaType}/${encodeURIComponent(tmdbId)}`, {
      language: "en-US",
      append_to_response: "external_ids",
    });
    return { ...result, _addonTmdbMediaType: mediaType, ...match };
  }

  return {
    async resolveSeries(ids = {}) {
      const candidates = [
        ids.imdb && [ids.imdb, "imdb_id"],
        ids.tvdb && [ids.tvdb, "tvdb_id"],
      ].filter(Boolean);

      let movieFallback = null;
      for (const [externalId, externalSource] of candidates) {
        const found = await get(`/3/find/${encodeURIComponent(externalId)}`, {
          external_source: externalSource,
          language: "en-US",
        });

        const episodeMatch = found?.tv_episode_results?.[0];
        if (episodeMatch?.show_id) {
          return details("tv", episodeMatch.show_id, {
            _addonMatchedSeasonNumber: episodeMatch.season_number,
            _addonMatchedEpisodeNumber: episodeMatch.episode_number,
          });
        }

        const seasonMatch = found?.tv_season_results?.[0];
        if (seasonMatch?.show_id) {
          return details("tv", seasonMatch.show_id, {
            _addonMatchedSeasonNumber: seasonMatch.season_number,
          });
        }

        const tvMatch = found?.tv_results?.[0];
        if (tvMatch?.id) return details("tv", tvMatch.id);

        const movieMatch = found?.movie_results?.[0];
        if (movieMatch?.id && !movieFallback) movieFallback = movieMatch.id;
      }

      if (movieFallback) return details("movie", movieFallback);

      if (ids.tmdb) {
        try {
          return await details("tv", ids.tmdb);
        } catch (error) {
          if (!(error instanceof MetadataApiError) || error.status !== 404) throw error;
          return details("movie", ids.tmdb);
        }
      }
      return null;
    },

    async getTvSeasons(tmdbId, seasons = []) {
      const published = seasons
        .filter((season) => Number.isInteger(Number(season?.season_number)) && Number(season?.episode_count) > 0)
        .sort((a, b) => Number(a.season_number) - Number(b.season_number));

      return mapWithConcurrency(published, TMDB_SEASON_CONCURRENCY, (season) =>
        get(`/3/tv/${encodeURIComponent(tmdbId)}/season/${encodeURIComponent(season.season_number)}`, {
          language: "en-US",
        }));
    },
  };
}

export function createMdblistClient({ apiKey, fetchImpl = fetch }) {
  if (!apiKey) return null;

  return {
    async resolveSeries(ids = {}) {
      const candidate = [
        ids.imdb && ["imdb", ids.imdb],
        ids.tmdb && ["tmdb", ids.tmdb],
        ids.tvdb && ["tvdb", ids.tvdb],
        ids.mal && ["mal", ids.mal],
      ].find(Boolean);
      if (!candidate) return null;

      const [provider, id] = candidate;
      const url = new URL(`/${provider}/show/${encodeURIComponent(id)}/`, MDBLIST_API_BASE);
      url.searchParams.set("apikey", apiKey);
      const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
      return readResponse(response, "MDBList");
    },
  };
}

function normalizedIds(value = {}) {
  return {
    imdb: value.imdb || value.imdb_id || value.imdbid || null,
    tmdb: value.tmdb || value.tmdb_id || value.tmdbid || null,
    tvdb: value.tvdb || value.tvdb_id || value.tvdbid || null,
    mal: value.mal || value.mal_id || value.malid || null,
  };
}

function mergeIds(target, incoming) {
  const ids = normalizedIds(incoming);
  target.ids ??= {};
  for (const [key, value] of Object.entries(ids)) {
    if (value !== null && value !== undefined && value !== "") target.ids[key] ||= value;
  }
}

function tmdbImage(path, size) {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

function sourceSignature(ids, sources) {
  return JSON.stringify({
    version: SERIES_METADATA_VERSION,
    sources,
    imdb: ids?.imdb ?? null,
    tmdb: ids?.tmdb ?? null,
    tvdb: ids?.tvdb ?? null,
    mal: ids?.mal ?? null,
  });
}

function stillFresh(visuals, signature, now) {
  if (!visuals?.attemptedAt || visuals.signature !== signature) return false;
  const attemptedAt = new Date(visuals.attemptedAt).getTime();
  if (!Number.isFinite(attemptedAt)) return false;
  const ttl = visuals.error ? FAILURE_TTL_MS : SUCCESS_TTL_MS;
  return now.getTime() - attemptedAt < ttl;
}

function isAuthenticationFailure(error) {
  return error instanceof MetadataApiError && (error.status === 401 || error.status === 403);
}

function weakForTmdb(ids = {}) {
  return !ids.tmdb && !ids.imdb && !ids.tvdb;
}

function validImdbId(value) {
  return typeof value === "string" && /^tt\d+$/.test(value) ? value : null;
}

function isoAirDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function releaseInfoForTmdbSeries(series) {
  const start = String(series?.first_air_date ?? "").slice(0, 4);
  const end = String(series?.last_air_date ?? "").slice(0, 4);
  if (!/^\d{4}$/.test(start)) return null;
  if (series?.status === "Ended" || series?.status === "Canceled") {
    return /^\d{4}$/.test(end) && end !== start ? `${start}-${end}` : start;
  }
  return `${start}-`;
}

function buildSeriesMetadata(series, seasonPayloads, signature, now) {
  if (series?._addonTmdbMediaType !== "tv") return null;

  const imdbId = validImdbId(series.external_ids?.imdb_id);
  const videoIdBase = imdbId || `tmdb:${series.id}`;
  const videos = seasonPayloads
    .flatMap((season) => (season?.episodes ?? []).map((episode) => {
      const seasonNumber = Number(episode.season_number ?? season.season_number);
      const episodeNumber = Number(episode.episode_number);
      const released = isoAirDate(episode.air_date);
      if (!Number.isInteger(seasonNumber) || !Number.isInteger(episodeNumber) || !released) return null;
      return {
        id: `${videoIdBase}:${seasonNumber}:${episodeNumber}`,
        title: episode.name || `Episode ${episodeNumber}`,
        released,
        season: seasonNumber,
        episode: episodeNumber,
        thumbnail: tmdbImage(episode.still_path, "w300") || undefined,
        overview: episode.overview || undefined,
      };
    }))
    .filter(Boolean)
    .sort((a, b) => a.season - b.season || a.episode - b.episode);

  const seasonNumbers = [...new Set(videos.map((video) => video.season))];
  return {
    signature,
    attemptedAt: new Date(now).toISOString(),
    provider: "tmdb",
    parentId: `simkl-unified:${series.id}`,
    tmdbId: series.id,
    imdbId,
    videoIdBase,
    matchedSeasonNumber: series._addonMatchedSeasonNumber !== null
      && series._addonMatchedSeasonNumber !== undefined
      && Number.isInteger(Number(series._addonMatchedSeasonNumber))
      ? Number(series._addonMatchedSeasonNumber)
      : null,
    name: series.name || series.original_name || null,
    description: series.overview || null,
    releaseInfo: releaseInfoForTmdbSeries(series),
    genres: Array.isArray(series.genres) ? series.genres.map((genre) => genre?.name).filter(Boolean) : [],
    runtime: Number(series.episode_run_time?.[0]) > 0 ? `${Number(series.episode_run_time[0])}m` : null,
    status: series.status || null,
    seasonCount: seasonNumbers.filter((season) => season > 0).length,
    specialSeasonIncluded: seasonNumbers.includes(0),
    episodeCount: videos.length,
    videos,
  };
}

export async function enrichCatalogMetadata(items, {
  tmdbAccessToken,
  mdblistApiKey,
  fetchImpl = fetch,
  now = new Date(),
  itemFilter = (item) => item?.status === "watching",
} = {}) {
  const tmdb = createTmdbClient({ accessToken: tmdbAccessToken, fetchImpl });
  const mdblist = createMdblistClient({ apiKey: mdblistApiKey, fetchImpl });
  const sources = [tmdb && "tmdb", mdblist && "mdblist"].filter(Boolean);
  const next = structuredClone(items ?? {});
  const warnings = [];

  if (!sources.length) return { items: next, warnings, usesTmdb: false };

  for (const [key, item] of Object.entries(next)) {
    if (!itemFilter(item)) continue;
    const media = mediaFor(item);
    if (!media) continue;

    const initialSignature = sourceSignature(media.ids, sources);
    if (stillFresh(item._addonVisuals, initialSignature, new Date(now))) continue;

    try {
      let mdblistResult = null;
      if (mdblist && weakForTmdb(media.ids)) {
        mdblistResult = await mdblist.resolveSeries(media.ids);
        if (mdblistResult) mergeIds(media, mdblistResult);
      }

      let tmdbResult = null;
      if (tmdb) tmdbResult = await tmdb.resolveSeries(media.ids);

      if (tmdbResult) {
        mergeIds(media, {
          tmdb: tmdbResult.id,
          imdb: tmdbResult.external_ids?.imdb_id,
          tvdb: tmdbResult.external_ids?.tvdb_id,
        });
        const finalSignature = sourceSignature(media.ids, sources);
        item._addonVisuals = {
          signature: finalSignature,
          attemptedAt: new Date(now).toISOString(),
          provider: "tmdb",
          poster: tmdbImage(tmdbResult.poster_path, "w500"),
          background: tmdbImage(tmdbResult.backdrop_path, "w1280"),
          tmdbId: tmdbResult.id,
          tmdbMediaType: tmdbResult._addonTmdbMediaType || "tv",
        };

        if (tmdbResult._addonTmdbMediaType === "tv") {
          const seasonPayloads = await tmdb.getTvSeasons(tmdbResult.id, tmdbResult.seasons ?? []);
          item._addonSeriesMeta = buildSeriesMetadata(tmdbResult, seasonPayloads, finalSignature, now);
        } else {
          delete item._addonSeriesMeta;
        }
      } else if (mdblistResult) {
        item._addonVisuals = {
          signature: sourceSignature(media.ids, sources),
          attemptedAt: new Date(now).toISOString(),
          provider: "mdblist",
          poster: mdblistResult.poster || mdblistResult.poster_url || null,
          background: mdblistResult.backdrop || mdblistResult.backdrop_url || null,
        };
        delete item._addonSeriesMeta;
      } else {
        item._addonVisuals = {
          signature: sourceSignature(media.ids, sources),
          attemptedAt: new Date(now).toISOString(),
          provider: null,
          poster: null,
          background: null,
        };
        delete item._addonSeriesMeta;
      }
    } catch (error) {
      if (isAuthenticationFailure(error)) throw error;
      warnings.push({ simklId: simklIdFor(item), message: error.message });
      item._addonVisuals = {
        ...(item._addonVisuals ?? {}),
        signature: initialSignature,
        attemptedAt: new Date(now).toISOString(),
        error: true,
      };
    }
  }

  return { items: next, warnings, usesTmdb: Boolean(tmdb) };
}
