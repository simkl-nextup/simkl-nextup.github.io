import test from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, chooseCatalogId, mergeCalendar } from "../src/catalog.mjs";

const watching = (overrides = {}) => ({
  status: "watching",
  watched_episodes_count: 4,
  total_episodes_count: 12,
  next_to_watch_info: {
    title: "The Next One",
    episode: 5,
    date: "2026-08-01T10:00:00Z",
  },
  anime: {
    title: "Example Anime",
    poster: "12/example",
    ids: { simkl: 101, imdb: "tt1234567", tmdb: "123" },
  },
  ...overrides,
});

const planned = (overrides = {}) => ({
  status: "plantowatch",
  watched_episodes_count: 0,
  anime: {
    title: "Planned Premiere",
    poster: "12/planned",
    ids: { simkl: 201, imdb: "tt3333333" },
  },
  _addonLatestAiredInfo: {
    title: "The Latest One",
    episode: 4,
    date: "2026-08-01T09:00:00Z",
  },
  ...overrides,
});

test("catalog combines Watching and Plan to Watch titles with aired episodes", () => {
  const items = {
    "101": watching(),
    "201": planned(),
    "102": watching({
      next_to_watch_info: { episode: 6, date: "2026-08-03T10:00:00Z" },
      anime: { title: "Future Anime", ids: { simkl: 102, imdb: "tt7654321" } },
    }),
    "103": watching({
      status: "completed",
      anime: { title: "Completed Anime", ids: { simkl: 103, imdb: "tt1111111" } },
    }),
    "202": planned({
      anime: { title: "Old Planned Anime", ids: { simkl: 202, imdb: "tt4444444" } },
      _addonLatestAiredInfo: { episode: 7, date: "2026-07-01T09:00:00Z" },
    }),
    "203": planned({
      anime: { title: "Future Planned Anime", ids: { simkl: 203, imdb: "tt5555555" } },
      _addonLatestAiredInfo: { episode: 2, date: "2026-08-05T09:00:00Z" },
    }),
  };
  const { catalog, posterBadges } = buildCatalog(items, { now: "2026-08-02T00:00:00Z" });
  assert.equal(catalog.metas.length, 3);
  assert.deepEqual(catalog.metas.map((meta) => meta.name), ["Example Anime", "Planned Premiere", "Old Planned Anime"]);
  assert.equal(catalog.metas[0].releaseInfo, "Ep. 5");
  assert.equal(catalog.metas[1].releaseInfo, "Ep. 4");
  assert.deepEqual(posterBadges, [
    { id: "tt1234567", status: "watching", episode: "Ep. 5" },
    { id: "tt3333333", status: "plantowatch", episode: "Ep. 4" },
    { id: "tt4444444", status: "plantowatch", episode: "Ep. 7" },
  ]);
});

test("catalog revives a Completed title only when a newly aired episode exceeds its watched count", () => {
  const revived = watching({
    status: "completed",
    watched_episodes_count: 12,
    next_to_watch_info: undefined,
    _addonLatestAiredInfo: {
      episode: 13,
      title: "A New Beginning",
      date: "2026-08-02T10:00:00Z",
    },
    anime: { title: "Revived Anime", ids: { simkl: 301, imdb: "tt6666666" } },
  });
  const stillCaughtUp = watching({
    status: "completed",
    watched_episodes_count: 13,
    next_to_watch_info: undefined,
    _addonLatestAiredInfo: { episode: 13, date: "2026-08-02T10:00:00Z" },
    anime: { title: "Caught Up Anime", ids: { simkl: 302, imdb: "tt7777777" } },
  });
  const { catalog } = buildCatalog(
    { "301": revived, "302": stillCaughtUp },
    { now: "2026-08-02T12:00:00Z" },
  );
  assert.deepEqual(catalog.metas.map((meta) => meta.name), ["Revived Anime"]);
  assert.equal(catalog.metas[0].releaseInfo, "Ep. 13");
  assert.match(catalog.metas[0].description, /Previously completed/);
});

test("catalog sorts the most recently aired episode first", () => {
  const items = {
    "101": watching(),
    "104": watching({
      next_to_watch_info: { episode: 2, date: "2026-08-02T08:00:00Z" },
      anime: { title: "Newest", ids: { simkl: 104, imdb: "tt2222222" } },
    }),
  };
  const { catalog } = buildCatalog(items, { now: "2026-08-02T12:00:00Z" });
  assert.deepEqual(catalog.metas.map((meta) => meta.name), ["Newest", "Example Anime"]);
});

test("catalog prefers enriched artwork and retains Simkl as fallback", () => {
  const enriched = watching({
    _addonVisuals: {
      provider: "tmdb",
      poster: "https://image.tmdb.org/t/p/w500/poster.jpg",
      background: "https://image.tmdb.org/t/p/w1280/backdrop.jpg",
      tmdbId: 123,
    },
  });
  const { catalog } = buildCatalog({ "101": enriched }, { now: "2026-08-02T00:00:00Z" });
  assert.equal(catalog.metas[0].poster, "https://image.tmdb.org/t/p/w500/poster.jpg");
  assert.equal(catalog.metas[0].background, "https://image.tmdb.org/t/p/w1280/backdrop.jpg");
  assert.ok(catalog.metas[0].links.some((link) => link.url === "https://www.themoviedb.org/tv/123"));
});

test("catalog ID selection favors IMDb, then TMDB and TVDB", () => {
  assert.equal(chooseCatalogId({ imdb: "tt1234567", tmdb: "12" }), "tt1234567");
  assert.equal(chooseCatalogId({ tmdb: "12", tvdb: "34" }), "tmdb:12");
  assert.equal(chooseCatalogId({ tvdb: "34" }), "tvdb:34");
});

test("calendar refresh updates the matching next episode date", () => {
  const merged = mergeCalendar(
    { "101": watching() },
    {
      calendar: [
        { simkl_id: 101, date: "2026-08-01T12:30:00Z", episode: { episode: 5, title: "Rescheduled" } },
      ],
      metadata: {
        "101": { title: "Example Anime", ids: { simkl_id: 101, tmdb: "123" } },
      },
    },
  );
  assert.equal(merged["101"].next_to_watch_info.date, "2026-08-01T12:30:00Z");
  assert.equal(merged["101"].next_to_watch_info.title, "Rescheduled");
});

test("calendar refresh records the latest aired Plan to Watch episode", () => {
  const merged = mergeCalendar(
    { "201": planned({ _addonLatestAiredInfo: undefined }) },
    {
      calendar: [
        { simkl_id: 201, date: "2026-08-01T09:00:00Z", episode: { episode: 1, title: "The Beginning" } },
        { simkl_id: 201, date: "2026-08-08T09:00:00Z", episode: { episode: 2, title: "Second" } },
      ],
      metadata: {
        "201": { title: "Planned Premiere", ids: { simkl_id: 201, tmdb: "456" } },
      },
    },
    { now: "2026-08-09T00:00:00Z" },
  );
  assert.deepEqual(merged["201"]._addonLatestAiredInfo, {
    episode: 2,
    title: "Second",
    date: "2026-08-08T09:00:00.000Z",
  });
  assert.equal(merged["201"].anime.ids.tmdb, "456");
});

test("raw monthly archives backfill the latest aired Plan to Watch episodes", () => {
  const items = {
    "867371": planned({
      anime: {
        title: "Nijuuseiki Denki Mokuroku: Eureka Evrika",
        ids: { simkl: 867371, imdb: "tt8888888" },
      },
      _addonLatestAiredInfo: undefined,
    }),
    "2754332": planned({
      anime: {
        title: "Tenmaku no Jaadugar",
        ids: { simkl: 2754332, imdb: "tt9999999" },
      },
      _addonLatestAiredInfo: undefined,
    }),
  };
  const rawMonthlyArchive = [
    {
      title: "Nijuuseiki Denki Mokuroku: Eureka Evrika",
      poster: "10/eureka",
      fanart: "10/eureka-fanart",
      date: "2026-08-02T00:00:00+09:00",
      ids: { simkl_id: 867371, tmdb: 456 },
      episode: { episode: 5 },
    },
    {
      title: "Tenmaku no Jaadugar",
      date: "2026-08-01T23:30:00+09:00",
      ids: { simkl_id: 2754332 },
      episode: { episode: 6 },
    },
    {
      title: "Nijuuseiki Denki Mokuroku: Eureka Evrika",
      date: "2026-08-09T00:00:00+09:00",
      ids: { simkl_id: 867371 },
      episode: { episode: 6 },
    },
  ];

  const merged = mergeCalendar(items, rawMonthlyArchive, { now: "2026-08-04T15:01:43Z" });
  assert.equal(merged["867371"]._addonLatestAiredInfo.episode, 5);
  assert.equal(merged["2754332"]._addonLatestAiredInfo.episode, 6);
  assert.equal(merged["867371"].anime.ids.tmdb, 456);

  const { catalog } = buildCatalog(merged, { now: "2026-08-04T15:01:43Z" });
  assert.deepEqual(catalog.metas.map((meta) => meta.name), [
    "Nijuuseiki Denki Mokuroku: Eureka Evrika",
    "Tenmaku no Jaadugar",
  ]);
  assert.match(catalog.metas[0].description, /From your Plan to Watch list/);
});

test("calendar refresh also records a newly aired episode for Completed anime", () => {
  const completed = watching({
    status: "completed",
    watched_episodes_count: 12,
    next_to_watch_info: undefined,
    _addonLatestAiredInfo: undefined,
    anime: { title: "Completed Anime", ids: { simkl: 301, imdb: "tt6666666" } },
  });
  const merged = mergeCalendar(
    { "301": completed },
    {
      calendar: [
        { simkl_id: 301, date: "2026-08-02T10:00:00Z", episode: { episode: 13, title: "We Are Back" } },
      ],
      metadata: { "301": { title: "Completed Anime", ids: { simkl_id: 301 } } },
    },
    { now: "2026-08-02T12:00:00Z" },
  );
  assert.equal(merged["301"]._addonLatestAiredInfo.episode, 13);
});

test("a new release bumps a behind Watching title while keeping its next-unwatched label", () => {
  const behind = watching({
    _addonLatestAiredInfo: {
      episode: 10,
      title: "Newest Release",
      date: "2026-08-02T10:00:00Z",
    },
  });
  const other = watching({
    next_to_watch_info: { episode: 2, date: "2026-08-02T08:00:00Z" },
    anime: { title: "Other Show", ids: { simkl: 104, imdb: "tt2222222" } },
  });
  const { catalog } = buildCatalog({ "101": behind, "104": other }, { now: "2026-08-02T12:00:00Z" });
  assert.deepEqual(catalog.metas.map((meta) => meta.name), ["Example Anime", "Other Show"]);
  assert.equal(catalog.metas[0].releaseInfo, "Ep. 5");
  assert.match(catalog.metas[0].description, /Latest release: Ep\. 10/);
});

test("catalog publishes a synthetic parent with all seasons and opens the mapped Simkl season episode", () => {
  const unified = watching({
    next_to_watch_info: { episode: 5, title: "Next", date: "2026-08-01T10:00:00Z" },
    anime: { title: "Anime Season 2", ids: { simkl: 101, imdb: "tt2000002" } },
    _addonSeriesMeta: {
      parentId: "simkl-unified:900",
      name: "Unified Anime",
      description: "Franchise description",
      releaseInfo: "2024-",
      genres: ["Animation"],
      runtime: "24m",
      matchedSeasonNumber: 2,
      seasonCount: 2,
      episodeCount: 3,
      videos: [
        { id: "tt2000000:1:1", title: "Pilot", released: "2024-01-01T00:00:00.000Z", season: 1, episode: 1 },
        { id: "mal:222:4", title: "Four", released: "2026-07-25T00:00:00.000Z", season: 2, episode: 4 },
        { id: "mal:222:5", title: "Five", released: "2026-08-01T00:00:00.000Z", season: 2, episode: 5 },
      ],
    },
  });

  const { catalog, metadata, unifiedStats } = buildCatalog({ "101": unified }, { now: "2026-08-02T00:00:00Z" });
  assert.equal(catalog.metas[0].id, "simkl-unified:900");
  assert.equal(catalog.metas[0].name, "Unified Anime");
  assert.equal(metadata[0].videos.length, 3);
  assert.equal(metadata[0].behaviorHints.defaultVideoId, "mal:222:5");
  assert.deepEqual(unifiedStats, { titles: 1, seasons: 2, episodes: 3, trackingEpisodes: 0 });
});

test("separate Simkl season entries resolving to the same TMDB show collapse into one card", () => {
  const seriesMeta = {
    parentId: "simkl-unified:901",
    name: "One Franchise",
    matchedSeasonNumber: 1,
    seasonCount: 2,
    episodeCount: 2,
    videos: [
      { id: "mal:5011:1", title: "One", released: "2025-01-01T00:00:00.000Z", season: 1, episode: 1 },
      { id: "mal:5022:1", title: "Return", released: "2026-08-01T00:00:00.000Z", season: 2, episode: 1 },
    ],
  };
  const seasonOne = watching({
    anime: { title: "One Franchise", ids: { simkl: 501, imdb: "tt9010001" } },
    next_to_watch_info: { episode: 1, date: "2026-07-01T00:00:00Z" },
    _addonSeriesMeta: seriesMeta,
  });
  const seasonTwo = watching({
    anime: { title: "One Franchise Season 2", ids: { simkl: 502, imdb: "tt9010002" } },
    next_to_watch_info: { episode: 1, date: "2026-08-01T00:00:00Z" },
    _addonSeriesMeta: { ...seriesMeta, matchedSeasonNumber: 2 },
  });

  const { catalog, metadata } = buildCatalog({ "501": seasonOne, "502": seasonTwo }, { now: "2026-08-02T00:00:00Z" });
  assert.equal(catalog.metas.length, 1);
  assert.equal(metadata[0].behaviorHints.defaultVideoId, "mal:5022:1");
});


test("default video uses the local cour episode after applying the TMDB offset", () => {
  const courTwo = watching({
    next_to_watch_info: { episode: 5, title: "Local episode five", date: "2026-08-01T00:00:00Z" },
    anime: { title: "Split Cour 2", ids: { simkl: 902, mal: 7002 } },
    _addonSeriesMeta: {
      parentId: "simkl-unified:990",
      name: "Split Cour",
      matchedSeasonNumber: 2,
      matchedEpisodeOffset: 12,
      seasonCount: 2,
      episodeCount: 1,
      videos: [
        { id: "mal:7002:5", title: "TMDB episode 17", released: "2026-08-01T00:00:00.000Z", season: 2, episode: 17 },
      ],
    },
  });

  const { metadata } = buildCatalog({ "902": courTwo }, { now: "2026-08-02T00:00:00Z" });
  assert.equal(metadata[0].behaviorHints.defaultVideoId, "mal:7002:5");
});
