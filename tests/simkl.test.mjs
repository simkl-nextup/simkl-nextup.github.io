import test from "node:test";
import assert from "node:assert/strict";
import { createSimklClient } from "../src/simkl.mjs";

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("monthly anime calendar uses Simkl's unversioned, unpadded archive URL", async () => {
  let requestedUrl;
  const client = createSimklClient({
    clientId: "client",
    accessToken: "token",
    fetchImpl: async (input) => {
      requestedUrl = new URL(input);
      return jsonResponse([]);
    },
  });

  await client.getAnimeCalendarMonth(2026, 8);

  assert.equal(requestedUrl.origin, "https://data.simkl.in");
  assert.equal(requestedUrl.pathname, "/calendar/2026/8/anime.json");
  assert.equal(requestedUrl.searchParams.get("client_id"), "client");
});

test("rolling anime calendar keeps using Simkl's v2 payload", async () => {
  let requestedUrl;
  const client = createSimklClient({
    clientId: "client",
    accessToken: "token",
    fetchImpl: async (input) => {
      requestedUrl = new URL(input);
      return jsonResponse({ calendar: [], metadata: {} });
    },
  });

  await client.getAnimeCalendar();

  assert.equal(requestedUrl.pathname, "/calendar/v2/anime.json");
});

test("TV client reads Simkl shows, show details, and the TV calendar", async () => {
  const requested = [];
  const client = createSimklClient({
    clientId: "tv-client",
    accessToken: "tv-token",
    mediaType: "tv",
    fetchImpl: async (input) => {
      const url = new URL(input);
      requested.push(url);
      if (url.pathname === "/sync/all-items/shows") return jsonResponse({ shows: [] });
      if (url.pathname === "/tv/123") return jsonResponse({ title: "Example Show", ids: { simkl: 123 } });
      if (url.pathname === "/calendar/v2/tv-shows.json") return jsonResponse([]);
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  await client.getInitialLibrary();
  await client.getDetails(123);
  await client.getCalendar();

  assert.deepEqual(requested.map((url) => url.pathname), [
    "/sync/all-items/shows",
    "/tv/123",
    "/calendar/v2/tv-shows.json",
  ]);
  assert.equal(client.activityKey, "tv_shows");
  assert.equal(client.payloadKey, "shows");
});
