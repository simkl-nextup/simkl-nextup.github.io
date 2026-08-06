import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendBasePath, writeSite } from "../src/site.mjs";
import { CATALOG_ID } from "../src/constants.mjs";

const emptySite = {
  catalog: { metas: [] },
  items: {},
  updatedAt: "Not connected yet",
  posterBadgesEnabled: false,
};

test("a second profile gets isolated addon, catalog, and output paths", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "simkl-profiles-"));
  const primaryDir = path.join(temp, "public");
  const secondaryDir = path.join(primaryDir, "account-2");

  await writeSite({ ...emptySite, outputDir: primaryDir });
  await writeSite({
    ...emptySite,
    outputDir: secondaryDir,
    addonId: "community.simkl.new-anime-episodes.account-2",
    addonName: "Simkl Anime Up Next · Account 2",
    catalogId: "simkl-new-anime-episodes-account-2",
    catalogName: "My Anime Up Next · Simkl 2",
    setupSecretName: "SIMKL_ACCESS_TOKEN_2",
  });

  const primaryManifest = JSON.parse(await readFile(path.join(primaryDir, "manifest.json"), "utf8"));
  const secondaryManifest = JSON.parse(await readFile(path.join(secondaryDir, "manifest.json"), "utf8"));
  assert.notEqual(primaryManifest.id, secondaryManifest.id);
  assert.equal(primaryManifest.catalogs[0].id, CATALOG_ID);
  assert.equal(secondaryManifest.catalogs[0].id, "simkl-new-anime-episodes-account-2");
  await access(path.join(primaryDir, "catalog", "series", `${CATALOG_ID}.json`));
  await access(path.join(secondaryDir, "catalog", "series", "simkl-new-anime-episodes-account-2.json"));

  const secondarySetup = await readFile(path.join(secondaryDir, "setup.html"), "utf8");
  assert.match(secondarySetup, /SIMKL_ACCESS_TOKEN_2/);
});

test("account paths append cleanly to repository and custom-domain base URLs", () => {
  assert.equal(appendBasePath("https://example.github.io/repo/", "/account-2/"), "https://example.github.io/repo/account-2");
  assert.equal(appendBasePath("https://anime.example.com", "account-2"), "https://anime.example.com/account-2");
  assert.equal(appendBasePath("", "account-2"), "");
});
