import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADDON_ID, CATALOG_ID } from "../src/constants.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function configuredProjectPath(value, fallback) {
  if (!value) return fallback;
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Configured path must remain inside the repository: ${value}`);
  }
  return resolved;
}

const publicDir = configuredProjectPath(process.env.OUTPUT_DIRECTORY, path.join(root, "public"));
const expectedCatalogId = process.env.CATALOG_ID || CATALOG_ID;
const expectedAddonId = process.env.ADDON_ID || ADDON_ID;
const expectedMediaType = process.env.MEDIA_TYPE || null;
const manifest = JSON.parse(await readFile(path.join(publicDir, "manifest.json"), "utf8"));
const catalog = JSON.parse(await readFile(
  path.join(publicDir, "catalog", "series", `${expectedCatalogId}.json`),
  "utf8",
));
const setupHtml = await readFile(path.join(publicDir, "setup.html"), "utf8");
const status = JSON.parse(await readFile(path.join(publicDir, "status.json"), "utf8"));

if (manifest.id !== expectedAddonId) {
  throw new Error(`Manifest ID mismatch: expected ${expectedAddonId}, received ${manifest.id}`);
}
if (!Array.isArray(manifest.resources)
  || !manifest.resources.includes("catalog")
  || !manifest.resources.includes("meta")
  || !manifest.catalogs?.some((item) => item.id === expectedCatalogId)) {
  throw new Error("Manifest does not declare the expected catalog and metadata resources.");
}
if (!Array.isArray(manifest.idPrefixes)
  || !manifest.idPrefixes.includes("simkl-tvdb-unified:")) {
  throw new Error("Manifest is missing the unified metadata ID prefix required by desktop clients.");
}
if (!Array.isArray(catalog.metas)) throw new Error("Catalog response must contain a metas array.");
if (expectedMediaType && status.mediaType !== expectedMediaType) {
  throw new Error(`Media type mismatch: expected ${expectedMediaType}, received ${status.mediaType}`);
}

const setupScript = setupHtml.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
if (!setupScript) throw new Error("Setup page is missing its authorization script.");
new Function(setupScript);

// Poster studio (anime tags site only): page script must parse and its data must be valid JSON.
let studioHtml = null;
try { studioHtml = await readFile(path.join(publicDir, "studio.html"), "utf8"); } catch { /* not published here */ }
if (studioHtml) {
  const studioScript = studioHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!studioScript) throw new Error("Studio page is missing its script.");
  new Function(studioScript);
}
let studioDataText = null;
try { studioDataText = await readFile(path.join(publicDir, "studio", "studio-data.json"), "utf8"); } catch { /* not published here */ }
if (studioHtml && !studioDataText) throw new Error("Studio page is published without its data.");
if (studioDataText) {
  const studioData = JSON.parse(studioDataText);
  if (!studioData.options || !studioData.config?.anime || !studioData.config?.tv) throw new Error("Studio data is incomplete.");
}

function safeMetaFilename(id) {
  if (typeof id !== "string" || !id || /[\\/]/.test(id)) throw new Error(`Unsafe metadata ID: ${id}`);
  return `${id}.json`;
}

function validEpisodeId(parentId, video) {
  const season = Number(video?.season);
  const episode = Number(video?.episode);
  if (!Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode < 1) return false;
  if (video.id === `${parentId}:${season}:${episode}`) return true;
  if (parentId.startsWith("simkl-tvdb-unified:")) {
    return /^(?:tt\d+|tvdb:\d+):\d+:\d+$/.test(String(video.id ?? ""));
  }
  return false;
}

let fullMetadataFiles = 0;
let fullMetadataEpisodes = 0;
for (const preview of catalog.metas) {
  const target = path.join(publicDir, "meta", "series", safeMetaFilename(preview.id));
  try {
    await access(target);
  } catch {
    if (!preview.id.startsWith("tt")) throw new Error(`Missing metadata response for ${preview.id}`);
    continue;
  }

  const response = JSON.parse(await readFile(target, "utf8"));
  const meta = response?.meta;
  if (!meta || meta.id !== preview.id || meta.type !== "series") {
    throw new Error(`Invalid metadata response for ${preview.id}`);
  }
  if (!meta.videos) continue;
  if (!Array.isArray(meta.videos) || !meta.videos.length) {
    throw new Error(`Unified metadata for ${preview.id} has no episodes.`);
  }
  if (preview.id.startsWith("simkl-tvdb-unified:")) {
    if (!Array.isArray(preview.videos) || !preview.videos.length) {
      throw new Error(`Unified catalog preview for ${preview.id} has no inline desktop episode fallback.`);
    }
    const previewIds = preview.videos.map((video) => video.id);
    const metadataIds = meta.videos.map((video) => video.id);
    if (JSON.stringify(previewIds) !== JSON.stringify(metadataIds)) {
      throw new Error(`Unified catalog preview episodes differ from dedicated metadata for ${preview.id}.`);
    }
    if (preview.behaviorHints?.defaultVideoId !== meta.behaviorHints?.defaultVideoId) {
      throw new Error(`Unified catalog preview default episode differs from dedicated metadata for ${preview.id}.`);
    }
  }
  const seen = new Set();
  for (const video of meta.videos) {
    if (!validEpisodeId(meta.id, video)) {
      throw new Error(`Invalid canonical episode ID in ${preview.id}: ${video?.id ?? "missing"}`);
    }
    if (seen.has(video.id)) throw new Error(`Duplicate episode ID in ${preview.id}: ${video.id}`);
    seen.add(video.id);
    if (video.thumbnail && !/^https:\/\//i.test(video.thumbnail)) {
      throw new Error(`Non-HTTPS episode image in ${preview.id}: ${video.thumbnail}`);
    }
  }
  if (meta.behaviorHints?.defaultVideoId && !seen.has(meta.behaviorHints.defaultVideoId)) {
    throw new Error(`Default episode does not exist in ${preview.id}: ${meta.behaviorHints.defaultVideoId}`);
  }
  fullMetadataFiles += 1;
  fullMetadataEpisodes += meta.videos.length;
}

// The second row is a movie catalog INSIDE the already installed account-2
// manifest. An empty row is valid if no release dates match yet.
if (process.env.VERIFY_MOVIE_ROW === "true") {
  const movieId = "simkl-plan-to-watch-home-releases-account2";
  const declaration = manifest.catalogs?.find((item) => item.type === "movie" && item.id === movieId);
  if (!declaration || !manifest.types?.includes("movie")) {
    throw new Error("Account-2 manifest is missing the movie row or movie type.");
  }
  if (!status.movieRow || status.movieRow.catalogId !== movieId) {
    throw new Error("Account-2 movie row status is missing.");
  }
  const movieCatalog = JSON.parse(await readFile(path.join(publicDir, "catalog", "movie", `${movieId}.json`), "utf8"));
  if (!Array.isArray(movieCatalog.metas) || status.movieRow.published !== movieCatalog.metas.length) {
    throw new Error("Published movie catalog count is inconsistent.");
  }
  const seen = new Set();
  for (const movie of movieCatalog.metas) {
    if (movie.type !== "movie" || !/^(?:tt\d+|tmdb:\d+)$/.test(movie.id)
        || !movie.poster?.startsWith("https://")) throw new Error(`Invalid movie catalog entry: ${movie.id}`);
    if (seen.has(movie.id)) throw new Error(`Duplicate movie in catalog: ${movie.id}`);
    seen.add(movie.id);
    const detail = JSON.parse(await readFile(path.join(publicDir, "meta", "movie", safeMetaFilename(movie.id)), "utf8"));
    if (detail.meta?.id !== movie.id || detail.meta?.type !== "movie") {
      throw new Error(`Incorrect movie detail metadata for ${movie.id}`);
    }
  }
  console.log(`Verified ${movieCatalog.metas.length} additional home-release movies under the same Account 2 addon.`);
}

const secrets = [
  process.env.SIMKL_ACCESS_TOKEN,
  process.env.TMDB_READ_ACCESS_TOKEN,
  process.env.MDBLIST_API_KEY,
  process.env.TVDB_API_KEY,
  process.env.TVDB_SUBSCRIBER_PIN,
  process.env.ANIMESCHEDULE_TOKEN,
].filter(Boolean);
if (secrets.length) {
  async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await scan(target);
      else {
        const contents = await readFile(target, "utf8");
        for (const secret of secrets) {
          if (contents.includes(secret)) throw new Error(`An API credential leaked into ${target}`);
        }
      }
    }
  }
  await scan(publicDir);
}

console.log(
  `Verified ${manifest.id}, ${expectedCatalogId}, and ${catalog.metas.length} catalog item(s), including ${fullMetadataFiles} unified title(s) and ${fullMetadataEpisodes} episode(s); no credential leakage detected.`,
);
