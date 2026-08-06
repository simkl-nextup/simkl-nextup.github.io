import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { buildPosterBadgeSvg, decorateCatalogPosters } from "../src/poster-badges.mjs";
import { writeSite } from "../src/site.mjs";
import { CATALOG_ID } from "../src/constants.mjs";

async function sourcePoster() {
  return sharp({
    create: {
      width: 400,
      height: 600,
      channels: 4,
      background: "#18304d",
    },
  }).png().toBuffer();
}

function imageResponse(buffer, status = 200) {
  return new Response(buffer, {
    status,
    headers: { "content-type": "image/png" },
  });
}

test("poster badge SVG keeps the TV layout with the exact v1.8.2 palette", () => {
  const watching = buildPosterBadgeSvg({
    status: "watching",
    episode: "Ep. 5",
    latestEpisode: "Ep. 11",
    nextEpisode: "Ep. 5",
  }).toString();
  const planned = buildPosterBadgeSvg({ status: "plantowatch", episode: "S3E6" }).toString();
  const revived = buildPosterBadgeSvg({ status: "completed", episode: "Ep. 13" }).toString();
  const caughtUp = buildPosterBadgeSvg({
    status: "watching",
    episode: "S4E2",
    latestEpisode: "S4E2",
    nextEpisode: "S4E2",
  }).toString();
  const newSeason = buildPosterBadgeSvg({
    status: "completed",
    episode: "S4E1",
    latestEpisode: "S4E2",
    nextEpisode: "S4E1",
  }).toString();

  assert.match(watching, /NEW EPISODE/);
  assert.match(watching, />NEW</);
  assert.match(watching, />NEXT</);
  assert.match(watching, />EP 11</);
  assert.match(watching, />EP 5</);
  assert.match(watching, /id="topStatusPanel"/);
  assert.match(watching, /id="bottomEpisodePanel" x="14" y="654" width="472" height="82" rx="12"/);
  assert.match(watching, /statusGradient/);
  assert.match(watching, /newInfoGradient/);
  assert.match(watching, /font-size:40px/);
  assert.match(watching, /font-size="39px"/);
  assert.match(watching, /#12D98A/);

  assert.match(planned, /PLAN TO WATCH/);
  assert.match(planned, />LATEST</);
  assert.match(planned, />S3 E6</);
  assert.match(planned, /font-size:37px/);
  assert.match(planned, /font-size="43px"/);
  assert.match(planned, /#FFC247/);

  assert.match(revived, /NEW SEASON/);
  assert.match(revived, /#9B8CFF/);

  assert.match(caughtUp, /NEW EPISODE/);
  assert.match(caughtUp, />NEXT</);
  assert.doesNotMatch(caughtUp, />NEW</);
  assert.equal((caughtUp.match(/>S4 E2</g) ?? []).length, 1);

  assert.match(newSeason, /NEW SEASON/);
  assert.match(newSeason, />NEW</);
  assert.match(newSeason, />START</);
  assert.match(newSeason, />S4 E2</);
  assert.match(newSeason, />S4 E1</);
  assert.match(newSeason, /seasonInfoGradient/);
});

test("poster decoration creates a deterministic 500x750 WebP and publishes its URL", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "simkl-poster-badge-"));
  const poster = await sourcePoster();
  const catalog = {
    metas: [{
      id: "tt1234567",
      type: "series",
      name: "Example Anime",
      poster: "https://image.tmdb.org/t/p/w500/example.jpg",
      releaseInfo: "Ep. 6",
    }],
  };
  const badges = [{ id: "tt1234567", status: "plantowatch", episode: "Ep. 6" }];
  const fetchImpl = async () => imageResponse(poster);

  const first = await decorateCatalogPosters(catalog, badges, {
    outputDirectory,
    baseUrl: "https://example.github.io",
    fetchImpl,
  });
  const second = await decorateCatalogPosters(catalog, badges, {
    outputDirectory,
    baseUrl: "https://example.github.io/",
    fetchImpl,
  });

  assert.equal(first.generated, 1);
  assert.deepEqual(first.warnings, []);
  assert.equal(first.catalog.metas[0].poster, second.catalog.metas[0].poster);
  assert.match(first.catalog.metas[0].poster, /^https:\/\/example\.github\.io\/posters\/[a-f0-9]{24}\.webp$/);
  assert.equal(catalog.metas[0].poster, "https://image.tmdb.org/t/p/w500/example.jpg");

  const files = await readdir(path.join(outputDirectory, "posters"));
  assert.equal(files.length, 1);
  const output = await readFile(path.join(outputDirectory, "posters", files[0]));
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 500);
  assert.equal(metadata.height, 750);
});

test("poster decoration keeps the original poster when processing fails", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "simkl-poster-fallback-"));
  const originalPoster = "https://image.tmdb.org/t/p/w500/unavailable.jpg";
  const result = await decorateCatalogPosters(
    { metas: [{ id: "tt7654321", type: "series", name: "Fallback Anime", poster: originalPoster }] },
    [{ id: "tt7654321", status: "watching", episode: "Ep. 2" }],
    {
      outputDirectory,
      baseUrl: "https://example.github.io",
      fetchImpl: async () => imageResponse(Buffer.from("missing"), 404),
    },
  );

  assert.equal(result.generated, 0);
  assert.equal(result.catalog.metas[0].poster, originalPoster);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0].message, /HTTP 404/);
});

test("site generation publishes badged poster URLs and health counts", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "simkl-badged-site-"));
  const poster = await sourcePoster();
  const result = await writeSite({
    outputDir: outputDirectory,
    catalog: {
      metas: [{
        id: "tt9999999",
        type: "series",
        name: "Integrated Anime",
        poster: "https://image.tmdb.org/t/p/w500/integrated.jpg",
        releaseInfo: "Ep. 9",
      }],
    },
    items: {},
    updatedAt: "2026-08-04T12:00:00.000Z",
    sourceCounts: { watching: 1, planToWatch: 0, completed: 0 },
    baseUrl: "https://example.github.io",
    posterBadges: [{ id: "tt9999999", status: "watching", episode: "Ep. 9" }],
    posterBadgesEnabled: true,
    fetchImpl: async () => imageResponse(poster),
  });

  const published = JSON.parse(await readFile(
    path.join(outputDirectory, "catalog", "series", `${CATALOG_ID}.json`),
    "utf8",
  ));
  const status = JSON.parse(await readFile(path.join(outputDirectory, "status.json"), "utf8"));
  assert.equal(result.posterBadgesGenerated, 1);
  assert.equal(published.metas[0].poster, result.catalog.metas[0].poster);
  assert.match(published.metas[0].poster, /^https:\/\/example\.github\.io\/posters\/.+\.webp$/);
  assert.equal(status.posterBadgesEnabled, true);
  assert.equal(status.posterBadgesGenerated, 1);
  assert.deepEqual(status.posterBadgeWarnings, []);
});

test("poster decoration accepts TheTVDB artwork as an input source", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "simkl-tvdb-poster-"));
  const result = await decorateCatalogPosters(
    { metas: [{ id: "tt1111222", type: "series", name: "TVDB Anime", poster: "https://artworks.thetvdb.com/banners/poster.jpg" }] },
    [{ id: "tt1111222", status: "watching", episode: "Ep. 3" }],
    {
      outputDirectory,
      baseUrl: "https://example.github.io",
      fetchImpl: async () => imageResponse(await sourcePoster()),
    },
  );
  assert.equal(result.generated, 1);
  assert.deepEqual(result.warnings, []);
});

test("site generation isolates a second account with unique addon and catalog IDs", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "simkl-account-2-site-"));
  const catalogId = "simkl-new-anime-episodes-account2";
  await writeSite({
    outputDir: outputDirectory,
    catalog: { metas: [] },
    items: {},
    updatedAt: "2026-08-06T10:00:00.000Z",
    baseUrl: "https://example.github.io/account-2",
    addonId: "community.simkl.new-anime-episodes.account2",
    catalogId,
    catalogName: "Account 2 · Anime Up Next · Simkl",
    addonName: "Simkl Anime Up Next · Account 2",
    siteTitle: "Account 2 Anime Up Next",
    accountLabel: "Simkl Account 2",
    setupSecretName: "SIMKL_ACCESS_TOKEN_2",
  });

  const manifest = JSON.parse(await readFile(path.join(outputDirectory, "manifest.json"), "utf8"));
  const catalog = JSON.parse(await readFile(
    path.join(outputDirectory, "catalog", "series", `${catalogId}.json`),
    "utf8",
  ));
  const setup = await readFile(path.join(outputDirectory, "setup.html"), "utf8");
  const index = await readFile(path.join(outputDirectory, "index.html"), "utf8");
  const status = JSON.parse(await readFile(path.join(outputDirectory, "status.json"), "utf8"));

  assert.equal(manifest.id, "community.simkl.new-anime-episodes.account2");
  assert.equal(manifest.catalogs[0].id, catalogId);
  assert.equal(manifest.catalogs[0].name, "Account 2 · Anime Up Next · Simkl");
  assert.deepEqual(catalog, { metas: [] });
  assert.match(setup, /SIMKL_ACCESS_TOKEN_2/);
  assert.match(index, /https:\/\/example\.github\.io\/account-2\/manifest\.json/);
  assert.equal(status.account, "Simkl Account 2");
  assert.equal(status.addonId, manifest.id);
  assert.equal(status.catalogId, catalogId);
});
