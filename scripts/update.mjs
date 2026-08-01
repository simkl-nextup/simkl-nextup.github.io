import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog, chooseCatalogId, mergeAnimeDetails, mergeCalendar } from "../src/catalog.mjs";
import { DEFAULT_MAX_ITEMS } from "../src/constants.mjs";
import { createSimklClient, SimklApiError } from "../src/simkl.mjs";
import {
  createEmptyState,
  mediaFor,
  mergeAnimeDelta,
  normalizeState,
  pruneRemovedItems,
  replaceWithInitialWatching,
  simklIdFor,
} from "../src/state.mjs";
import { deriveBaseUrl, writeSite } from "../src/site.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const statePath = path.join(root, "state", "simkl-state.json");
const outputDir = path.join(root, "public");

async function loadState(filePath) {
  try {
    return normalizeState(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return createEmptyState();
    throw error;
  }
}

async function saveState(filePath, state) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function enrichMissingMappings(client, state) {
  const next = structuredClone(state);
  for (const [key, item] of Object.entries(next.items)) {
    if (item._addonMetadataEnriched) continue;
    const media = mediaFor(item);
    const usable = chooseCatalogId(media?.ids);
    const weakOnly = usable?.startsWith("simkl:") || usable?.startsWith("mal:") || usable?.startsWith("kitsu:");
    if (!weakOnly) continue;
    const simklId = simklIdFor(item);
    if (!simklId) continue;
    const details = await client.getAnimeDetails(simklId);
    next.items[key] = mergeAnimeDetails(item, details);
    next.items[key]._addonMetadataEnriched = true;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  return next;
}

export async function refresh({
  clientId,
  accessToken,
  now = new Date(),
  maxItems = DEFAULT_MAX_ITEMS,
  fetchImpl = fetch,
  explicitBaseUrl = process.env.PUBLIC_BASE_URL,
  githubRepository = process.env.GITHUB_REPOSITORY,
  stateFile = statePath,
  outputDirectory = outputDir,
} = {}) {
  const client = createSimklClient({ clientId, accessToken, fetchImpl });
  let state = await loadState(stateFile);

  if (!state.lastAnimeActivity) {
    const initial = await client.getInitialWatchingAnime();
    state = replaceWithInitialWatching(state, initial);
    const activities = await client.getActivities();
    state.lastAnimeActivity = activities?.anime?.all ?? activities?.all ?? new Date(now).toISOString();
    state.lastRemovedFromList = activities?.anime?.removed_from_list ?? null;
  } else {
    const activities = await client.getActivities();
    const currentAnimeActivity = activities?.anime?.all ?? activities?.all ?? state.lastAnimeActivity;
    const currentRemoved = activities?.anime?.removed_from_list ?? null;

    if (currentAnimeActivity !== state.lastAnimeActivity) {
      const delta = await client.getAnimeDelta(state.lastAnimeActivity);
      state = mergeAnimeDelta(state, delta);

      if (currentRemoved && currentRemoved !== state.lastRemovedFromList) {
        const snapshot = await client.getAnimeIdSnapshot();
        state = pruneRemovedItems(state, snapshot);
      }

      state.lastAnimeActivity = currentAnimeActivity;
      state.lastRemovedFromList = currentRemoved;
    }
  }

  try {
    const calendar = await client.getAnimeCalendar();
    state.items = mergeCalendar(state.items, calendar);
  } catch (error) {
    console.warn(`Calendar refresh skipped: ${error.message}`);
  }

  state = await enrichMissingMappings(client, state);
  state.lastSuccessfulRefresh = new Date(now).toISOString();

  const { catalog, skipped } = buildCatalog(state.items, { now, maxItems });
  const baseUrl = deriveBaseUrl({ explicitBaseUrl, githubRepository });
  await writeSite({
    outputDir: outputDirectory,
    catalog,
    items: state.items,
    updatedAt: state.lastSuccessfulRefresh,
    skipped,
    baseUrl,
  });
  await saveState(stateFile, state);
  return { catalog, skipped, state };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await refresh({
      clientId: process.env.SIMKL_CLIENT_ID,
      accessToken: process.env.SIMKL_ACCESS_TOKEN,
      maxItems: process.env.MAX_CATALOG_ITEMS || DEFAULT_MAX_ITEMS,
    });
    console.log(`Published ${result.catalog.metas.length} aired-but-unwatched anime title(s).`);
    if (result.skipped.length) console.warn(`Skipped ${result.skipped.length} title(s) with unusable metadata.`);
  } catch (error) {
    if (error instanceof SimklApiError && error.status === 401) {
      console.error("Simkl authorization was revoked or expired. Run the authorization step again and replace SIMKL_ACCESS_TOKEN.");
    } else {
      console.error(error.stack || error.message);
    }
    process.exitCode = 1;
  }
}
