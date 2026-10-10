import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { DEFAULT_POSTER_STYLE, loadPosterStyle, normalizePosterStyle, POSTER_STYLE_OPTIONS } from "../src/poster-style.mjs";
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
  assert.deepEqual(normalizePosterStyle(shipped), shipped, "shipped config is already normalized");
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
    posterBadges: [{ id: "tt1", status: "watching", tags: { aired: 13, next: 2 }, dub: { episode: 9 }, malScore: "7.9" }],
    posterBadgesEnabled: true,
    posterStyle: "tags",
    tagStyle: { ...DEFAULT_POSTER_STYLE, topTab: "boxed" },
    studio: { repository: "me/repo", branch: "main", configPath: "config/poster-style.json" },
    fetchImpl: fetchImplFor(source),
  });
  await access(path.join(dir, "studio.html"));
  await access(path.join(dir, "studio", "Inter-ExtraBold.otf"));
  const data = JSON.parse(await readFile(path.join(dir, "studio", "studio-data.json"), "utf8"));
  assert.equal(data.repository, "me/repo");
  assert.equal(data.currentStyle.topTab, "boxed");
  assert.deepEqual(data.defaultStyle, DEFAULT_POSTER_STYLE);
  assert.equal(data.samples.length, 1);
  assert.equal(data.samples[0].name, "Studio Anime");
  assert.ok(data.samples[0].dub?.text);
  const raw = JSON.stringify(data);
  assert.doesNotMatch(raw, /token|secret/i, "studio data never carries credentials");
});

test("classic TV site does not publish the studio", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "simkl-nostudio-"));
  await writeSite({
    outputDir: dir, catalog: { metas: [] }, items: {}, updatedAt: "2026-10-10T00:00:00.000Z",
    baseUrl: "https://example.github.io/account-2", mediaType: "tv",
  });
  assert.equal((await readdir(dir)).includes("studio.html"), false);
});
