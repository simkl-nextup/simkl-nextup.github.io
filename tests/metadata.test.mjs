import test from "node:test";
import assert from "node:assert/strict";
import {
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


test("metadata enrichment prefers a textless TMDB poster and English title logo", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/3/find/tt1234567") return jsonResponse({ tv_results: [{ id: 321 }] });
    if (url.pathname === "/3/tv/321") {
      assert.equal(url.searchParams.get("append_to_response"), "external_ids,images");
      assert.equal(url.searchParams.get("include_image_language"), "en,null");
      return jsonResponse({
        id: 321,
        poster_path: "/default-poster.jpg",
        backdrop_path: "/backdrop.jpg",
        original_language: "ja",
        external_ids: { imdb_id: "tt1234567", tvdb_id: 654 },
        images: {
          posters: [
            { file_path: "/english-poster.jpg", iso_639_1: "en", vote_count: 50, vote_average: 9 },
            { file_path: "/textless-poster.jpg", iso_639_1: null, vote_count: 2, vote_average: 8 },
          ],
          logos: [
            { file_path: "/japanese-logo.png", iso_639_1: "ja", vote_count: 100, vote_average: 10 },
            { file_path: "/english-logo.png", iso_639_1: "en", vote_count: 1, vote_average: 7 },
          ],
        },
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
  const visuals = result.items["101"]._addonVisuals;
  assert.equal(visuals.poster, "https://image.tmdb.org/t/p/w500/textless-poster.jpg");
  assert.equal(visuals.logo, "https://image.tmdb.org/t/p/w500/english-logo.png");
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
