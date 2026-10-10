// MyAnimeList score for the poster's bottom band, via Jikan (public, no key).
// Jikan allows ~3 requests/second and 60/minute, so requests are spaced out
// and every score is cached in the private state for a week.

import { mediaFor } from "./state.mjs";

const JIKAN_BASE = "https://api.jikan.moe/v4";
const SUCCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 60 * 1000;
const CACHE_VERSION = 2;
const REQUEST_GAP_MS = 1100;
const MAX_LOOKUPS_PER_RUN = 40;

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

export async function enrichMalScores(items, cache, {
  enabled = true,
  fetchImpl = fetch,
  now = new Date(),
  itemFilter = () => true,
  gapMs = REQUEST_GAP_MS,
} = {}) {
  const nextItems = structuredClone(items ?? {});
  const nextCache = { ...(cache ?? {}) };
  const warnings = [];
  if (!enabled) return { items: nextItems, cache: nextCache, warnings, looked: 0 };

  let looked = 0;
  let last = 0;
  for (const [, item] of Object.entries(nextItems)) {
    if (!itemFilter(item)) continue;
    const malId = malIdFor(item);
    if (!malId) continue;
    const key = String(malId);

    if (!fresh(nextCache[key], now) && looked < MAX_LOOKUPS_PER_RUN) {
      const wait = last + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      looked += 1;
      try {
        let response = await fetchImpl(`${JIKAN_BASE}/anime/${malId}`, { headers: { Accept: "application/json", "User-Agent": "simkl-nextup-addon/1.10 (+https://github.com/simkl-nextup/simkl-nextup.github.io)" } });
        if (response.status === 429) {
          await sleep(2500);
          response = await fetchImpl(`${JIKAN_BASE}/anime/${malId}`, { headers: { Accept: "application/json", "User-Agent": "simkl-nextup-addon/1.10 (+https://github.com/simkl-nextup/simkl-nextup.github.io)" } });
        }
        if (!response.ok) throw new Error(`Jikan responded ${response.status} for MAL ${malId}`);
        const body = await response.json();
        nextCache[key] = { score: formatMalScore(body?.data?.score), checkedAt: now.toISOString(), v: CACHE_VERSION };
      } catch (error) {
        warnings.push({ malId, message: error.message });
        nextCache[key] = { score: nextCache[key]?.score ?? null, checkedAt: now.toISOString(), v: CACHE_VERSION };
      }
    }
    const score = nextCache[key]?.score ?? null;
    if (score) item._addonMalScore = score;
    else delete item._addonMalScore;
  }
  return { items: nextItems, cache: nextCache, warnings, looked };
}
