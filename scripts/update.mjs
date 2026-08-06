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
import { appendBasePath, deriveBaseUrl, writeSite } from "../src/site.mjs";
import { enrichTvdbMetadata, TvdbApiError } from "../src/tvdb.mjs";

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

const METADATA_ENRICHMENT_VERSION = 3;

function familyTitle(item) {
  const media = mediaFor(item);
  let value = String(media?.title ?? "").trim();
  if (!value) return null;
  const colon = value.indexOf(":");
  if (colon >= 4) value = value.slice(0, colon);
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

function strongIds(item) {
  const ids = mediaFor(item)?.ids ?? {};
  return [
    ids.imdb && `imdb:${ids.imdb}`,
    ids.tmdb && `tmdb:${ids.tmdb}`,
    ids.tvdb && `tvdb:${ids.tvdb}`,
  ].filter(Boolean);
}

function buildMetadataItemFilter(items, now) {
  const active = Object.values(items ?? {}).filter((item) => isCatalogCandidate(item, now));
  const activeFamilies = new Set(active.map(familyTitle).filter(Boolean));
  const activeIds = new Set(active.flatMap(strongIds));
  return (item) => {
    if (isCatalogCandidate(item, now)) return true;
    if (!["watching", "plantowatch", "completed"].includes(item?.status)) return false;
    if (strongIds(item).some((id) => activeIds.has(id))) return true;
    const family = familyTitle(item);
    return Boolean(family && activeFamilies.has(family));
  };
}

async function enrichMissingMappings(client, state, now, { tvdbEnabled = false, itemFilter = () => true } = {}) {
  const next = structuredClone(state);
  for (const [key, item] of Object.entries(next.items)) {
    if (!itemFilter(item)) continue;
    if (item._addonMetadataEnrichmentVersion === METADATA_ENRICHMENT_VERSION) continue;
    const media = mediaFor(item);
    const usable = chooseCatalogId(media?.ids);
    const weakOnly = usable?.startsWith("simkl:") || usable?.startsWith("mal:") || usable?.startsWith("kitsu:");
    const hasTvdbBridge = Boolean(media?.ids?.tvdb || media?.ids?.imdb);
    const needsTvdbBridge = tvdbEnabled && !hasTvdbBridge;

    if (!weakOnly && !needsTvdbBridge) {
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
  publicBasePath = "",
  tmdbAccessToken = process.env.TMDB_READ_ACCESS_TOKEN,
  mdblistApiKey = process.env.MDBLIST_API_KEY,
  tvdbApiKey = process.env.TVDB_API_KEY,
  tvdbPin = process.env.TVDB_SUBSCRIBER_PIN,
  tvdbSeasonType = process.env.TVDB_SEASON_TYPE || "default",
  tvdbLanguage = process.env.TVDB_LANGUAGE || "eng",
  posterBadgesEnabled = process.env.POSTER_BADGES !== "false",
  stateFile = statePath,
  outputDirectory = outputDir,
  addonId,
  addonName,
  catalogId,
  catalogName,
  setupSecretName,
  pageHeading,
  setupDocumentTitle,
  setupHeading,
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

  let metadataItemFilter = buildMetadataItemFilter(state.items, now);
  state = await enrichMissingMappings(client, state, now, {
    tvdbEnabled: Boolean(tvdbApiKey),
    itemFilter: metadataItemFilter,
  });
  metadataItemFilter = buildMetadataItemFilter(state.items, now);
  const metadata = await enrichCatalogMetadata(state.items, {
    tmdbAccessToken,
    mdblistApiKey,
    fetchImpl,
    now,
    itemFilter: metadataItemFilter,
  });
  state.items = metadata.items;
  for (const warning of metadata.warnings) {
    console.warn(`Artwork enrichment skipped for Simkl ${warning.simklId ?? "unknown"}: ${warning.message}`);
  }

  const tvdb = await enrichTvdbMetadata(state.items, {
    apiKey: tvdbApiKey,
    pin: tvdbPin,
    seasonType: tvdbSeasonType,
    language: tvdbLanguage,
    fetchImpl,
    now,
    itemFilter: metadataItemFilter,
  });
  state.items = tvdb.items;
  for (const warning of tvdb.warnings) {
    console.warn(`TVDB metadata skipped for Simkl ${warning.simklId ?? "unknown"}: ${warning.message}`);
  }
  state.lastSuccessfulRefresh = new Date(now).toISOString();

  const { catalog, metadata: detailMetadata, posterBadges, skipped, sourceCounts, unifiedStats } = buildCatalog(state.items, { now, maxItems });
  const rootBaseUrl = deriveBaseUrl({ explicitBaseUrl, githubRepository });
  const baseUrl = appendBasePath(rootBaseUrl, publicBasePath);
  const site = await writeSite({
    outputDir: outputDirectory,
    catalog,
    items: state.items,
    updatedAt: state.lastSuccessfulRefresh,
    skipped,
    sourceCounts,
    baseUrl,
    usesTmdb: metadata.usesTmdb,
    usesTvdb: tvdb.usesTvdb,
    posterBadges,
    posterBadgesEnabled,
    metadata: detailMetadata,
    unifiedStats,
    fetchImpl,
    addonId,
    addonName,
    catalogId,
    catalogName,
    setupSecretName,
    pageHeading,
    setupDocumentTitle,
    setupHeading,
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
    metadataWarnings: [...metadata.warnings, ...tvdb.warnings],
    posterBadgesGenerated: site.posterBadgesGenerated,
    posterBadgeWarnings: site.posterBadgeWarnings,
    unifiedStats,
  };
}

function resolveRepoPath(value, fallback) {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.join(root, value);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cliSecretName = process.env.SIMKL_PROFILE_SECRET_NAME || "SIMKL_ACCESS_TOKEN";
  try {
    const result = await refresh({
      clientId: process.env.SIMKL_CLIENT_ID,
      accessToken: process.env.SIMKL_ACCESS_TOKEN,
      maxItems: process.env.MAX_CATALOG_ITEMS || DEFAULT_MAX_ITEMS,
      publicBasePath: process.env.SIMKL_PROFILE_BASE_PATH || "",
      stateFile: resolveRepoPath(process.env.SIMKL_PROFILE_STATE_FILE, statePath),
      outputDirectory: resolveRepoPath(process.env.SIMKL_PROFILE_OUTPUT_DIR, outputDir),
      addonId: process.env.SIMKL_PROFILE_ADDON_ID,
      addonName: process.env.SIMKL_PROFILE_ADDON_NAME,
      catalogId: process.env.SIMKL_PROFILE_CATALOG_ID,
      catalogName: process.env.SIMKL_PROFILE_CATALOG_NAME,
      setupSecretName: cliSecretName,
      pageHeading: process.env.SIMKL_PROFILE_PAGE_HEADING,
      setupDocumentTitle: process.env.SIMKL_PROFILE_SETUP_TITLE,
      setupHeading: process.env.SIMKL_PROFILE_SETUP_HEADING,
    });
    console.log(`Published ${result.catalog.metas.length} anime title(s) ready to watch.`);
    if (result.skipped.length) console.warn(`Skipped ${result.skipped.length} title(s) with unusable metadata.`);
  } catch (error) {
    if (error instanceof SimklApiError && error.status === 401) {
      console.error(`Simkl authorization was revoked or expired. Run the authorization step again and replace ${cliSecretName}.`);
    } else if ((error instanceof MetadataApiError || error instanceof TvdbApiError) && (error.status === 401 || error.status === 403)) {
      console.error(`${error.provider} rejected its configured API credential. Replace or rotate the corresponding GitHub secret.`);
    } else {
      console.error(error.stack || error.message);
    }
    process.exitCode = 1;
  }
}
