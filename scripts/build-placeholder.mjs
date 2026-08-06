import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendPublicPath, deriveBaseUrl, writeSite } from "../src/site.mjs";

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

const rootBaseUrl = deriveBaseUrl({
  explicitBaseUrl: process.env.PUBLIC_BASE_URL,
  githubRepository: process.env.GITHUB_REPOSITORY,
});
const baseUrl = appendPublicPath(rootBaseUrl, process.env.PUBLIC_PATH_PREFIX || "");

await writeSite({
  outputDir: configuredProjectPath(process.env.OUTPUT_DIRECTORY, path.join(root, "public")),
  catalog: { metas: [] },
  items: {},
  updatedAt: "Not connected yet",
  skipped: [],
  baseUrl,
  ...(process.env.ADDON_ID ? { addonId: process.env.ADDON_ID } : {}),
  ...(process.env.CATALOG_ID ? { catalogId: process.env.CATALOG_ID } : {}),
  ...(process.env.CATALOG_NAME ? { catalogName: process.env.CATALOG_NAME } : {}),
  ...(process.env.ADDON_NAME ? { addonName: process.env.ADDON_NAME } : {}),
  ...(process.env.SITE_TITLE ? { siteTitle: process.env.SITE_TITLE } : {}),
  ...(process.env.SETUP_SECRET_NAME ? { setupSecretName: process.env.SETUP_SECRET_NAME } : {}),
  ...(process.env.ACCOUNT_LABEL ? { accountLabel: process.env.ACCOUNT_LABEL } : {}),
  mediaType: process.env.MEDIA_TYPE || "anime",
});
console.log(`Built placeholder site at ${process.env.OUTPUT_DIRECTORY || "public"}.`);
