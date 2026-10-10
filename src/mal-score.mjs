// MyAnimeList score for the poster's bottom band.
//
// Source 1: Simkl's full title record (ratings.mal.rating) — the same API the
//           refresh already uses, so it is reachable from GitHub Actions.
// Source 2: Jikan (public MAL API) as a fallback. GitHub's runners could not
//           reach it ("fetch failed"), so after the first network failure in a
//           run it is skipped for the rest of that run.
// Scores are cached in the private state for a week.

import { mediaFor, simklIdFor } from "./state.mjs";

const JIKAN_BASE = "https://api.jikan.moe/v4";
const SUCCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 60 * 1000;
const CACHE_VERSION = 3;
const REQUEST_GAP_MS = 400;
const MAX_LOOKUPS_PER_RUN = 60;
const USER_AGENT = "simkl-nextup-addon/1.10 (+https://github.com/simkl-nextup/simkl-nextup.github.io)";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function malIdFor(item) {
  const value = Number(mediaFor(item)?.ids?.mal);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function fresh(cached, now) {
  if (!cached?.checkedAt || cached.v !== CACHE_VERSION) return false;
  const age = now - new Date(cached.checkedAt);
  return age < (cached.score == null ? FAILURE_TTL_MS : SUCCESS_TTL_MS);
}

export function formatMalScore(score) {
  const value = Number(score);
  return Number.isFinite(value) && value > 0 ? value.toFixed(1) : null;
}

// Simkl's record keeps ratings as { simkl: {rating, votes}, mal: {rating, votes} }.
export function malRatingFromSimkl(details) {
  const ratings = details?.ratings ?? details?.rating ?? null;
  return formatMalScore(ratings?.mal?.rating ?? ratings?.myanimelist?.rating ?? null);
}

export async function enrichMalScores(items, cache, {
  enabled = true,
  fetchImpl = fetch,
  now = new Date(),
  itemFilter = () => true,
  gapMs = REQUEST_GAP_MS,
  simklDetails = null,          // async (simklId) => Simkl full record
} = {}) {
  const nextItems = structuredClone(items ?? {});
  const nextCache = { ...(cache ?? {}) };
  const warnings = [];
  const sources = { simkl: 0, jikan: 0 };
  let sampleRatingKeys = null;
  if (!enabled) return { items: nextItems, cache: nextCache, warnings, looked: 0, sources, sampleRatingKeys };

  let looked = 0;
  let last = 0;
  let jikanDown = false;
  for (const [, item] of Object.entries(nextItems)) {
    if (!itemFilter(item)) continue;
    const malId = malIdFor(item);
    const simklId = simklIdFor(item);
    const key = malId ? String(malId) : `simkl:${simklId}`;
    if (!malId && !simklId) continue;

    if (!fresh(nextCache[key], now) && looked < MAX_LOOKUPS_PER_RUN) {
      const wait = last + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      looked += 1;
      let score = null;
      let source = null;

      if (simklDetails && simklId) {
        try {
          const details = await simklDetails(simklId);
          sampleRatingKeys ??= details?.ratings ? Object.keys(details.ratings).join(",") : "no ratings field";
          score = malRatingFromSimkl(details);
          if (score) source = "simkl";
        } catch (error) {
          warnings.push({ malId, message: `Simkl: ${error.message}` });
        }
      }

      if (!score && malId && !jikanDown) {
        try {
          let response = await fetchImpl(`${JIKAN_BASE}/anime/${malId}`, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
          if (response.status === 429) {
            await sleep(2500);
            response = await fetchImpl(`${JIKAN_BASE}/anime/${malId}`, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
          }
          if (!response.ok) throw new Error(`Jikan responded ${response.status} for MAL ${malId}`);
          score = formatMalScore((await response.json())?.data?.score);
          if (score) source = "jikan";
        } catch (error) {
          const cause = error?.cause?.code || error?.cause?.message;
          warnings.push({ malId, message: `Jikan: ${error.message}${cause ? ` (${cause})` : ""}` });
          if (/fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|certificate/i.test(`${error.message} ${cause ?? ""}`)) jikanDown = true;
        }
      }

      if (source) sources[source] += 1;
      nextCache[key] = { score: score ?? nextCache[key]?.score ?? null, checkedAt: now.toISOString(), v: CACHE_VERSION };
    }
    const score = nextCache[key]?.score ?? null;
    if (score) item._addonMalScore = score;
    else delete item._addonMalScore;
  }
  return { items: nextItems, cache: nextCache, warnings, looked, sources, sampleRatingKeys };
}
