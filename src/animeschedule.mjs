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
const MATCH_VERSION = 2;                       // bump to discard cached (failed) matches
const LEDGER_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const BACKFILL_WEEKS = 26;
const REQUEST_GAP_MS = 600;                    // global limit is 120/min; stay well under
const NULL_DATE_YEAR = 1;                      // API uses 0001-01-01T00:00:00Z for "null"
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Community list of anime with English dubs, keyed by MAL ID (fetched at run
// time, not redistributed). "incomplete" = only partly dubbed.
export const MAL_DUBS_URL = "https://raw.githubusercontent.com/MAL-Dubs/MAL-Dubs/main/data/dubInfo.json";
const MAL_DUBS_TTL_MS = 24 * 60 * 60 * 1000;
// MAL-Dubs lists simuldubs as soon as they start, so "dubbed" only means
// "fully dubbed" once the show has stopped airing.
const FINISHED_LONG_AGO_MS = 60 * 24 * 60 * 60 * 1000;   // Japanese run ended 60+ days ago
const STILL_AIRING_MS = 14 * 24 * 60 * 60 * 1000;        // an episode aired in the last 2 weeks

// Newest episode air date we know for this title (Simkl calendar, next-to-watch, TVDB).
export function lastAiredAt(item, now = new Date()) {
  const dates = [item?._addonLatestAiredInfo?.date, item?.next_to_watch_info?.date];
  for (const video of item?._addonTvdbMeta?.videos ?? []) dates.push(video?.released);
  let latest = null;
  for (const value of dates) {
    const date = validDate(value);
    if (date && date <= now && (!latest || date > latest)) latest = date;
  }
  return latest;
}

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
    // "Couldn't find anime with these parameters." comes back as a non-2xx
    // plain-text reply; that simply means no results.
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new AnimeScheduleApiError(`AnimeSchedule responded ${response.status} for ${pathAndQuery.split("?")[0]}`, response.status);
    }
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      if (/couldn'?t find/i.test(text)) return null;
      throw new AnimeScheduleApiError(`AnimeSchedule returned non-JSON for ${pathAndQuery.split("?")[0]}: ${text.slice(0, 80)}`, response.status);
    }
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
        // mt defaults to "all" (a show must match EVERY id → nothing for 2+ ids);
        // "any" returns each matching show. Verified against the live API.
        const query = chunk.map((id) => `${kind}-ids=${encodeURIComponent(id)}`).join("&") + (chunk.length > 1 ? "&mt=any" : "");
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

function hasDubTime(value) {
  const date = validDate(value);
  if (!date) return false;
  return date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0;
}

function summarizeAnime(anime) {
  const override = anime?.dubEpisodeOverride ?? null;
  return {
    route: anime.route,
    title: anime.title || null,
    episodes: positiveInt(anime.episodes),
    status: anime.status || null,
    dubPremier: validDate(anime.dubPremier)?.toISOString() ?? null,
    // AnimeSchedule: a show is dubbed when dubPremier is set OR it has a dub
    // air time (not 00:00) — same-day simuldubs often only have the latter.
    hasDubTime: hasDubTime(anime.dubTime),
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

function normalizeName(value) {
  return String(value ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function titlesFor(item) {
  const media = mediaFor(item);
  return [media?.title, media?.en_title, item?._addonTvdbMeta?.name, item?._addonVisuals?.tmdbName].filter(Boolean);
}

// Loose name check used only to confirm a single-result lookup.
export function namesMatch(anime, titles) {
  const names = [anime?.title, anime?.names?.english, anime?.names?.romaji, anime?.names?.native,
    ...(Array.isArray(anime?.names?.synonyms) ? anime.names.synonyms : [])].map(normalizeName).filter(Boolean);
  for (const title of titles.map(normalizeName).filter(Boolean)) {
    for (const name of names) {
      if (name === title || name.includes(title) || title.includes(name)) return true;
      const a = new Set(title.split(" ")), b = new Set(name.split(" "));
      const common = [...a].filter((word) => b.has(word)).length;
      if (common / Math.min(a.size, b.size) >= 0.6) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Dub state for one title.
// ---------------------------------------------------------------------------
// Returns { route, episode, full, estimated } or null when no dub is known.
export function resolveDub(match, ledgerEntry, now = new Date()) {
  if (!match?.route) return null;
  const total = match.episodes;
  const finished = String(match.status ?? "").toLowerCase() === "finished";

  // A dubbed episode on the dub timetable is proof on its own, even when
  // AnimeSchedule has no separate dubPremier (common for same-day simuldubs).
  if (ledgerEntry?.episode) {
    const full = Boolean(finished && total && ledgerEntry.episode >= total);
    return { route: match.route, episode: ledgerEntry.episode, full, estimated: false };
  }

  // Not in the ledger window: only claim "fully dubbed" when it is clear-cut.
  const premier = validDate(match.dubPremier);
  if (!premier || premier > now) return null;                     // no dub, or not out yet
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

  // 0) MAL-Dubs list, refreshed daily.
  state.malDubs = dubState?.malDubs ?? null;
  if (!state.malDubs || now - new Date(state.malDubs.checkedAt) > MAL_DUBS_TTL_MS) {
    try {
      const response = await fetchImpl(MAL_DUBS_URL, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`MAL-Dubs responded ${response.status}`);
      const body = await response.json();
      state.malDubs = {
        checkedAt: now.toISOString(),
        dubbed: Array.isArray(body?.dubbed) ? body.dubbed.map(Number).filter(Number.isFinite) : [],
        incomplete: Array.isArray(body?.incomplete) ? body.incomplete.map(Number).filter(Number.isFinite) : [],
      };
    } catch (error) {
      warnings.push({ message: `MAL-Dubs list: ${error.message}` });
    }
  }
  const malDubbed = new Set(state.malDubs?.dubbed ?? []);
  const malIncomplete = new Set(state.malDubs?.incomplete ?? []);

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
    return !cached || cached.v !== MATCH_VERSION || now - new Date(cached.checkedAt) > MATCH_TTL_MS;
  };
  let sampleAnime = null;
  let singleLookups = 0;
  const siteKeyFor = { mal: "mal", anilist: "aniList", anidb: "anidb" };
  for (const kind of ["mal", "anilist", "anidb"]) {
    const wanted = new Map();
    for (const [, item] of targets) {
      const ids = externalIdsFor(item);
      if (!ids[kind]) continue;
      // Skip if an earlier, stronger ID already matched this title.
      const stronger = ["mal", "anilist", "anidb"].slice(0, ["mal", "anilist", "anidb"].indexOf(kind));
      if (stronger.some((k) => ids[k] && state.matches[`${k}:${ids[k]}`]?.route)) continue;
      const key = `${kind}:${ids[kind]}`;
      if (stale(key)) wanted.set(ids[kind], { key, titles: titlesFor(item) });
    }
    if (!wanted.size) continue;
    const siteKey = siteKeyFor[kind];
    const remember = (key, anime) => {
      state.matches[key] = anime
        ? { ...summarizeAnime(anime), checkedAt: now.toISOString(), v: MATCH_VERSION }
        : { route: null, checkedAt: now.toISOString(), v: MATCH_VERSION };
    };
    try {
      // Batch lookup (18 IDs per request), matched back by the Websites link.
      const found = await client.animeByIds(kind, [...wanted.keys()], (body) => {
        responseShape ??= Array.isArray(body) ? "array" : Object.keys(body ?? {}).join(",");
      });
      if (!sampleAnime && found[0]) {
        sampleAnime = { route: found[0].route ?? null, fields: Object.keys(found[0]).join(","), websites: found[0].websites ?? null };
      }
      const byId = new Map();
      for (const anime of found) {
        const id = websiteId(anime, siteKey);
        if (id && anime?.route) byId.set(id, anime);
      }
      // IDs the batch could not map (e.g. list results without Websites):
      // look them up one at a time and accept a single result only when its
      // name matches the Simkl/TVDB title.
      for (const [id, { key, titles }] of wanted) {
        let anime = byId.get(id) ?? null;
        if (!anime) {
          singleLookups += 1;
          const single = await client.animeByIds(kind, [id]);
          anime = single.find((candidate) => websiteId(candidate, siteKey) === id)
            ?? (single.length === 1 && single[0]?.route && namesMatch(single[0], titles) ? single[0] : null);
        }
        remember(key, anime);
      }
    } catch (error) {
      if (error.status === 401 || error.status === 403) throw error;
      warnings.push({ message: `Anime lookup by ${kind}: ${error.message}` });
    }
  }

  // 3) Attach dub info to each item.
  let dubbed = 0;
  let matched = 0;
  const perTitle = [];
  for (const [, item] of targets) {
    const ids = externalIdsFor(item);
    const match = ["mal", "anilist", "anidb"]
      .map((kind) => ids[kind] && state.matches[`${kind}:${ids[kind]}`])
      .find((value) => value?.route);
    if (match) matched += 1;
    // AnimeSchedule (exact episode) first; MAL-Dubs fills in older shows that
    // are fully dubbed but outside AnimeSchedule's timetable window.
    let dub = match ? resolveDub(match, state.ledger[match.route], now) : null;
    if (!dub && ids.mal && malDubbed.has(ids.mal) && !malIncomplete.has(ids.mal)) {
      // AnimeSchedule's "Finished" is the JAPANESE run, not the dub, so it is
      // never used here. Only a Japanese run that ended 60+ days ago makes
      // "fully dubbed" a safe claim; otherwise say what is actually known.
      const last = lastAiredAt(item, now);
      const age = last ? now - last : null;
      const base = { route: match?.route ?? null, episode: null, estimated: true, source: "mal-dubs" };
      if (age !== null && age >= FINISHED_LONG_AGO_MS) dub = { ...base, full: true };
      else if (age === null || age < STILL_AIRING_MS) dub = { ...base, full: false, airing: true };
      else dub = { ...base, full: false, unknown: true };
    }
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
    perTitle.push({
      title: mediaFor(item)?.title ?? null,
      mal: ids.mal ?? null,
      route: match?.route ?? null,
      japaneseStatus: match?.status ?? null,
      episodes: match?.episodes ?? null,
      dubPremier: match?.dubPremier ?? null,
      dubTimetableEpisode: match?.route ? state.ledger[match.route]?.episode ?? null : null,
      onMalDubs: ids.mal ? malDubbed.has(ids.mal) : null,
      result: dub ? (dub.full ? "ALL" : dub.episode ? `E${dub.episode}` : dub.airing ? "AIRING" : "DUB (progress unknown)") : "no dub",
    });
  }

  return {
    items: nextItems,
    dubState: state,
    warnings,
    enabled: true,
    stats: {
      weeksRead, ledgerShows: Object.keys(state.ledger).length, matched, dubbed, titles: targets.length, withIds, responseShape,
      fromSchedule: targets.filter(([, item]) => item._addonDub && !item._addonDub.source).length,
      singleLookups,
      perTitle: perTitle.slice(0, 60),
      sampleAnime,
      warnings: warnings.slice(0, 5).map((warning) => warning.message),
      malDubsShows: malDubbed.size,
    },
  };
}

