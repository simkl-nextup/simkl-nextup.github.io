import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCatalog, chooseCatalogId, isCatalogCandidate, mergeAnimeDetails, mergeCalendar } from "../src/catalog.mjs";
import { DEFAULT_MAX_ITEMS } from "../src/constants.mjs";
import { enrichCatalogMetadata, MetadataApiError } from "../src/metadata.mjs";
import { createSimklClient, SimklApiError } from "../src/simkl.mjs";
import {
  createEmptyState,
  mediaFor,
  mergeAnimeDelta,
  normalizeState,
  pruneRemovedItems,
  replaceWithInitialEligibleAnime,
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

const METADATA_ENRICHMENT_VERSION = 2;

async function enrichMissingMappings(client, state, now, { unifiedSeasonsEnabled = false } = {}) {
  const next = structuredClone(state);
  for (const [key, item] of Object.entries(next.items)) {
    const trackedAnime = ["watching", "plantowatch", "completed"].includes(item?.status);
    if (!isCatalogCandidate(item, now) && !(unifiedSeasonsEnabled && trackedAnime)) continue;
    if (item._addonMetadataEnrichmentVersion === METADATA_ENRICHMENT_VERSION) continue;
    const media = mediaFor(item);
    const usable = chooseCatalogId(media?.ids);
    const weakOnly = usable?.startsWith("simkl:") || usable?.startsWith("mal:") || usable?.startsWith("kitsu:");
    const hasTrackingAnimeId = Boolean(media?.ids?.mal || media?.ids?.kitsu);
    const needsTrackingAnimeId = unifiedSeasonsEnabled && !hasTrackingAnimeId;

    if (!weakOnly && !needsTrackingAnimeId) {
      item._addonMetadataEnrichmentVersion = METADATA_ENRICHMENT_VERSION;
      item._addonMetadataEnriched = true;
      continue;
    }

    const simklId = simklIdFor(item);
    if (!simklId) continue;
    try {
      const details = await client.getAnimeDetails(simklId);
      next.items[key] = mergeAnimeDetails(item, details);
      next.items[key]._addonMetadataEnrichmentVersion = METADATA_ENRICHMENT_VERSION;
      next.items[key]._addonMetadataEnriched = true;
      await new Promise((resolve) => setTimeout(resolve, 125));
    } catch (error) {
      if (error instanceof SimklApiError && (error.status === 401 || error.status === 403)) throw error;
      console.warn(`Simkl ID enrichment skipped for ${simklId}: ${error.message}`);
      if (error instanceof SimklApiError && error.status === 404) {
        item._addonMetadataEnrichmentVersion = METADATA_ENRICHMENT_VERSION;
        item._addonMetadataEnriched = true;
      }
    }
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
  tmdbAccessToken = process.env.TMDB_READ_ACCESS_TOKEN,
  mdblistApiKey = process.env.MDBLIST_API_KEY,
  posterBadgesEnabled = process.env.POSTER_BADGES !== "false",
  stateFile = statePath,
  outputDirectory = outputDir,
} = {}) {
  const client = createSimklClient({ clientId, accessToken, fetchImpl });
  let state = await loadState(stateFile);

  if (!state.lastAnimeActivity) {
    const initial = await client.getInitialAnimeLibrary();
    state = replaceWithInitialEligibleAnime(state, initial);
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

  const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const calendarRequests = [
    ["rolling", () => client.getAnimeCalendar()],
    ["current month", () => client.getAnimeCalendarMonth(now.getUTCFullYear(), now.getUTCMonth() + 1)],
    ["previous month", () => client.getAnimeCalendarMonth(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth() + 1)],
  ];
  for (const [label, request] of calendarRequests) {
    try {
      state.items = mergeCalendar(state.items, await request(), { now });
    } catch (error) {
      console.warn(`${label} calendar refresh skipped: ${error.message}`);
    }
  }

  state = await enrichMissingMappings(client, state, now, { unifiedSeasonsEnabled: Boolean(tmdbAccessToken) });
  const metadata = await enrichCatalogMetadata(state.items, {
    tmdbAccessToken,
    mdblistApiKey,
    fetchImpl,
    now,
    itemFilter: (item) => ["watching", "plantowatch", "completed"].includes(item?.status),
  });
  state.items = metadata.items;
  for (const warning of metadata.warnings) {
    console.warn(`Artwork enrichment skipped for Simkl ${warning.simklId ?? "unknown"}: ${warning.message}`);
  }
  state.lastSuccessfulRefresh = new Date(now).toISOString();

  const { catalog, metadata: detailMetadata, posterBadges, skipped, sourceCounts, unifiedStats } = buildCatalog(state.items, { now, maxItems });
  const baseUrl = deriveBaseUrl({ explicitBaseUrl, githubRepository });
  const site = await writeSite({
    outputDir: outputDirectory,
    catalog,
    items: state.items,
    updatedAt: state.lastSuccessfulRefresh,
    skipped,
    sourceCounts,
    baseUrl,
    usesTmdb: metadata.usesTmdb,
    posterBadges,
    posterBadgesEnabled,
    metadata: detailMetadata,
    unifiedStats,
    fetchImpl,
  });
  for (const warning of site.posterBadgeWarnings) {
    console.warn(`Poster badge skipped for ${warning.name ?? warning.id ?? "unknown"}: ${warning.message}`);
  }
  await saveState(stateFile, state);
  return {
    catalog: site.catalog,
    skipped,
    sourceCounts,
    state,
    metadataWarnings: metadata.warnings,
    posterBadgesGenerated: site.posterBadgesGenerated,
    posterBadgeWarnings: site.posterBadgeWarnings,
    unifiedStats,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await refresh({
      clientId: process.env.SIMKL_CLIENT_ID,
      accessToken: process.env.SIMKL_ACCESS_TOKEN,
      maxItems: process.env.MAX_CATALOG_ITEMS || DEFAULT_MAX_ITEMS,
    });
    console.log(`Published ${result.catalog.metas.length} anime title(s) ready to watch.`);
    if (result.skipped.length) console.warn(`Skipped ${result.skipped.length} title(s) with unusable metadata.`);
  } catch (error) {
    if (error instanceof SimklApiError && error.status === 401) {
      console.error("Simkl authorization was revoked or expired. Run the authorization step again and replace SIMKL_ACCESS_TOKEN.");
    } else if (error instanceof MetadataApiError && (error.status === 401 || error.status === 403)) {
      console.error(`${error.provider} rejected its configured API credential. Replace the corresponding GitHub secret.`);
    } else {
      console.error(error.stack || error.message);
    }
    process.exitCode = 1;
  }
}
