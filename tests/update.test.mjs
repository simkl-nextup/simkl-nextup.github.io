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
