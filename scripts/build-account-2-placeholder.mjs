import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeSite } from "../src/site.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await writeSite({
  outputDir: path.join(root, "public", "account-2"),
  catalog: { metas: [] },
  items: {},
  updatedAt: "Not connected yet",
  skipped: [],
  baseUrl: "",
  addonId: "community.simkl.new-anime-episodes.account-2",
  addonName: "Simkl Anime Up Next · Account 2",
  catalogId: "simkl-new-anime-episodes-account-2",
  catalogName: "My Anime Up Next · Simkl 2",
  setupSecretName: "SIMKL_ACCESS_TOKEN_2",
  pageHeading: "My Anime Up Next · Simkl 2",
  setupDocumentTitle: "Authorize Simkl account 2",
  setupHeading: "Authorize the second personal addon",
});

console.log("Built account-2 placeholder site.");
