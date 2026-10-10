// Anime list IDs (MAL / AniList / AniDB / Kitsu) from Fribb's anime-lists,
// keyed directly by Simkl ID. No API key, one download per run.
// https://github.com/Fribb/anime-lists

import { mediaFor, simklIdFor } from "./state.mjs";

export const FRIBB_URL = "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";

function positiveInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function indexFribb(entries) {
  const bySimkl = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const simkl = positiveInt(entry?.simkl_id);
    if (simkl && !bySimkl.has(simkl)) bySimkl.set(simkl, entry);
  }
  return bySimkl;
}

export async function loadFribbIndex(fetchImpl = fetch) {
  const response = await fetchImpl(FRIBB_URL, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Fribb anime-lists responded ${response.status}`);
  return indexFribb(await response.json());
}

// Fills missing anime list IDs from the Simkl-keyed index. Returns how many
// items gained a MAL ID.
export function applyFribbIds(items, index, itemFilter = () => true) {
  let filled = 0;
  for (const item of Object.values(items ?? {})) {
    if (!itemFilter(item)) continue;
    const media = mediaFor(item);
    const entry = index.get(positiveInt(simklIdFor(item)));
    if (!media || !entry) continue;
    const ids = media.ids ?? (media.ids = {});
    const hadMal = Boolean(ids.mal);
    ids.mal ||= positiveInt(entry.mal_id) ?? undefined;
    ids.anilist ||= positiveInt(entry.anilist_id) ?? undefined;
    ids.anidb ||= positiveInt(entry.anidb_id) ?? undefined;
    ids.kitsu ||= positiveInt(entry.kitsu_id) ?? undefined;
    for (const key of ["mal", "anilist", "anidb", "kitsu"]) if (ids[key] === undefined) delete ids[key];
    if (!hadMal && ids.mal) filled += 1;
  }
  return filled;
}
