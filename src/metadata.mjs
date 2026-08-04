import { mediaFor, simklIdFor } from "./state.mjs";

const TMDB_API_BASE = "https://api.themoviedb.org";
const MDBLIST_API_BASE = "https://api.mdblist.com";
const SUCCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 6 * 60 * 60 * 1000;

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

  async function details(mediaType, tmdbId) {
    const result = await get(`/3/${mediaType}/${encodeURIComponent(tmdbId)}`, {
      language: "en-US",
      append_to_response: "external_ids",
    });
    return { ...result, _addonTmdbMediaType: mediaType };
  }

  return {
    async resolveSeries(ids = {}) {
      const candidates = [
        ids.imdb && [ids.imdb, "imdb_id"],
        ids.tvdb && [ids.tvdb, "tvdb_id"],
      ].filter(Boolean);

      for (const [externalId, externalSource] of candidates) {
        const found = await get(`/3/find/${encodeURIComponent(externalId)}`, {
          external_source: externalSource,
          language: "en-US",
        });
        const tvMatch = found?.tv_results?.[0];
        if (tvMatch?.id) return details("tv", tvMatch.id);
        const movieMatch = found?.movie_results?.[0];
        if (movieMatch?.id) return details("movie", movieMatch.id);
      }

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
    version: 1,
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
        item._addonVisuals = {
          signature: sourceSignature(media.ids, sources),
          attemptedAt: new Date(now).toISOString(),
          provider: "tmdb",
          poster: tmdbImage(tmdbResult.poster_path, "w500"),
          background: tmdbImage(tmdbResult.backdrop_path, "w1280"),
          tmdbId: tmdbResult.id,
          tmdbMediaType: tmdbResult._addonTmdbMediaType || "tv",
        };
      } else if (mdblistResult) {
        item._addonVisuals = {
          signature: sourceSignature(media.ids, sources),
          attemptedAt: new Date(now).toISOString(),
          provider: "mdblist",
          poster: mdblistResult.poster || mdblistResult.poster_url || null,
          background: mdblistResult.backdrop || mdblistResult.backdrop_url || null,
        };
      } else {
        item._addonVisuals = {
          signature: sourceSignature(media.ids, sources),
          attemptedAt: new Date(now).toISOString(),
          provider: null,
          poster: null,
          background: null,
        };
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
