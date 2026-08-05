import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { refresh } from "../scripts/update.mjs";
import { CATALOG_ID } from "../src/constants.mjs";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("end-to-end refresh builds the row and hides a caught-up completed anime on the next delta", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "simkl-addon-"));
  const stateFile = path.join(temp, "state.json");
  const outputDirectory = path.join(temp, "public");
  let phase = 1;

  const animeItem = {
    status: "watching",
    next_to_watch_info: { episode: 5, title: "Episode 5", date: "2026-08-01T10:00:00Z" },
    anime: {
      title: "Mock Anime",
      poster: "12/mock",
      ids: { simkl: 101, imdb: "tt1234567" },
    },
  };

  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    assert.equal(url.searchParams.get("client_id"), "client");
    if (url.hostname === "data.simkl.in") return jsonResponse({ calendar: [], metadata: {} });
    if (url.pathname === "/sync/all-items/anime" && !url.searchParams.has("date_from")) {
      assert.equal(options.headers.Authorization, "Bearer token");
      assert.equal(url.searchParams.get("next_watch_info"), "yes");
      return jsonResponse({ anime: [animeItem] });
    }
    if (url.pathname === "/sync/activities") {
      return jsonResponse({
        anime: {
          all: phase === 1 ? "2026-08-01T11:00:00Z" : "2026-08-02T11:00:00Z",
          removed_from_list: null,
        },
      });
    }
    if (url.pathname === "/sync/all-items/anime" && url.searchParams.has("date_from")) {
      assert.equal(url.searchParams.get("date_from"), "2026-08-01T11:00:00Z");
      return jsonResponse({ anime: [{ ...animeItem, status: "completed" }] });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  await refresh({
    clientId: "client",
    accessToken: "token",
    fetchImpl,
    now: new Date("2026-08-02T00:00:00Z"),
    stateFile,
    outputDirectory,
    posterBadgesEnabled: false,
  });
  let catalog = JSON.parse(
    await readFile(path.join(outputDirectory, "catalog", "series", `${CATALOG_ID}.json`), "utf8"),
  );
  assert.equal(catalog.metas.length, 1);

  phase = 2;
  await refresh({
    clientId: "client",
    accessToken: "token",
    fetchImpl,
    now: new Date("2026-08-02T12:00:00Z"),
    stateFile,
    outputDirectory,
    posterBadgesEnabled: false,
  });
  catalog = JSON.parse(
    await readFile(path.join(outputDirectory, "catalog", "series", `${CATALOG_ID}.json`), "utf8"),
  );
  assert.equal(catalog.metas.length, 0);
});

test("end-to-end refresh publishes Watching, monthly Plan to Watch, and revived Completed anime", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "simkl-addon-monthly-"));
  const stateFile = path.join(temp, "state.json");
  const outputDirectory = path.join(temp, "public");
  const library = [
    {
      status: "watching",
      watched_episodes_count: 4,
      next_to_watch_info: { episode: 5, title: "Catch-up", date: "2026-07-01T10:00:00Z" },
      anime: { title: "Watching Anime", ids: { simkl: 101, imdb: "tt1111111" } },
    },
    {
      status: "plantowatch",
      watched_episodes_count: 0,
      anime: { title: "Planned Anime", ids: { simkl: 201, imdb: "tt2222222" } },
    },
    {
      status: "completed",
      watched_episodes_count: 12,
      anime: { title: "Revived Anime", ids: { simkl: 301, imdb: "tt3333333" } },
    },
  ];

  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/sync/all-items/anime") return jsonResponse({ anime: library });
    if (url.pathname === "/sync/activities") {
      return jsonResponse({ anime: { all: "2026-08-04T10:00:00Z", removed_from_list: null } });
    }
    if (url.pathname === "/calendar/v2/anime.json") {
      return jsonResponse({ calendar: [], metadata: {} });
    }
    if (url.pathname === "/calendar/2026/8/anime.json") {
      return jsonResponse([
        {
          title: "Watching Anime",
          date: "2026-08-01T10:00:00Z",
          ids: { simkl_id: 101 },
          episode: { episode: 10 },
        },
        {
          title: "Planned Anime",
          date: "2026-08-03T10:00:00Z",
          ids: { simkl_id: 201 },
          episode: { episode: 2 },
        },
        {
          title: "Revived Anime",
          date: "2026-08-02T10:00:00Z",
          ids: { simkl_id: 301 },
          episode: { episode: 13 },
        },
      ]);
    }
    if (url.pathname === "/calendar/2026/7/anime.json") return jsonResponse([]);
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await refresh({
    clientId: "client",
    accessToken: "token",
    fetchImpl,
    now: new Date("2026-08-04T12:00:00Z"),
    stateFile,
    outputDirectory,
    posterBadgesEnabled: false,
  });

  assert.deepEqual(result.catalog.metas.map((meta) => meta.name), [
    "Planned Anime",
    "Revived Anime",
    "Watching Anime",
  ]);
  assert.match(result.catalog.metas[0].description, /From your Plan to Watch list/);
  assert.match(result.catalog.metas[1].description, /Previously completed/);
  assert.match(result.catalog.metas[2].description, /Latest release: Ep\. 10/);

  const status = JSON.parse(await readFile(path.join(outputDirectory, "status.json"), "utf8"));
  assert.equal(status.publishedWatchingItems, 1);
  assert.equal(status.publishedPlanToWatchItems, 1);
  assert.equal(status.publishedCompletedItems, 1);
  assert.equal(status.trackedCompletedItems, 1);
});

test("end-to-end TVDB refresh publishes all seasons with canonical episode IDs and the current default", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "simkl-addon-tvdb-"));
  const stateFile = path.join(temp, "state.json");
  const outputDirectory = path.join(temp, "public");
  const tvdbApiKey = "test-tvdb-key-not-a-real-secret";
  let tvdbSeriesCalls = 0;
  let tvdbEpisodeCalls = 0;

  const library = [
    {
      status: "completed",
      watched_episodes_count: 12,
      anime: {
        title: "Unified Anime",
        year: 2021,
        ids: { simkl: 7001, tvdb: 900, imdb: "tt7654000" },
      },
    },
    {
      status: "watching",
      watched_episodes_count: 2,
      next_to_watch_info: {
        episode: 3,
        title: "Season Two, Episode Three",
        date: "2026-07-15T10:00:00Z",
      },
      anime: {
        title: "Unified Anime Season 2",
        year: 2026,
        ids: { simkl: 7002, tvdb: 900, imdb: "tt7654000" },
      },
    },
  ];

  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    if (url.hostname === "api4.thetvdb.com") {
      if (url.pathname === "/v4/login") {
        assert.deepEqual(JSON.parse(options.body), { apikey: tvdbApiKey });
        return jsonResponse({ data: { token: "tvdb-bearer" } });
      }
      assert.equal(options.headers.Authorization, "Bearer tvdb-bearer");
      if (url.pathname === "/v4/series/900/extended") {
        tvdbSeriesCalls += 1;
        return jsonResponse({
          data: {
            id: 900,
            name: "Unified Anime",
            overview: "The complete TVDB series overview.",
            image: "/banners/series/900-poster.jpg",
            firstAired: "2021-01-01",
            remoteIds: [{ sourceName: "IMDB", id: "tt7654000" }],
            artworks: [
              { typeName: "Background", image: "/banners/series/900-background.jpg", width: 1920, height: 1080 },
            ],
          },
        });
      }
      if (url.pathname === "/v4/series/900/episodes/default/eng") {
        tvdbEpisodeCalls += 1;
        assert.equal(url.searchParams.get("page"), "0");
        return jsonResponse({
          data: {
            episodes: [
              { id: 101, seasonNumber: 1, number: 1, name: "Beginning", aired: "2021-01-01", image: "/banners/episodes/101.jpg" },
              { id: 201, seasonNumber: 2, number: 1, name: "Season Two, Episode One", aired: "2026-07-01", image: "/banners/episodes/201.jpg" },
              { id: 202, seasonNumber: 2, number: 2, name: "Season Two, Episode Two", aired: "2026-07-08", image: "/banners/episodes/202.jpg" },
              { id: 203, seasonNumber: 2, number: 3, name: "Season Two, Episode Three", aired: "2026-07-15", image: "/banners/episodes/203.jpg" },
            ],
          },
          links: { next: null },
        });
      }
      if (url.pathname === "/v4/series/900/translations/eng") {
        return jsonResponse({ data: { name: "Unified Anime", overview: "The complete English overview." } });
      }
      throw new Error(`Unexpected TVDB request: ${url}`);
    }

    if (url.pathname === "/sync/all-items/anime") return jsonResponse({ anime: library });
    if (url.pathname === "/sync/activities") {
      return jsonResponse({ anime: { all: "2026-08-05T00:00:00Z", removed_from_list: null } });
    }
    if (url.pathname === "/calendar/v2/anime.json") return jsonResponse({ calendar: [], metadata: {} });
    if (url.pathname === "/calendar/2026/8/anime.json") return jsonResponse([]);
    if (url.pathname === "/calendar/2026/7/anime.json") return jsonResponse([]);
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await refresh({
    clientId: "client",
    accessToken: "token",
    tvdbApiKey,
    fetchImpl,
    now: new Date("2026-08-05T01:00:00Z"),
    stateFile,
    outputDirectory,
    posterBadgesEnabled: false,
  });

  assert.equal(tvdbSeriesCalls, 1);
  assert.equal(tvdbEpisodeCalls, 1);
  assert.equal(result.catalog.metas.length, 1);
  assert.equal(result.catalog.metas[0].id, "tt7654000");
  assert.equal(result.catalog.metas[0].name, "Unified Anime");

  const metaResponse = JSON.parse(await readFile(path.join(outputDirectory, "meta", "series", "tt7654000.json"), "utf8"));
  assert.deepEqual(metaResponse.meta.videos.map((video) => video.id), [
    "tt7654000:1:1",
    "tt7654000:2:1",
    "tt7654000:2:2",
    "tt7654000:2:3",
  ]);
  assert.equal(metaResponse.meta.behaviorHints.defaultVideoId, "tt7654000:2:3");
  assert.equal(metaResponse.meta.videos[3].thumbnail, "https://artworks.thetvdb.com/banners/episodes/203.jpg");

  const status = JSON.parse(await readFile(path.join(outputDirectory, "status.json"), "utf8"));
  assert.equal(status.tvdbMetadataEnabled, true);
  assert.equal(status.tvdbUnifiedTitles, 1);
  assert.equal(status.tvdbUnifiedSeasons, 2);
  assert.equal(status.tvdbUnifiedEpisodes, 4);
  assert.equal(status.tvdbCanonicalTrackingEpisodes, 4);

  const published = await readFile(path.join(outputDirectory, "meta", "series", "tt7654000.json"), "utf8");
  assert.equal(published.includes(tvdbApiKey), false);
});

test("end-to-end TVDB refresh groups separate sequel records and keeps their tracking IDs", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "simkl-addon-tvdb-split-series-"));
  const stateFile = path.join(temp, "state.json");
  const outputDirectory = path.join(temp, "public");
  const library = [
    {
      status: "completed",
      watched_episodes_count: 1,
      anime: {
        title: "Example Anime: First Arc",
        year: 2024,
        ids: { simkl: 8101, tvdb: 901, imdb: "tt1111111" },
      },
    },
    {
      status: "watching",
      watched_episodes_count: 0,
      next_to_watch_info: {
        episode: 1,
        title: "The Return",
        date: "2026-07-01T10:00:00Z",
      },
      anime: {
        title: "Example Anime Season 2: The Return",
        year: 2026,
        ids: { simkl: 8102, tvdb: 902, imdb: "tt2222222" },
      },
    },
  ];

  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    if (url.hostname === "api4.thetvdb.com") {
      if (url.pathname === "/v4/login") return jsonResponse({ data: { token: "tvdb-token" } });
      assert.equal(options.headers.Authorization, "Bearer tvdb-token");
      const seriesMatch = url.pathname.match(/^\/v4\/series\/(901|902)\/extended$/);
      if (seriesMatch) {
        const id = Number(seriesMatch[1]);
        return jsonResponse({
          data: {
            id,
            name: id === 901 ? "Japanese first title" : "Japanese sequel title",
            firstAired: id === 901 ? "2024-01-01" : "2026-07-01",
            remoteIds: [{ sourceName: "IMDB", id: id === 901 ? "tt1111111" : "tt2222222" }],
          },
        });
      }
      const translationMatch = url.pathname.match(/^\/v4\/series\/(901|902)\/translations\/eng$/);
      if (translationMatch) {
        return jsonResponse({ data: { name: translationMatch[1] === "901" ? "Example Anime" : "Example Anime Season 2" } });
      }
      const episodesMatch = url.pathname.match(/^\/v4\/series\/(901|902)\/episodes\/default\/eng$/);
      if (episodesMatch) {
        const id = Number(episodesMatch[1]);
        return jsonResponse({
          data: {
            episodes: [{
              id: id * 10 + 1,
              seasonNumber: 1,
              number: 1,
              name: id === 901 ? "Beginning" : "The Return",
              aired: id === 901 ? "2024-01-01" : "2026-07-01",
            }],
          },
          links: { next: null },
        });
      }
      throw new Error(`Unexpected TVDB request: ${url}`);
    }

    if (url.pathname === "/sync/all-items/anime") return jsonResponse({ anime: library });
    if (url.pathname === "/sync/activities") {
      return jsonResponse({ anime: { all: "2026-08-05T00:00:00Z", removed_from_list: null } });
    }
    if (url.pathname === "/calendar/v2/anime.json") return jsonResponse({ calendar: [], metadata: {} });
    if (url.pathname === "/calendar/2026/8/anime.json") return jsonResponse([]);
    if (url.pathname === "/calendar/2026/7/anime.json") return jsonResponse([]);
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await refresh({
    clientId: "client",
    accessToken: "token",
    tvdbApiKey: "test-key",
    fetchImpl,
    now: new Date("2026-08-05T01:00:00Z"),
    stateFile,
    outputDirectory,
    posterBadgesEnabled: false,
  });

  assert.equal(result.catalog.metas.length, 1);
  assert.equal(result.catalog.metas[0].id, "simkl-tvdb-unified:901-902");
  assert.equal(result.catalog.metas[0].name, "Example Anime");

  const metaResponse = JSON.parse(await readFile(
    path.join(outputDirectory, "meta", "series", "simkl-tvdb-unified:901-902.json"),
    "utf8",
  ));
  assert.deepEqual(metaResponse.meta.videos.map((video) => [video.id, video.season]), [
    ["tt1111111:1:1", 1],
    ["tt2222222:1:1", 2],
  ]);
  assert.equal(metaResponse.meta.behaviorHints.defaultVideoId, "tt2222222:1:1");
  const status = JSON.parse(await readFile(path.join(outputDirectory, "status.json"), "utf8"));
  assert.equal(status.tvdbUnifiedTitles, 1);
  assert.equal(status.tvdbUnifiedSeasons, 2);
  assert.equal(status.tvdbCanonicalTrackingEpisodes, 2);
});
