import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG_ID } from "../src/constants.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const manifest = JSON.parse(await readFile(path.join(publicDir, "manifest.json"), "utf8"));
const catalog = JSON.parse(await readFile(path.join(publicDir, "catalog", "series", `${CATALOG_ID}.json`), "utf8"));
const setupHtml = await readFile(path.join(publicDir, "setup.html"), "utf8");

if (!manifest.resources || !manifest.catalogs?.some((item) => item.id === CATALOG_ID)) {
  throw new Error("Manifest does not declare the expected catalog.");
}
if (!Array.isArray(catalog.metas)) throw new Error("Catalog response must contain a metas array.");

const setupScript = setupHtml.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
if (!setupScript) throw new Error("Setup page is missing its authorization script.");
new Function(setupScript);

function safeMetaFilename(id) {
  if (typeof id !== "string" || !id || /[\\/]/.test(id)) throw new Error(`Unsafe metadata ID: ${id}`);
  return `${id}.json`;
}

function validEpisodeId(parentId, video) {
  const season = Number(video?.season);
  const episode = Number(video?.episode);
  if (!Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode < 1) return false;
  return video.id === `${parentId}:${season}:${episode}`;
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

const secrets = [
  process.env.SIMKL_ACCESS_TOKEN,
  process.env.TMDB_READ_ACCESS_TOKEN,
  process.env.MDBLIST_API_KEY,
  process.env.TVDB_API_KEY,
  process.env.TVDB_SUBSCRIBER_PIN,
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
  `Verified manifest and ${catalog.metas.length} catalog item(s), including ${fullMetadataFiles} unified title(s) and ${fullMetadataEpisodes} episode(s); no credential leakage detected.`,
);
