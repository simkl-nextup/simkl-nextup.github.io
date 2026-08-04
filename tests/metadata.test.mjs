import test from "node:test";
import assert from "node:assert/strict";
import {
  applyAnimeTrackingVideoIds,
  createMdblistClient,
  createTmdbClient,
  enrichCatalogMetadata,
} from "../src/metadata.mjs";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const item = (ids) => ({
  status: "watching",
  next_to_watch_info: { episode: 2, date: "2026-08-01T00:00:00Z" },
  anime: { title: "Example Anime", ids: { simkl: 101, ...ids } },
});

test("TMDB resolves an IMDb ID and fetches full TV artwork", async () => {
  const calls = [];
  const client = createTmdbClient({
    accessToken: "tmdb-token",
    fetchImpl: async (input, options) => {
      const url = new URL(input);
      calls.push(url.pathname);
      assert.equal(options.headers.Authorization, "Bearer tmdb-token");
      if (url.pathname === "/3/find/tt1234567") return jsonResponse({ tv_results: [{ id: 321 }] });
      if (url.pathname === "/3/tv/321") {
        return jsonResponse({
          id: 321,
          poster_path: "/poster.jpg",
          backdrop_path: "/backdrop.jpg",
          external_ids: { imdb_id: "tt1234567", tvdb_id: 654 },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const result = await client.resolveSeries({ imdb: "tt1234567" });
  assert.equal(result.id, 321);
  assert.deepEqual(calls, ["/3/find/tt1234567", "/3/tv/321"]);
});

test("TMDB resolves theatrical anime through the movie endpoint", async () => {
  const client = createTmdbClient({
    accessToken: "tmdb-token",
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname === "/3/find/tt32820897") {
        return jsonResponse({ tv_results: [], movie_results: [{ id: 1311031 }] });
      }
      if (url.pathname === "/3/movie/1311031") {
        return jsonResponse({ id: 1311031, poster_path: "/castle.jpg", external_ids: { imdb_id: "tt32820897" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  const result = await client.resolveSeries({ imdb: "tt32820897" });
  assert.equal(result.id, 1311031);
  assert.equal(result._addonTmdbMediaType, "movie");
});

test("MDBList resolves a MAL-only item without exposing its key in returned state", async () => {
  const client = createMdblistClient({
    apiKey: "mdb-secret",
    fetchImpl: async (input) => {
      const url = new URL(input);
      assert.equal(url.pathname, "/mal/show/5114/");
      assert.equal(url.searchParams.get("apikey"), "mdb-secret");
      return jsonResponse({ imdb_id: "tt1355642", tmdb_id: 31911 });
    },
  });
  const result = await client.resolveSeries({ mal: 5114 });
  assert.equal(result.tmdb_id, 31911);
  assert.doesNotMatch(JSON.stringify(result), /mdb-secret/);
});

test("metadata enrichment stores clean TMDB artwork and external IDs", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/3/find/tt1234567") return jsonResponse({ tv_results: [{ id: 321 }] });
    if (url.pathname === "/3/tv/321") {
      return jsonResponse({
        id: 321,
        poster_path: "/poster.jpg",
        backdrop_path: "/backdrop.jpg",
        external_ids: { imdb_id: "tt1234567", tvdb_id: 654 },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await enrichCatalogMetadata(
    { "101": item({ imdb: "tt1234567" }) },
    {
      tmdbAccessToken: "tmdb-token",
      fetchImpl,
      now: new Date("2026-08-02T00:00:00Z"),
    },
  );
  const enriched = result.items["101"];
  assert.equal(enriched.anime.ids.tmdb, 321);
  assert.equal(enriched.anime.ids.tvdb, 654);
  assert.equal(enriched._addonVisuals.poster, "https://image.tmdb.org/t/p/w500/poster.jpg");
  assert.equal(enriched._addonVisuals.background, "https://image.tmdb.org/t/p/w1280/backdrop.jpg");
  assert.equal(result.usesTmdb, true);
});

test("MDBList can bridge a MAL ID into TMDB enrichment", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.hostname === "api.mdblist.com") {
      assert.equal(url.pathname, "/mal/show/5114/");
      return jsonResponse({ tmdb_id: 31911, imdb_id: "tt1355642" });
    }
    if (url.pathname === "/3/find/tt1355642") {
      return jsonResponse({ tv_results: [{ id: 31911 }], movie_results: [] });
    }
    if (url.pathname === "/3/tv/31911") {
      return jsonResponse({ id: 31911, poster_path: "/fma.jpg", external_ids: { imdb_id: "tt1355642" } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await enrichCatalogMetadata(
    { "101": item({ mal: 5114 }) },
    {
      tmdbAccessToken: "tmdb-token",
      mdblistApiKey: "mdb-secret",
      fetchImpl,
      now: new Date("2026-08-02T00:00:00Z"),
    },
  );
  assert.equal(result.items["101"].anime.ids.tmdb, 31911);
  assert.equal(result.items["101"]._addonVisuals.poster, "https://image.tmdb.org/t/p/w500/fma.jpg");
});

test("TMDB enrichment builds every season under one synthetic parent with Simkl-aware episode IDs", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/3/find/tt7654002") {
      return jsonResponse({
        tv_results: [],
        tv_season_results: [{ show_id: 900, season_number: 2 }],
        tv_episode_results: [],
        movie_results: [],
      });
    }
    if (url.pathname === "/3/tv/900") {
      return jsonResponse({
        id: 900,
        name: "Unified Anime",
        overview: "All cours and seasons live here.",
        first_air_date: "2024-01-01",
        last_air_date: "2026-07-01",
        status: "Returning Series",
        poster_path: "/unified.jpg",
        backdrop_path: "/unified-bg.jpg",
        episode_run_time: [24],
        genres: [{ name: "Animation" }],
        seasons: [
          { season_number: 0, episode_count: 1 },
          { season_number: 1, episode_count: 2 },
          { season_number: 2, episode_count: 1 },
        ],
        external_ids: { imdb_id: "tt7654000", tvdb_id: 12345 },
      });
    }
    if (url.pathname === "/3/tv/900/season/0") {
      return jsonResponse({ season_number: 0, episodes: [{ season_number: 0, episode_number: 1, name: "Special", air_date: "2024-01-02" }] });
    }
    if (url.pathname === "/3/tv/900/season/1") {
      return jsonResponse({
        season_number: 1,
        episodes: [
          { season_number: 1, episode_number: 1, name: "Start", air_date: "2024-01-01", still_path: "/s1e1.jpg" },
          { season_number: 1, episode_number: 2, name: "Continue", air_date: "2024-01-08" },
        ],
      });
    }
    if (url.pathname === "/3/tv/900/season/2") {
      return jsonResponse({ season_number: 2, episodes: [{ season_number: 2, episode_number: 1, name: "Return", air_date: "2026-07-01" }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await enrichCatalogMetadata(
    { "101": item({ imdb: "tt7654002", mal: 222 }) },
    {
      tmdbAccessToken: "tmdb-token",
      fetchImpl,
      now: new Date("2026-08-05T00:00:00Z"),
    },
  );

  const series = result.items["101"]._addonSeriesMeta;
  assert.equal(series.parentId, "simkl-unified:900");
  assert.equal(series.videoIdBase, "tt7654000");
  assert.equal(series.matchedSeasonNumber, 2);
  assert.equal(series.seasonCount, 2);
  assert.equal(series.specialSeasonIncluded, true);
  assert.equal(series.episodeCount, 4);
  assert.deepEqual(series.videos.map((video) => video.id), [
    "tt7654000:0:1",
    "tt7654000:1:1",
    "tt7654000:1:2",
    "mal:222:1",
  ]);
  assert.equal(series.animeTrackingIdBase, "mal:222");
  assert.equal(series.trackingMappedEpisodeCount, 1);
  assert.equal(series.videos[1].thumbnail, "https://image.tmdb.org/t/p/original/s1e1.jpg");
  assert.equal(series.videos[1].runtime, "24m");
  assert.equal(series.videos[1].available, true);
});

test("completed sibling entries contribute their seasonal MAL IDs to one unified page", async () => {
  const seasonCalls = [];
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/3/find/tt7654001") {
      return jsonResponse({ tv_season_results: [{ show_id: 900, season_number: 1 }] });
    }
    if (url.pathname === "/3/find/tt7654002") {
      return jsonResponse({ tv_season_results: [{ show_id: 900, season_number: 2 }] });
    }
    if (url.pathname === "/3/tv/900") {
      return jsonResponse({
        id: 900,
        name: "Unified Anime",
        backdrop_path: "/fallback.jpg",
        episode_run_time: [24],
        seasons: [
          { season_number: 1, episode_count: 2 },
          { season_number: 2, episode_count: 2 },
        ],
        external_ids: { imdb_id: "tt7654000" },
      });
    }
    if (url.pathname === "/3/tv/900/season/1") {
      seasonCalls.push(url.pathname);
      return jsonResponse({
        season_number: 1,
        episodes: [
          { season_number: 1, episode_number: 1, air_date: "2024-01-01" },
          { season_number: 1, episode_number: 2, air_date: "2024-01-08" },
        ],
      });
    }
    if (url.pathname === "/3/tv/900/season/2") {
      seasonCalls.push(url.pathname);
      return jsonResponse({
        season_number: 2,
        episodes: [
          { season_number: 2, episode_number: 1, air_date: "2026-07-01" },
          { season_number: 2, episode_number: 2, air_date: "2026-07-08" },
        ],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await enrichCatalogMetadata(
    {
      "101": {
        ...item({ imdb: "tt7654001", mal: 111 }),
        status: "completed",
        watched_episodes_count: 2,
        total_episodes_count: 2,
      },
      "102": {
        ...item({ imdb: "tt7654002", mal: 222 }),
        total_episodes_count: 2,
      },
    },
    {
      tmdbAccessToken: "tmdb-token",
      fetchImpl,
      now: new Date("2026-08-05T00:00:00Z"),
      itemFilter: () => true,
    },
  );

  const videos = result.items["102"]._addonSeriesMeta.videos;
  assert.deepEqual(videos.map((video) => video.id), [
    "mal:111:1",
    "mal:111:2",
    "mal:222:1",
    "mal:222:2",
  ]);
  assert.deepEqual(seasonCalls, ["/3/tv/900/season/1", "/3/tv/900/season/2"]);
});

test("split cours keep local MAL episode numbers while preserving TMDB season placement", () => {
  const videos = Array.from({ length: 24 }, (_, index) => ({
    id: `tt9000000:2:${index + 1}`,
    title: `Episode ${index + 1}`,
    released: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    season: 2,
    episode: index + 1,
  }));
  const baseMeta = {
    parentId: "simkl-unified:900",
    tmdbId: 900,
    matchedSeasonNumber: 2,
    seasonCount: 2,
    episodeCount: 24,
    videos,
  };
  const result = applyAnimeTrackingVideoIds({
    "201": {
      status: "completed",
      total_episodes_count: 12,
      _addonLatestAiredInfo: { episode: 1, date: "2026-01-01T00:00:00.000Z" },
      anime: { title: "Cour 1", ids: { simkl: 201, mal: 301 } },
      _addonSeriesMeta: baseMeta,
    },
    "202": {
      status: "watching",
      total_episodes_count: 12,
      next_to_watch_info: { episode: 1, date: "2026-01-13T00:00:00.000Z" },
      anime: { title: "Cour 2", ids: { simkl: 202, mal: 302 } },
      _addonSeriesMeta: baseMeta,
    },
  });

  const series = result["202"]._addonSeriesMeta;
  assert.equal(series.matchedEpisodeOffset, 12);
  assert.equal(series.videos[0].id, "mal:301:1");
  assert.equal(series.videos[11].id, "mal:301:12");
  assert.equal(series.videos[12].id, "mal:302:1");
  assert.equal(series.videos[23].id, "mal:302:12");
});
