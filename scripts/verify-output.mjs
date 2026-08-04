import { readFile, readdir } from "node:fs/promises";
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

for (const preview of catalog.metas.filter((meta) => meta.id?.startsWith("simkl-unified:"))) {
  const detailPath = path.join(publicDir, "meta", "series", `${preview.id}.json`);
  const detail = JSON.parse(await readFile(detailPath, "utf8"));
  if (!Array.isArray(detail?.meta?.videos) || detail.meta.videos.length === 0) {
    throw new Error(`Unified metadata for ${preview.id} is missing episodes.`);
  }
  for (const video of detail.meta.videos) {
    if (!video.id || !Number.isInteger(video.season) || !Number.isInteger(video.episode) || !video.released) {
      throw new Error(`Unified metadata for ${preview.id} contains an invalid episode.`);
    }
  }
}

const setupScript = setupHtml.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
if (!setupScript) throw new Error("Setup page is missing its authorization script.");
new Function(setupScript);

const secrets = [
  process.env.SIMKL_ACCESS_TOKEN,
  process.env.TMDB_READ_ACCESS_TOKEN,
  process.env.MDBLIST_API_KEY,
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

console.log(`Verified manifest and ${catalog.metas.length} catalog item(s), including unified season metadata; no credential leakage detected.`);
