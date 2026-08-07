import test from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, buildManifest, chooseCatalogId, mergeCalendar } from "../src/catalog.mjs";

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
    {
      id: "tt1234567",
      status: "watching",
      episode: "Ep. 5",
      latestEpisode: "Ep. 5",
      nextEpisode: "Ep. 5",
    },
    {
      id: "tt3333333",
      status: "plantowatch",
      episode: "Ep. 4",
      latestEpisode: "Ep. 4",
      nextEpisode: null,
    },
    {
      id: "tt4444444",
      status: "plantowatch",
      episode: "Ep. 7",
      latestEpisode: "Ep. 7",
      nextEpisode: null,
    },
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

test("catalog revives a completed multi-season TV show using cumulative episode totals", () => {
  const completedTv = {
    status: "completed",
    watched_episodes_count: 50,
    total_episodes_count: 51,
    show: {
      title: "Returning TV Show",
      ids: { simkl: 401, imdb: "tt8888888" },
    },
    _addonLatestAiredInfo: {
      season: 6,
      episode: 1,
      title: "Season Premiere",
      date: "2026-08-02T10:00:00Z",
    },
  };

  const { catalog, posterBadges } = buildCatalog(
    { "401": completedTv },
    { now: "2026-08-02T12:00:00Z" },
  );

  assert.deepEqual(catalog.metas.map((meta) => meta.name), ["Returning TV Show"]);
  assert.equal(catalog.metas[0].releaseInfo, "S06E01");
  assert.equal(posterBadges[0].status, "completed");
  assert.equal(posterBadges[0].latestEpisode, "S06E01");
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
  const { catalog, posterBadges } = buildCatalog({ "101": behind, "104": other }, { now: "2026-08-02T12:00:00Z" });
  assert.deepEqual(catalog.metas.map((meta) => meta.name), ["Example Anime", "Other Show"]);
  assert.equal(catalog.metas[0].releaseInfo, "Ep. 5");
  assert.match(catalog.metas[0].description, /Latest release: Ep\. 10/);
  assert.equal(posterBadges[0].latestEpisode, "Ep. 10");
  assert.equal(posterBadges[0].nextEpisode, "Ep. 5");
});

test("TVDB metadata collapses separate Simkl seasons into one canonical show with a default episode", () => {
  const sharedMeta = {
    parentId: "tt7654000",
    tvdbId: 900,
    name: "Unified Anime",
    poster: "https://artworks.thetvdb.com/banners/poster.jpg",
    background: "https://artworks.thetvdb.com/banners/background.jpg",
    releaseInfo: "2021-",
    description: "TVDB overview",
    seasonCount: 3,
    episodeCount: 4,
    videos: [
      { id: "tt7654000:1:1", season: 1, episode: 1, title: "Start" },
      { id: "tt7654000:2:1", season: 2, episode: 1, title: "Return" },
      { id: "tt7654000:3:1", season: 3, episode: 1, title: "Again" },
      { id: "tt7654000:3:2", season: 3, episode: 2, title: "Next" },
    ],
  };
  const seasonTwo = watching({
    next_to_watch_info: { episode: 1, date: "2026-07-01T10:00:00Z" },
    anime: { title: "Unified Anime Season 2", ids: { simkl: 501, tvdb: 900 } },
    _addonTvdbMeta: { ...sharedMeta, matchedSeasonNumber: 2, matchedEpisodeOffset: 0, matchedVideoId: "tt7654000:2:1" },
  });
  const seasonThree = watching({
    next_to_watch_info: { episode: 2, date: "2026-08-01T10:00:00Z" },
    anime: { title: "Unified Anime Season 3", ids: { simkl: 502, tvdb: 900 } },
    _addonTvdbMeta: { ...sharedMeta, matchedSeasonNumber: 3, matchedEpisodeOffset: 0, matchedVideoId: "tt7654000:3:2" },
  });

  const result = buildCatalog({ "501": seasonTwo, "502": seasonThree }, { now: "2026-08-05T00:00:00Z" });
  assert.equal(result.catalog.metas.length, 1);
  assert.equal(result.catalog.metas[0].id, "tt7654000");
  assert.equal(result.catalog.metas[0].name, "Unified Anime");
  assert.equal(result.metadata[0].videos.length, 4);
  assert.equal(result.catalog.metas[0].videos.length, 4);
  assert.equal(result.catalog.metas[0].behaviorHints.defaultVideoId, "tt7654000:3:2");
  assert.equal(result.metadata[0].behaviorHints.defaultVideoId, "tt7654000:3:2");
  assert.deepEqual(result.unifiedStats, { titles: 1, seasons: 3, episodes: 4, trackingEpisodes: 4 });
});


test("a fresh season premiere Simkl already auto-promoted to watching still gets the purple revival badge", () => {
  const revived = watching({
    watched_episodes_count: 34,
    total_episodes_count: 44,
    next_to_watch_info: { season: 4, episode: 1, title: "Season 4 Premiere", date: "2026-08-01T10:00:00Z" },
    anime: { title: "Revived Show", ids: { simkl: 601, imdb: "tt6010000" } },
  });
  const result = buildCatalog({ "601": revived }, { now: "2026-08-02T00:00:00Z" });
  assert.equal(result.posterBadges[0].status, "completed");
  assert.match(result.catalog.metas[0].description, /Previously completed/);
});

test("watching that revived premiere flips the badge back to watching, same as any other episode", () => {
  const revivedStarted = watching({
    watched_episodes_count: 35,
    total_episodes_count: 44,
    next_to_watch_info: { season: 4, episode: 2, title: "Season 4, Episode 2", date: "2026-08-08T10:00:00Z" },
    anime: { title: "Revived Show", ids: { simkl: 601, imdb: "tt6010000" } },
  });
  const result = buildCatalog({ "601": revivedStarted }, { now: "2026-08-09T00:00:00Z" });
  assert.equal(result.posterBadges[0].status, "watching");
});

test("a brand new show's season 1 episode 1 is never mistaken for a revival", () => {
  const brandNew = watching({
    watched_episodes_count: 0,
    total_episodes_count: 12,
    next_to_watch_info: { season: 1, episode: 1, title: "Pilot", date: "2026-08-01T10:00:00Z" },
    anime: { title: "Brand New Show", ids: { simkl: 602, imdb: "tt6020000" } },
  });
  const result = buildCatalog({ "602": brandNew }, { now: "2026-08-02T00:00:00Z" });
  assert.equal(result.posterBadges[0].status, "watching");
});

test("a season premiere older than the 365-day freshness window no longer counts as a revival", () => {
  const staleRevival = watching({
    watched_episodes_count: 34,
    total_episodes_count: 44,
    next_to_watch_info: { season: 4, episode: 1, title: "Season 4 Premiere", date: "2025-01-01T00:00:00Z" },
    anime: { title: "Long Ignored Revival", ids: { simkl: 603, imdb: "tt6030000" } },
  });
  const result = buildCatalog({ "603": staleRevival }, { now: "2026-08-02T00:00:00Z" });
  assert.equal(result.posterBadges[0].status, "watching");
});

test("a season premiere without an explicit season field still resolves via TVDB season data", () => {
  const revivedViaTvdb = watching({
    watched_episodes_count: 12,
    total_episodes_count: 24,
    next_to_watch_info: { episode: 1, title: "Season 2 Premiere", date: "2026-08-01T10:00:00Z" },
    anime: { title: "TVDB Revived Show", ids: { simkl: 604, tvdb: 950 } },
    _addonTvdbMeta: {
      parentId: "tvdb:950",
      matchedSeasonNumber: 2,
      matchedEpisodeOffset: 0,
      videos: [
        { id: "tvdb:950:1:1", season: 1, episode: 1 },
        { id: "tvdb:950:2:1", season: 2, episode: 1 },
      ],
    },
  });
  const result = buildCatalog({ "604": revivedViaTvdb }, { now: "2026-08-02T00:00:00Z" });
  assert.equal(result.posterBadges[0].status, "completed");
});

test("manifest uses the broadly supported top-level meta declaration for desktop clients", () => {
  const manifest = buildManifest();
  assert.deepEqual(manifest.resources, ["catalog", "meta"]);
  assert.ok(manifest.idPrefixes.includes("simkl-tvdb-unified:"));
  assert.ok(manifest.idPrefixes.includes("tt"));
  assert.equal(manifest.behaviorHints.newEpisodeNotifications, true);
});
