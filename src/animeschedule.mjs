// English-dub information from AnimeSchedule.net (anime account only).
//
// Two sources are combined:
//   1. The weekly dub timetable (/timetables/dub, optionally ?year=&week=)
//      gives exact dubbed episode numbers. Every run records the current and
//      previous week into a private "ledger"; the first run backfills
//      BACKFILL_WEEKS weeks so recently finished dubs are known too.
//   2. The Anime object (/anime?mal-ids=…) matches Simkl titles by MyAnimeList
//      ID (then AniList / AniDB) and says whether a dub exists at all
//      (dubPremier), how many episodes there are, and when batch releases or
//      delays happened. It is used to recognise dubs that finished before the
//      ledger window ("fully dubbed").
//
// No title searching is ever used, so a wrong show can never be matched.

import { mediaFor } from "./state.mjs";

const API_BASE = "https://animeschedule.net/api/v3";
const IDS_PER_PAGE = 18;                       // /anime returns at most 18 per page
const MATCH_TTL_MS = 24 * 60 * 60 * 1000;      // re-check matches daily
const LEDGER_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const BACKFILL_WEEKS = 26;
const REQUEST_GAP_MS = 600;                    // global limit is 120/min; stay well under
const NULL_DATE_YEAR = 1;                      // API uses 0001-01-01T00:00:00Z for "null"
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export class AnimeScheduleApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "AnimeScheduleApiError";
    this.provider = "AnimeSchedule";
    this.status = status;
  }
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() <= NULL_DATE_YEAR) return null;
  return date;
}

function positiveInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ISO-8601 week number and week-year.
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7) };
}

export function createAnimeScheduleClient({ token, fetchImpl = fetch, gapMs = REQUEST_GAP_MS } = {}) {
  if (!token) return null;
  let last = 0;

  async function get(pathAndQuery) {
    const wait = last + gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const response = await fetchImpl(`${API_BASE}${pathAndQuery}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (response.status === 429) {
      const reset = Number(response.headers?.get?.("x-ratelimit-reset"));
      const delay = Number.isFinite(reset) ? Math.min(60_000, Math.max(1000, reset * 1000 - Date.now())) : 5000;
      await sleep(delay);
      return get(pathAndQuery);
    }
    if (!response.ok) {
      throw new AnimeScheduleApiError(`AnimeSchedule responded ${response.status} for ${pathAndQuery.split("?")[0]}`, response.status);
    }
    return response.json();
  }

  return {
    async dubTimetable(year, week) {
      const query = year && week ? `?year=${year}&week=${week}` : "";
      const body = await get(`/timetables/dub${query}`);
      return Array.isArray(body) ? body : [];
    },
    // Looks up anime by external IDs. kind is mal | anilist | anidb.
    async animeByIds(kind, ids, onBody) {
      const results = [];
      for (let i = 0; i < ids.length; i += IDS_PER_PAGE) {
        const chunk = ids.slice(i, i + IDS_PER_PAGE);
        const query = chunk.map((id) => `${kind}-ids=${encodeURIComponent(id)}`).join("&");
        const body = await get(`/anime?${query}`);
        onBody?.(body);
        const list = Array.isArray(body) ? body
          : Array.isArray(body?.anime) ? body.anime
          : Array.isArray(body?.data) ? body.data
          : Object.values(body ?? {}).find(Array.isArray) ?? [];
        results.push(...list);
      }
      return results;
    },
  };
}

// ---------------------------------------------------------------------------
// Ledger: highest dubbed episode per AnimeSchedule route, from timetables.
// ---------------------------------------------------------------------------
export function recordTimetable(ledger, entries, now = new Date()) {
  const next = { ...(ledger ?? {}) };
  for (const entry of entries ?? []) {
    if (!entry?.route) continue;
    if (entry.airType && String(entry.airType).toLowerCase() !== "dub") continue;
    const status = String(entry.airingStatus ?? "").toLowerCase();
    if (status === "unaired" || status === "delayed-air") continue;
    const date = validDate(entry.episodeDate);
    const episode = positiveInt(entry.episodeNumber);
    if (!date || !episode || date > now) continue;
    const existing = next[entry.route];
    if (!existing || episode > existing.episode) {
      next[entry.route] = { episode, date: date.toISOString() };
    }
  }
  for (const [route, value] of Object.entries(next)) {
    const date = validDate(value?.date);
    if (!date || now - date > LEDGER_MAX_AGE_MS) delete next[route];
  }
  return next;
}

// ---------------------------------------------------------------------------
// Matching Simkl titles to AnimeSchedule anime.
// ---------------------------------------------------------------------------
function externalIdsFor(item) {
  const ids = mediaFor(item)?.ids ?? {};
  return {
    mal: positiveInt(ids.mal),
    anilist: positiveInt(ids.anilist),
    anidb: positiveInt(ids.anidb),
  };
}

// Website values are links such as "myanimelist.net/anime/5114/Title_2",
// "anilist.co/anime/5114/..." or "anidb.net/anime/12345" / "anidb.net/a12345".
export function websiteId(anime, key) {
  const value = String(anime?.websites?.[key] ?? "").trim();
  if (!value) return null;
  const match = value.match(/\/anime\/(\d+)/i)
    || value.match(/[?&]aid=(\d+)/i)
    || value.match(/anidb\.net\/a(\d+)/i)
    || value.match(/^(\d+)$/);
  return match ? Number(match[1]) : null;
}

function summarizeAnime(anime) {
  const override = anime?.dubEpisodeOverride ?? null;
  return {
    route: anime.route,
    title: anime.title || null,
    episodes: positiveInt(anime.episodes),
    status: anime.status || null,
    dubPremier: validDate(anime.dubPremier)?.toISOString() ?? null,
    dubDelayedUntil: validDate(anime.dubDelayedUntil)?.toISOString() ?? null,
    dubOverride: override && validDate(override.overrideDate)
      ? {
          date: validDate(override.overrideDate).toISOString(),
          episode: positiveInt(override.overrideEpisode),
          extra: Number(override.episodesAired) || 0,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Dub state for one title.
// ---------------------------------------------------------------------------
// Returns { route, episode, full, estimated } or null when no dub is known.
export function resolveDub(match, ledgerEntry, now = new Date()) {
  if (!match?.route || !match.dubPremier) return null;           // no English dub
  const premier = validDate(match.dubPremier);
  if (!premier || premier > now) return null;                     // dub not out yet
  const total = match.episodes;
  const finished = String(match.status ?? "").toLowerCase() === "finished";

  if (ledgerEntry?.episode) {
    const full = Boolean(finished && total && ledgerEntry.episode >= total);
    return { route: match.route, episode: ledgerEntry.episode, full, estimated: false };
  }

  // Not in the ledger window: only claim "fully dubbed" when it is clear-cut.
  if (!finished || !total) return null;
  const delayedUntil = validDate(match.dubDelayedUntil);
  if (delayedUntil && delayedUntil > now) return null;
  const override = match.dubOverride;
  if (override?.episode && validDate(override.date) <= now && override.episode + override.extra >= total) {
    return { route: match.route, episode: total, full: true, estimated: true };
  }
  // Weekly cadence plus a month of slack for breaks.
  const expectedEnd = premier.getTime() + (total - 1) * WEEK_MS + 4 * WEEK_MS;
  if (now.getTime() > expectedEnd) {
    return { route: match.route, episode: total, full: true, estimated: true };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Refresh: update ledger + matches, attach item._addonDub.
// ---------------------------------------------------------------------------
export async function enrichDubInfo(items, dubState, {
  token,
  fetchImpl = fetch,
  now = new Date(),
  itemFilter = () => true,
  gapMs,
} = {}) {
  const client = createAnimeScheduleClient({ token, fetchImpl, gapMs });
  const nextItems = structuredClone(items ?? {});
  const state = {
    ledger: { ...(dubState?.ledger ?? {}) },
    matches: { ...(dubState?.matches ?? {}) },
    backfilledAt: dubState?.backfilledAt ?? null,
  };
  const warnings = [];
  if (!client) return { items: nextItems, dubState: state, warnings, enabled: false, stats: null };

  // 1) Timetables: backfill once, then this week and last week every run.
  const weeks = [];
  const span = state.backfilledAt ? 2 : BACKFILL_WEEKS;
  for (let i = 0; i < span; i += 1) weeks.push(isoWeek(new Date(now.getTime() - i * WEEK_MS)));
  let weeksRead = 0;
  for (const [index, { year, week }] of weeks.entries()) {
    try {
      const entries = index === 0 ? await client.dubTimetable() : await client.dubTimetable(year, week);
      state.ledger = recordTimetable(state.ledger, entries, now);
      weeksRead += 1;
    } catch (error) {
      if (error.status === 401 || error.status === 403) throw error;
      warnings.push({ message: `Dub timetable ${year}-W${week}: ${error.message}` });
    }
  }
  if (!state.backfilledAt && weeksRead >= Math.ceil(BACKFILL_WEEKS / 2)) state.backfilledAt = now.toISOString();

  // 2) Matches for the titles that matter, by MAL → AniList → AniDB.
  const targets = Object.entries(nextItems).filter(([, item]) => itemFilter(item));
  const withIds = targets.filter(([, item]) => Object.values(externalIdsFor(item)).some(Boolean)).length;
  let responseShape = null;
  const stale = (key) => {
    const cached = state.matches[key];
    return !cached || now - new Date(cached.checkedAt) > MATCH_TTL_MS;
  };
  for (const kind of ["mal", "anilist", "anidb"]) {
    const wanted = new Map();
    for (const [, item] of targets) {
      const ids = externalIdsFor(item);
      if (!ids[kind]) continue;
      // Skip if an earlier, stronger ID already matched this title.
      const stronger = ["mal", "anilist", "anidb"].slice(0, ["mal", "anilist", "anidb"].indexOf(kind));
      if (stronger.some((k) => ids[k] && state.matches[`${k}:${ids[k]}`]?.route)) continue;
      const key = `${kind}:${ids[kind]}`;
      if (stale(key)) wanted.set(ids[kind], key);
    }
    if (!wanted.size) continue;
    try {
      const found = await client.animeByIds(kind, [...wanted.keys()], (body) => {
        responseShape ??= Array.isArray(body) ? "array" : Object.keys(body ?? {}).join(",");
      });
      const siteKey = kind === "mal" ? "mal" : kind === "anilist" ? "aniList" : "anidb";
      const byId = new Map();
      for (const anime of found) {
        const id = websiteId(anime, siteKey);
        if (id && anime?.route) byId.set(id, anime);
      }
      for (const [id, key] of wanted) {
        const anime = byId.get(id);
        state.matches[key] = anime
          ? { ...summarizeAnime(anime), checkedAt: now.toISOString() }
          : { route: null, checkedAt: now.toISOString() };
      }
    } catch (error) {
      if (error.status === 401 || error.status === 403) throw error;
      warnings.push({ message: `Anime lookup by ${kind}: ${error.message}` });
    }
  }

  // 3) Attach dub info to each item.
  let dubbed = 0;
  let matched = 0;
  for (const [, item] of targets) {
    const ids = externalIdsFor(item);
    const match = ["mal", "anilist", "anidb"]
      .map((kind) => ids[kind] && state.matches[`${kind}:${ids[kind]}`])
      .find((value) => value?.route);
    if (match) matched += 1;
    const dub = match ? resolveDub(match, state.ledger[match.route], now) : null;
    if (dub) {
      // Simkl and AnimeSchedule may number split cours differently. If the dub
      // episode is beyond Simkl's own episode count, never claim "ready".
      const simklTotal = positiveInt(item.total_episodes_count);
      dub.numberingMismatch = Boolean(!dub.full && simklTotal && dub.episode > simklTotal);
      item._addonDub = dub;
      dubbed += 1;
    } else {
      delete item._addonDub;
    }
    if (match?.route) item._addonAnimeScheduleRoute = match.route;
  }

  return {
    items: nextItems,
    dubState: state,
    warnings,
    enabled: true,
    stats: { weeksRead, ledgerShows: Object.keys(state.ledger).length, matched, dubbed, titles: targets.length, withIds, responseShape },
  };
}

