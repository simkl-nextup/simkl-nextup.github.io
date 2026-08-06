import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTvdbSeriesMetadata,
  createTvdbClient,
  enrichTvdbMetadata,
  inferTvdbPosition,
  tvdbImage,
  unifyTvdbMetadata,
} from "../src/tvdb.mjs";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("TVDB client logs in once, resolves an IMDb ID, and follows episode pagination", async () => {
  const calls = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    calls.push({ url, options });
    if (url.pathname === "/v4/login") {
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), { apikey: "test-key", pin: "test-pin" });
      return jsonResponse({ data: { token: "bearer-token" } });
    }
    assert.equal(options.headers.Authorization, "Bearer bearer-token");
    if (url.pathname === "/v4/search/remoteid/tt1234567") {
      return jsonResponse({ data: [{ type: "series", tvdb_id: "900" }] });
    }
    if (url.pathname === "/v4/series/900/extended") {
      assert.equal(url.searchParams.get("meta"), "translations");
      return jsonResponse({ data: { id: 900, name: "Example" } });
    }
    if (url.pathname === "/v4/series/900/translations/eng") {
      return jsonResponse({ data: { name: "English Example", overview: "English overview" } });
    }
    if (url.pathname === "/v4/series/900/episodes/default/eng" && url.searchParams.get("page") === "0") {
      return jsonResponse({
        data: { episodes: [{ id: 1, seasonNumber: 1, number: 1 }] },
        links: { next: "https://api4.thetvdb.com/v4/series/900/episodes/default/eng?page=1" },
      });
    }
    if (url.pathname === "/v4/series/900/episodes/default/eng" && url.searchParams.get("page") === "1") {
      return jsonResponse({
        data: { episodes: [{ id: 2, seasonNumber: 1, number: 2 }] },
        links: { next: null },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const client = createTvdbClient({ apiKey: "test-key", pin: "test-pin", fetchImpl });
  assert.equal(await client.resolveSeriesId({ imdb: "tt1234567" }), 900);
  assert.equal((await client.getSeriesExtended(900)).name, "Example");
  assert.equal((await client.getSeriesTranslation(900, "eng")).name, "English Example");
  const episodes = await client.getSeriesEpisodes(900, { seasonType: "default", language: "eng" });
  assert.deepEqual(episodes.map((episode) => episode.id), [1, 2]);
  assert.equal(calls.filter(({ url }) => url.pathname === "/v4/login").length, 1);
});

test("TVDB metadata uses a canonical IMDb parent, TVDB order, and full episode artwork", () => {
  const meta = buildTvdbSeriesMetadata(
    {
      id: 900,
      name: "Unified Anime",
      overview: "Series overview",
      image: "/banners/series/poster.jpg",
      firstAired: "2021-01-01",
      status: { name: "Continuing" },
      genres: [{ name: "Animation" }],
      remoteIds: [{ sourceName: "IMDB", id: "tt7654000" }],
      artworks: [
        { typeName: "Background", image: "/banners/series/background.jpg", width: 1920, height: 1080 },
      ],
    },
    [
      {
        id: 11,
        seasonNumber: 1,
        number: 1,
        name: "First",
        aired: "2021-01-01",
        image: "/banners/episodes/11.jpg",
        overview: "First episode",
      },
      {
        id: 21,
        seasonNumber: 2,
        number: 1,
        name: "Return",
        aired: "2023-01-01",
        image: "https://artworks.thetvdb.com/banners/episodes/21.jpg",
      },
      {
        id: 1,
        seasonNumber: 0,
        number: 1,
        name: "Special",
        aired: "2022-01-01",
      },
    ],
    {
      now: new Date("2026-08-05T00:00:00Z"),
      translation: { name: "Unified Anime in English", overview: "English series overview" },
    },
  );

  assert.equal(meta.parentId, "tt7654000");
  assert.equal(meta.tvdbId, 900);
  assert.equal(meta.seasonCount, 2);
  assert.equal(meta.specialSeasonIncluded, true);
  assert.deepEqual(meta.videos.map((video) => video.id), [
    "tt7654000:0:1",
    "tt7654000:1:1",
    "tt7654000:2:1",
  ]);
  assert.equal(meta.videos[1].thumbnail, "https://artworks.thetvdb.com/banners/episodes/11.jpg");
  assert.equal(meta.videos[2].thumbnail, "https://artworks.thetvdb.com/banners/episodes/21.jpg");
  assert.equal(meta.releaseInfo, "2021-");
  assert.equal(meta.name, "Unified Anime in English");
  assert.equal(meta.description, "English series overview");
  assert.equal(tvdbImage("banners/example.jpg"), "https://artworks.thetvdb.com/banners/example.jpg");
});

test("TVDB position inference maps a split cour by air date and preserves its offset", () => {
  const seriesMeta = {
    videos: [
      { id: "tt7654000:2:13", season: 2, episode: 13, title: "The Return", released: "2026-07-01T00:00:00.000Z" },
      { id: "tt7654000:2:14", season: 2, episode: 14, title: "Next", released: "2026-07-08T00:00:00.000Z" },
    ],
  };
  const item = {
    status: "watching",
    next_to_watch_info: { episode: 1, title: "The Return", date: "2026-07-01T09:00:00Z" },
    anime: { title: "Unified Anime Part 2", year: 2026, ids: { simkl: 101, tvdb: 900 } },
  };
  assert.deepEqual(inferTvdbPosition(item, seriesMeta), {
    matchedSeasonNumber: 2,
    matchedEpisodeOffset: 12,
    matchedVideoId: "tt7654000:2:13",
  });
});

test("TVDB enrichment reuses one fetched series template for multiple Simkl season entries", async () => {
  let loginCalls = 0;
  let seriesCalls = 0;
  let episodeCalls = 0;
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/v4/login") {
      loginCalls += 1;
      return jsonResponse({ data: { token: "token" } });
    }
    if (url.pathname === "/v4/series/900/extended") {
      seriesCalls += 1;
      return jsonResponse({
        data: {
          id: 900,
          name: "Unified Anime",
          remoteIds: [{ sourceName: "IMDB", id: "tt7654000" }],
        },
      });
    }
    if (url.pathname === "/v4/series/900/episodes/default/eng") {
      episodeCalls += 1;
      return jsonResponse({
        data: {
          episodes: [
            { id: 11, seasonNumber: 1, number: 1, aired: "2024-01-01" },
            { id: 21, seasonNumber: 2, number: 1, aired: "2026-07-01" },
          ],
        },
        links: { next: null },
      });
    }
    if (url.pathname === "/v4/series/900/translations/eng") {
      return jsonResponse({ data: { name: "Unified Anime" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await enrichTvdbMetadata({
    "101": {
      status: "completed",
      _addonLatestAiredInfo: { episode: 1, date: "2024-01-01T00:00:00Z" },
      anime: { title: "Unified Anime", ids: { simkl: 101, tvdb: 900 } },
    },
    "102": {
      status: "watching",
      next_to_watch_info: { episode: 1, date: "2026-07-01T00:00:00Z" },
      anime: { title: "Unified Anime Season 2", ids: { simkl: 102, tvdb: 900 } },
    },
  }, {
    apiKey: "test-key",
    fetchImpl,
    now: new Date("2026-08-05T00:00:00Z"),
  });

  assert.equal(loginCalls, 1);
  assert.equal(seriesCalls, 1);
  assert.equal(episodeCalls, 1);
  assert.equal(result.items["101"]._addonTvdbMeta.parentId, "tt7654000");
  assert.equal(result.items["102"]._addonTvdbMeta.parentId, "tt7654000");
  assert.equal(result.items["102"]._addonTvdbMeta.matchedVideoId, "tt7654000:2:1");
});

test("TVDB records that share a TMDB show merge into one parent without changing episode IDs", () => {
  const result = unifyTvdbMetadata({
    "101": {
      status: "completed",
      anime: { title: "Example Anime", year: 2024, ids: { simkl: 101, tvdb: 901 } },
      _addonVisuals: {
        tmdbId: 500,
        tmdbMediaType: "tv",
        tmdbName: "Example Anime",
        tmdbSeasons: [{ seasonNumber: 1, airDate: "2024-01-01" }, { seasonNumber: 2, airDate: "2026-01-01" }],
      },
      _addonTvdbMeta: {
        tvdbId: 901,
        parentId: "tt1111111",
        name: "Japanese original title",
        videos: [
          { id: "tt1111111:1:1", season: 1, episode: 1, released: "2024-01-01T00:00:00.000Z" },
        ],
        matchedSeasonNumber: 1,
        matchedVideoId: "tt1111111:1:1",
      },
    },
    "102": {
      status: "watching",
      anime: { title: "Example Anime Season 2", year: 2026, ids: { simkl: 102, tvdb: 902 } },
      _addonVisuals: {
        tmdbId: 500,
        tmdbMediaType: "tv",
        tmdbName: "Example Anime",
        tmdbSeasons: [{ seasonNumber: 1, airDate: "2024-01-01" }, { seasonNumber: 2, airDate: "2026-01-01" }],
      },
      _addonTvdbMeta: {
        tvdbId: 902,
        parentId: "tt2222222",
        name: "Japanese sequel title",
        videos: [
          { id: "tt2222222:1:1", season: 1, episode: 1, released: "2026-01-01T00:00:00.000Z" },
        ],
        matchedSeasonNumber: 1,
        matchedVideoId: "tt2222222:1:1",
      },
    },
  });

  const first = result["101"]._addonTvdbMeta;
  const second = result["102"]._addonTvdbMeta;
  assert.equal(first.parentId, "simkl-tvdb-unified:500");
  assert.equal(second.parentId, "simkl-tvdb-unified:500");
  assert.equal(first.name, "Example Anime");
  assert.deepEqual(first.videos.map((video) => [video.id, video.season]), [
    ["tt1111111:1:1", 1],
    ["tt2222222:1:1", 2],
  ]);
  assert.equal(second.matchedVideoId, "tt2222222:1:1");
  assert.equal(second.matchedSeasonNumber, 2);
});

test("disabling TVDB removes cached TVDB metadata and returns to the original per-title behavior", async () => {
  const result = await enrichTvdbMetadata({
    "101": {
      status: "watching",
      next_to_watch_info: { episode: 2, date: "2026-08-01T00:00:00Z" },
      anime: { title: "Example", ids: { simkl: 101, imdb: "tt1234567" } },
      _addonTvdbMeta: { provider: "tvdb", parentId: "tt1234567", videos: [{ id: "tt1234567:1:1" }] },
    },
  });
  assert.equal(result.usesTvdb, false);
  assert.equal(result.items["101"]._addonTvdbMeta, undefined);
});

test("fresh cached TVDB episodes still remap the user's current next episode", async () => {
  const now = new Date("2026-08-06T00:00:00Z");
  const signature = JSON.stringify({
    version: 2,
    seasonType: "default",
    language: "eng",
    tvdb: 900,
    imdb: "tt7654000",
  });
  const items = {
    "901": {
      status: "watching",
      next_to_watch_info: {
        season: 1,
        episode: 2,
        title: "Second",
        date: "2026-08-02T00:00:00Z",
      },
      show: {
        title: "Example Show",
        ids: { simkl: 901, tvdb: 900, imdb: "tt7654000" },
      },
      _addonTvdbMeta: {
        version: 2,
        signature,
        attemptedAt: "2026-08-05T00:00:00Z",
        provider: "tvdb",
        tvdbId: 900,
        imdbId: "tt7654000",
        parentId: "tt7654000",
        seasonType: "default",
        language: "eng",
        matchedSeasonNumber: 1,
        matchedEpisodeOffset: 0,
        matchedVideoId: "tt7654000:1:1",
        videos: [
          { id: "tt7654000:1:1", season: 1, episode: 1, title: "First", released: "2026-08-01" },
          { id: "tt7654000:1:2", season: 1, episode: 2, title: "Second", released: "2026-08-02" },
        ],
      },
    },
  };

  const result = await enrichTvdbMetadata(items, {
    apiKey: "test-key",
    now,
    fetchImpl: async () => {
      throw new Error("fresh metadata should not call TVDB");
    },
  });

  assert.equal(result.items["901"]._addonTvdbMeta.matchedVideoId, "tt7654000:1:2");
  assert.equal(result.items["901"]._addonTvdbMeta.matchedSeasonNumber, 1);
});
