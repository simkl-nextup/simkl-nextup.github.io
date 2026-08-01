import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeSite } from "../src/site.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await writeSite({
  outputDir: path.join(root, "public"),
  catalog: { metas: [] },
  items: {},
  updatedAt: "Not connected yet",
  skipped: [],
  baseUrl: "",
});
console.log("Built placeholder site.");

