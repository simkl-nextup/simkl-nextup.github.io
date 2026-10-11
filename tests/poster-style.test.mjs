import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { DEFAULT_POSTER_STYLE, loadPosterConfig, loadPosterStyle, normalizePosterConfig, normalizePosterStyle, POSTER_STYLE_OPTIONS } from "../src/poster-style.mjs";
import { composeTaggedPoster, taggedSignatureParts } from "../src/poster-tags.mjs";
import { decorateCatalogPosters } from "../src/poster-badges.mjs";
import { writeSite } from "../src/site.mjs";

test("default style is 1.11.1 without the white outline on black text", () => {
  assert.equal(DEFAULT_POSTER_STYLE.outlineOnDarkText, false);
  assert.equal(DEFAULT_POSTER_STYLE.outlineOnWhiteText, true);
  assert.equal(DEFAULT_POSTER_STYLE.tagShadow, "coloured");
  for (const [key, value] of Object.entries(DEFAULT_POSTER_STYLE)) {
    assert.ok(String(value) in POSTER_STYLE_OPTIONS[key].choices, `${key} default must be a listed choice`);
  }
});

test("normalizePosterStyle keeps valid choices and drops junk", () => {
  assert.deepEqual(normalizePosterStyle(null), DEFAULT_POSTER_STYLE);
  const style = normalizePosterStyle({ topTab: "band", size: "compact", outlineOnDarkText: "true", tagShadow: "rainbow", evil: "<script>" });
  assert.equal(style.topTab, "band");
  assert.equal(style.size, "compact");
  assert.equal(style.outlineOnDarkText, true);
  assert.equal(style.tagShadow, "coloured", "unknown value falls back to default");
  assert.equal("evil" in style, false);
  assert.equal(normalizePosterStyle({ ratingShadow: false }).ratingShadow, false);
});

test("loadPosterStyle reads the config file and falls back on missing/broken files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "simkl-style-"));
  assert.deepEqual(await loadPosterStyle(path.join(dir, "missing.json")), DEFAULT_POSTER_STYLE);
  await writeFile(path.join(dir, "broken.json"), "{nope");
  assert.deepEqual(await loadPosterStyle(path.join(dir, "broken.json")), DEFAULT_POSTER_STYLE);
  await writeFile(path.join(dir, "ok.json"), JSON.stringify({ topTab: "single" }));
  assert.equal((await loadPosterStyle(path.join(dir, "ok.json"))).topTab, "single");
  const shipped = JSON.parse(await readFile(new URL("../config/poster-style.json", import.meta.url), "utf8"));
  assert.deepEqual(normalizePosterConfig(shipped), shipped, "shipped config is already normalized");
});

test("config has a section per row; anime defaults to tags, TV to classic", async () => {
  const empty = normalizePosterConfig({});
  assert.equal(empty.anime.look, "tags");
  assert.equal(empty.tv.look, "classic");
  const mixed = normalizePosterConfig({ anime: { look: "classic" }, tv: { look: "tags", topTab: "band", look2: "x" } });
  assert.equal(mixed.anime.look, "classic");
  assert.equal(mixed.tv.look, "tags");
  assert.equal(mixed.tv.topTab, "band");
  assert.equal("look2" in mixed.tv, false);
  assert.equal(normalizePosterConfig({ tv: { look: "neon" } }).tv.look, "classic", "unknown look falls back");
});

test("a flat 1.12.0 config file is read as the anime section", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "simkl-legacy-style-"));
  const file = path.join(dir, "legacy.json");
  await writeFile(file, JSON.stringify({ topTab: "boxed", size: "compact" }));
  const config = await loadPosterConfig(file);
  assert.equal(config.anime.look, "tags");
  assert.equal(config.anime.topTab, "boxed");
  assert.equal(config.tv.topTab, DEFAULT_POSTER_STYLE.topTab);
  const tvStyle = await loadPosterStyle(file, "tv");
  assert.equal("look" in tvStyle, false, "renderer style has no look key");
});

test("every top-tab mode and size renders a 500x750 poster", async () => {
  const poster = await sharp({ create: { width: 300, height: 450, channels: 3, background: "#d0c0a0" } }).png().toBuffer();
  const badge = { status: "watching", tags: { aired: 13, airedSeason: 2, next: 2, nextSeason: 2 }, dub: { episode: 9, season: 2 }, malScore: "8.1" };
  for (const topTab of Object.keys(POSTER_STYLE_OPTIONS.topTab.choices)) {
    for (const size of ["large", "compact"]) {
      const style = { topTab, size, outlineOnDarkText: true, outlineWeight: "bold", tagShadow: "none", contrast: "standard" };
      const out = await composeTaggedPoster({ poster, logo: null, name: "Example", badge, style });
      const meta = await sharp(out).metadata();
      assert.equal(meta.width, 500, `${topTab}/${size}`);
      assert.equal(meta.height, 750, `${topTab}/${size}`);
    }
  }
});

test("changing the style changes the poster signature (cache busting)", () => {
  const badge = { status: "watching", tags: { aired: 1, next: 1 } };
  const a = JSON.stringify(taggedSignatureParts(badge, DEFAULT_POSTER_STYLE));
  const b = JSON.stringify(taggedSignatureParts(badge, { ...DEFAULT_POSTER_STYLE, topTab: "band" }));
  assert.notEqual(a, b);
});

const fetchImplFor = (source) => async () => ({
  ok: true, status: 200, url: "https://image.tmdb.org/t/p/w500/x.jpg",
  headers: { get: (name) => (name === "content-type" ? "image/jpeg" : null) },
  arrayBuffer: async () => source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
});

test("style change produces a different poster filename", async () => {
  const source = await sharp({ create: { width: 400, height: 600, channels: 3, background: "#305080" } }).jpeg().toBuffer();
  const catalog = { metas: [{ id: "tt1", type: "series", name: "A", poster: "https://image.tmdb.org/t/p/w500/x.jpg" }] };
  const badge = { id: "tt1", status: "watching", tags: { aired: 13, next: 2 }, dub: { episode: 9 } };
  const run = async (tagStyle) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "simkl-stylefile-"));
    const result = await decorateCatalogPosters(catalog, [badge], { outputDirectory: dir, baseUrl: "https://x.github.io", fetchImpl: fetchImplFor(source), style: "tags", tagStyle });
    return result.catalog.metas[0].poster;
  };
  assert.notEqual(await run(DEFAULT_POSTER_STYLE), await run({ ...DEFAULT_POSTER_STYLE, size: "compact" }));
});

test("anime tags site publishes the studio page and its data", async () => {
  const source = await sharp({ create: { width: 400, height: 600, channels: 3, background: "#704060" } }).jpeg().toBuffer();
  const dir = await mkdtemp(path.join(os.tmpdir(), "simkl-studio-"));
  await writeSite({
    outputDir: dir,
    catalog: { metas: [{ id: "tt1", type: "series", name: "Studio Anime", poster: "https://image.tmdb.org/t/p/w500/x.jpg" }] },
    items: {},
    updatedAt: "2026-10-10T00:00:00.000Z",
    baseUrl: "https://example.github.io",
    posterBadges: [{ id: "tt1", status: "watching", episode: "Ep. 2", tags: { aired: 13, next: 2 }, dub: { episode: 9 }, malScore: "7.9" }],
    posterBadgesEnabled: true,
    posterStyle: "tags",
    tagStyle: { ...DEFAULT_POSTER_STYLE, topTab: "boxed" },
    studio: { account: "anime", config: normalizePosterConfig({ anime: { topTab: "boxed" } }), repository: "me/repo", branch: "main", configPath: "config/poster-style.json" },
    fetchImpl: fetchImplFor(source),
  });
  await access(path.join(dir, "studio.html"));
  await access(path.join(dir, "studio", "Inter-ExtraBold.otf"));
  const data = JSON.parse(await readFile(path.join(dir, "studio", "studio-data.json"), "utf8"));
  assert.equal(data.repository, "me/repo");
  assert.equal(data.account, "anime");
  assert.equal(data.config.anime.topTab, "boxed");
  assert.equal(data.config.tv.look, "classic");
  assert.equal(data.samples.length, 1);
  assert.equal(data.samples[0].name, "Studio Anime");
  assert.ok(data.samples[0].dub?.text);
  const classic = await sharp(path.join(dir, "studio", data.samples[0].classicImage)).metadata();
  assert.equal(classic.format, "webp", "classic preview is rendered by the build");
  const raw = JSON.stringify(data);
  assert.doesNotMatch(raw, /token|secret/i, "studio data never carries credentials");
});

test("TV row publishes its studio samples (no page, no dub) and can use the tags look", async () => {
  const source = await sharp({ create: { width: 400, height: 600, channels: 3, background: "#305040" } }).jpeg().toBuffer();
  const site = (posterStyle) => async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "simkl-tv-studio-"));
    const result = await writeSite({
      outputDir: dir,
      catalog: { metas: [{ id: "tt7", type: "series", name: "A TV Show", poster: "https://image.tmdb.org/t/p/w500/x.jpg" }] },
      items: {}, updatedAt: "2026-10-10T00:00:00.000Z",
      baseUrl: "https://example.github.io/account-2", mediaType: "tv",
      posterBadges: [{ id: "tt7", status: "watching", episode: "S2E3", tags: { aired: 4, airedSeason: 2, next: 3, nextSeason: 2 } }],
      posterBadgesEnabled: true, posterStyle,
      studio: { account: "tv", config: normalizePosterConfig({ tv: { look: posterStyle } }), configPath: "config/poster-style.json" },
      fetchImpl: fetchImplFor(source),
    });
    return { dir, result };
  };
  for (const look of ["classic", "tags"]) {
    const { dir, result } = await site(look)();
    assert.equal((await readdir(dir)).includes("studio.html"), false, "only the site root hosts the page");
    const data = JSON.parse(await readFile(path.join(dir, "studio", "studio-data.json"), "utf8"));
    assert.equal(data.account, "tv");
    assert.equal(data.config.tv.look, look);
    assert.equal(data.samples[0].dub, null);
    assert.equal(data.samples[0].malScore, null);
    assert.equal(result.posterBadgesGenerated, 1);
  }
  const classic = await site("classic")();
  const tags = await site("tags")();
  assert.notEqual(classic.result.catalog.metas[0].poster, tags.result.catalog.metas[0].poster, "switching the look changes the poster");
});
