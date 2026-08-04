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
