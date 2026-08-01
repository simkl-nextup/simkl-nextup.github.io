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

test("catalog includes only aired, unwatched episodes from Watching", () => {
  const items = {
    "101": watching(),
    "102": watching({
      next_to_watch_info: { episode: 6, date: "2026-08-03T10:00:00Z" },
      anime: { title: "Future Anime", ids: { simkl: 102, imdb: "tt7654321" } },
    }),
    "103": watching({
      status: "completed",
      anime: { title: "Completed Anime", ids: { simkl: 103, imdb: "tt1111111" } },
    }),
  };
  const { catalog } = buildCatalog(items, { now: "2026-08-02T00:00:00Z" });
  assert.equal(catalog.metas.length, 1);
  assert.equal(catalog.metas[0].name, "Example Anime");
  assert.equal(catalog.metas[0].releaseInfo, "Ep. 5");
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

