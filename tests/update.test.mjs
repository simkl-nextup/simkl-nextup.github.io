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

test("end-to-end refresh builds the row and removes a completed anime on the next delta", async () => {
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
    if (url.pathname === "/sync/all-items/anime/watching") {
      assert.equal(options.headers.Authorization, "Bearer token");
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
    if (url.pathname === "/sync/all-items/anime") {
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
  });
  catalog = JSON.parse(
    await readFile(path.join(outputDirectory, "catalog", "series", `${CATALOG_ID}.json`), "utf8"),
  );
  assert.equal(catalog.metas.length, 0);
});
