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

test("poster ribbon SVG distinguishes status, latest release, and next episode with TV-safe outlines", () => {
  const watching = buildPosterBadgeSvg({
    status: "watching",
    episode: "S2 E5",
    latestEpisode: "S2 E11",
    nextEpisode: "S2 E5",
  }).toString();
  const planned = buildPosterBadgeSvg({ status: "plantowatch", episode: "S3E6" }).toString();
  const revived = buildPosterBadgeSvg({ status: "completed", episode: "S3 E1" }).toString();

  assert.match(watching, /NEW EPISODE/);
  assert.match(watching, />NEW</);
  assert.match(watching, />NEXT</);
  assert.match(watching, />S2 E11</);
  assert.match(watching, />S2 E5</);
  assert.match(watching, /#12D98A/);
  assert.match(watching, /stroke-opacity:\.98/);
  assert.match(watching, /stroke-width:3\.8px/);
  assert.match(watching, /textShadow/);
  assert.match(planned, /PLAN TO WATCH/);
  assert.match(planned, />LATEST</);
  assert.match(planned, />S3 E6</);
  assert.match(planned, /#FFC247/);
  assert.match(revived, /NEW SEASON/);
  assert.match(revived, />START</);
  assert.match(revived, />S3 E1</);
  assert.match(revived, /#9B8CFF/);
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
