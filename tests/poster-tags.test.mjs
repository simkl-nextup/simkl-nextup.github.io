import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { composeTaggedPoster, contrast, DUB_FILLS, dubTag, inkFor, STATUS_TAGS, topTabText } from "../src/poster-tags.mjs";
import { buildCatalog } from "../src/catalog.mjs";

test("top tab wording per status", () => {
  assert.equal(topTabText({ status: "watching", tags: { aired: 13, next: 2 } }), "E13 Aired · Next E2");
  assert.equal(topTabText({ status: "completed", tags: { season: 3, aired: 1, next: 1 } }), "S3 · Next E1");
  assert.equal(topTabText({ status: "completed", tags: { aired: 1, next: 1 } }), "Next E1");
  assert.equal(topTabText({ status: "plantowatch", tags: { aired: 12, next: null } }), "E12 Aired");
});

test("dub tag compares the dub with the next episode", () => {
  const watching = (dub, next = 5) => ({ status: "watching", tags: { aired: 12, next }, dub });
  assert.equal(dubTag(watching(undefined)), null);
  assert.deepEqual(dubTag(watching({ episode: 7 })), { text: "DUB ✓ E7", state: "ready" });
  assert.deepEqual(dubTag(watching({ episode: 5 })), { text: "DUB ✓ E5", state: "ready" });
  assert.deepEqual(dubTag(watching({ episode: 4 })), { text: "DUB E4", state: "behind" });
  assert.deepEqual(dubTag(watching({ episode: 12, full: true })), { text: "DUB ✓ ALL", state: "ready" });
  assert.deepEqual(dubTag(watching({ episode: 20, numberingMismatch: true })), { text: "DUB E20", state: "behind" });
  assert.deepEqual(dubTag({ status: "plantowatch", tags: { aired: 12 }, dub: { episode: 1 } }), { text: "DUB ✓ E1", state: "ready" });
});

test("status tag colours keep readable text", () => {
  for (const { fill } of Object.values(STATUS_TAGS)) {
    assert.ok(contrast(fill, inkFor(fill)) >= 4.5, `${fill} needs readable text`);
  }
  for (const fill of Object.values(DUB_FILLS)) {
    assert.ok(contrast(fill, "#FFFFFF") >= 4.5, `dub tag ${fill} needs readable white text`);
  }
});

test("composeTaggedPoster renders a 500x750 WebP with and without a dub", async () => {
  const poster = await sharp({ create: { width: 300, height: 450, channels: 3, background: "#4060a0" } }).png().toBuffer();
  for (const dub of [undefined, { episode: 9 }]) {
    const out = await composeTaggedPoster({
      poster,
      logo: null,
      name: "Example Anime",
      badge: { status: "watching", tags: { aired: 13, next: 2 }, dub, malScore: "7.9" },
    });
    const meta = await sharp(out).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, 500);
    assert.equal(meta.height, 750);
  }
});

test("catalog badges carry season/episode numbers, dub and MAL score; description mentions the dub", () => {
  const items = {
    1: {
      status: "watching",
      next_to_watch_info: { episode: 2, date: "2026-08-01T10:00:00Z" },
      _addonLatestAiredInfo: { episode: 13, date: "2026-08-01T12:00:00Z" },
      _addonDub: { route: "sparks", episode: 9, full: false },
      _addonAnimeScheduleRoute: "sparks",
      _addonMalScore: "7.9",
      anime: { title: "Sparks", ids: { simkl: 1, imdb: "tt1000001" } },
    },
  };
  const { catalog, posterBadges } = buildCatalog(items, { now: "2026-08-02T00:00:00Z" });
  assert.deepEqual(posterBadges[0].tags, { season: null, aired: 13, next: 2 });
  assert.equal(posterBadges[0].dub.episode, 9);
  assert.equal(posterBadges[0].malScore, "7.9");
  assert.match(catalog.metas[0].description, /English dub: up to episode 9\. Data from Simkl\.$/);
  assert.ok(catalog.metas[0].links.some((link) => link.url === "https://animeschedule.net/anime/sparks"));
});

test("anime site uses the tags style; filenames differ from the classic TV style", async () => {
  const { mkdtemp, readdir } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { decorateCatalogPosters } = await import("../src/poster-badges.mjs");
  const source = await sharp({ create: { width: 400, height: 600, channels: 3, background: "#806040" } }).jpeg().toBuffer();
  const fetchImpl = async () => ({
    ok: true, status: 200, url: "https://image.tmdb.org/t/p/w500/x.jpg",
    headers: { get: (name) => (name === "content-type" ? "image/jpeg" : null) },
    arrayBuffer: async () => source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
  });
  const catalog = { metas: [{ id: "tt1", type: "series", name: "A", poster: "https://image.tmdb.org/t/p/w500/x.jpg" }] };
  const badge = { id: "tt1", status: "watching", episode: "Ep. 2", latestEpisode: "Ep. 13", nextEpisode: "Ep. 2", tags: { aired: 13, next: 2 }, dub: { episode: 9 }, malScore: "7.9" };

  const tagsDir = await mkdtemp(path.join(os.tmpdir(), "simkl-tags-"));
  const tags = await decorateCatalogPosters(catalog, [badge], { outputDirectory: tagsDir, baseUrl: "https://x.github.io", fetchImpl, style: "tags" });
  const classicDir = await mkdtemp(path.join(os.tmpdir(), "simkl-classic-"));
  const classic = await decorateCatalogPosters(catalog, [badge], { outputDirectory: classicDir, baseUrl: "https://x.github.io", fetchImpl });

  assert.equal(tags.generated, 1);
  assert.equal(classic.generated, 1);
  assert.notEqual(tags.catalog.metas[0].poster, classic.catalog.metas[0].poster);
  const [file] = await readdir(path.join(tagsDir, "posters"));
  const meta = await sharp(path.join(tagsDir, "posters", file)).metadata();
  assert.equal(meta.width, 500);
  assert.equal(meta.height, 750);
});
