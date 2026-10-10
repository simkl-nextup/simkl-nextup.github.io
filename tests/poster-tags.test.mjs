import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { composeTaggedPoster, contrast, DUB_FILLS, dubTag, inkFor, STATUS_TAGS, topTabText } from "../src/poster-tags.mjs";
import { buildCatalog } from "../src/catalog.mjs";

test("top tab always shows the season", () => {
  assert.equal(topTabText({ status: "watching", tags: { aired: 13, airedSeason: 1, next: 2, nextSeason: 1 } }), "S1 · E13 Aired · Next E2");
  assert.equal(topTabText({ status: "watching", tags: { aired: 1, airedSeason: 2, next: 10, nextSeason: 1 } }), "S2E1 Aired · Next S1E10");
  assert.equal(topTabText({ status: "watching", tags: { aired: 9, airedSeason: 4, next: 9, nextSeason: 4 } }), "S4 · Next E9");
  assert.equal(topTabText({ status: "completed", tags: { aired: 15, airedSeason: 3, next: 15, nextSeason: 3 } }), "S3 · Next E15");
  assert.equal(topTabText({ status: "plantowatch", tags: { aired: 12, airedSeason: 1 } }), "S1 · E12 Aired");
  assert.equal(topTabText({ status: "plantowatch", tags: { aired: 12 } }), "S1 · E12 Aired");
});

test("dub tag shows the season and compares with the next episode", () => {
  const watching = (dub, next = 5) => ({ status: "watching", tags: { aired: 12, airedSeason: 3, next, nextSeason: 3 }, dub });
  assert.equal(dubTag(watching(undefined)), null);
  assert.deepEqual(dubTag(watching({ episode: 7, season: 3 })), { text: "DUB ✓ S3 E7", state: "ready" });
  assert.deepEqual(dubTag(watching({ episode: 5, season: 3 })), { text: "DUB ✓ S3 E5", state: "ready" });
  assert.deepEqual(dubTag(watching({ episode: 4, season: 3 })), { text: "DUB S3 E4", state: "behind" });
  assert.deepEqual(dubTag(watching({ episode: 12, season: 2 })), { text: "DUB S2 E12", state: "behind" }, "earlier season is behind");
  assert.deepEqual(dubTag(watching({ episode: 12, full: true, season: 3 })), { text: "DUB ✓ S3 ALL", state: "ready" });
  assert.deepEqual(dubTag(watching({ episode: null, airing: true })), { text: "DUB S3 AIRING", state: "behind" });
  assert.deepEqual(dubTag(watching({ episode: 20, numberingMismatch: true, season: 3 })), { text: "DUB S3 E20", state: "behind" });
  assert.deepEqual(dubTag({ status: "plantowatch", tags: { aired: 12, airedSeason: 1 }, dub: { episode: 1 } }), { text: "DUB ✓ S1 E1", state: "ready" });
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
  assert.deepEqual(posterBadges[0].tags, { season: 1, aired: 13, airedSeason: 1, next: 2, nextSeason: 1 });
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

test("TheTVDB ClearLogo is picked (English first) and used when TMDB has no logo", async () => {
  const { pickLogo } = await import("../src/tvdb.mjs");
  const series = { artworks: [
    { type: 2, typeName: "Poster", image: "/p.jpg" },
    { typeName: "ClearLogo", language: "jpn", image: "/logo-jp.png", score: 900 },
    { typeName: "ClearLogo", language: "eng", image: "/logo-en.png", score: 10 },
  ] };
  assert.equal(pickLogo(series), "https://artworks.thetvdb.com/banners/logo-en.png");
  assert.equal(pickLogo({ artworks: [{ typeName: "Poster", image: "/p.jpg" }] }), null);

  const items = { 1: {
    status: "watching",
    next_to_watch_info: { episode: 2, date: "2026-08-01T10:00:00Z" },
    _addonTvdbMeta: { logo: "https://artworks.thetvdb.com/banners/logo-en.png" },
    anime: { title: "Sparks", ids: { simkl: 1, imdb: "tt1000001" } },
  } };
  const { posterBadges } = buildCatalog(items, { now: "2026-08-02T00:00:00Z" });
  assert.equal(posterBadges[0].logo, "https://artworks.thetvdb.com/banners/logo-en.png");
});

test("season numbers follow TheTVDB's unified seasons (as in Nuvio's episode list)", () => {
  const videos = [];
  for (let s = 1; s <= 3; s += 1) for (let e = 1; e <= 16; e += 1) videos.push({ id: `tt1:${s}:${e}`, season: s, episode: e, released: "2026-01-01T00:00:00Z" });
  const items = { 1: {
    status: "watching",
    next_to_watch_info: { episode: 15, season: 1, date: "2026-10-04T00:00:00Z" },
    _addonLatestAiredInfo: { episode: 16, season: 1, date: "2026-10-09T00:00:00Z" },
    _addonTvdbMeta: { parentId: "simkl-tvdb-unified:1", videos, matchedSeasonNumber: 3, matchedEpisodeOffset: 0 },
    anime: { title: "Mushoku Tensei III", ids: { simkl: 1, imdb: "tt1" } },
  } };
  const { posterBadges } = buildCatalog(items, { now: "2026-10-10T00:00:00Z" });
  assert.equal(topTabText(posterBadges[0]), "S3 · E16 Aired · Next E15");
});

test("dub episode uses the same TheTVDB season as the top tab (Mushoku S3)", () => {
  const videos = [];
  for (let s = 1; s <= 3; s += 1) for (let e = 1; e <= 16; e += 1) videos.push({ id: `tt1:${s}:${e}`, season: s, episode: e, absoluteNumber: (s - 1) * 16 + e, released: "2026-01-01T00:00:00Z" });
  const base = {
    status: "watching",
    next_to_watch_info: { episode: 14, season: 1, date: "2026-09-27T00:00:00Z" },
    _addonLatestAiredInfo: { episode: 15, season: 1, date: "2026-10-04T00:00:00Z" },
    _addonTvdbMeta: { parentId: "simkl-tvdb-unified:1", videos, matchedSeasonNumber: 3, matchedEpisodeOffset: 0 },
    anime: { title: "Mushoku Tensei III", ids: { simkl: 1, imdb: "tt1" } },
  };
  const behind = buildCatalog({ 1: { ...base, _addonDub: { episode: 13 } } }, { now: "2026-10-10T00:00:00Z" }).posterBadges[0];
  assert.equal(topTabText(behind), "S3 · E15 Aired · Next E14");
  assert.deepEqual(dubTag(behind), { text: "DUB S3 E13", state: "behind" });
  const ready = buildCatalog({ 1: { ...base, _addonDub: { episode: 15 } } }, { now: "2026-10-10T00:00:00Z" }).posterBadges[0];
  assert.deepEqual(dubTag(ready), { text: "DUB ✓ S3 E15", state: "ready" });
});

test("dub with unknown progress shows a plain grey 'DUB S1'", () => {
  assert.deepEqual(dubTag({ status: "watching", tags: { next: 2, nextSeason: 1 }, dub: { episode: null, unknown: true } }), { text: "DUB S1", state: "behind" });
});
