import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markerPath = path.join(root, ".github", "keepalive");
const month = new Date().toISOString().slice(0, 7);

let previous = "";
try {
  previous = (await readFile(markerPath, "utf8")).trim();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

if (previous === month) {
  console.log(`Keepalive is already current for ${month}.`);
} else {
  await writeFile(markerPath, `${month}\n`);
  console.log(`Updated keepalive marker from ${previous || "unset"} to ${month}.`);
}
