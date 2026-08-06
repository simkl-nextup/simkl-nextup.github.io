import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyState,
  mergeAnimeDelta,
  mergeItemsDelta,
  normalizeState,
  pruneRemovedItems,
  replaceWithInitialEligibleAnime,
  replaceWithCurrentEligibleItems,
  replaceWithInitialEligibleItems,
} from "../src/state.mjs";

const item = (id, status = "watching") => ({
  status,
  anime: { title: `Anime ${id}`, ids: { simkl: id } },
});

test("initial sync stores Watching, Plan to Watch, and Completed anime", () => {
  const state = replaceWithInitialEligibleAnime(createEmptyState(), {
    anime: [item(1), item(2, "plantowatch"), item(3, "completed"), item(4, "dropped")],
  });
  assert.deepEqual(Object.keys(state.items), ["1", "2", "3"]);
});

test("delta keeps all eligible statuses and removes dropped items", () => {
  let state = replaceWithInitialEligibleAnime(createEmptyState(), { anime: [item(1), item(2)] });
  state = mergeAnimeDelta(state, {
    anime: [item(1, "completed"), item(2, "dropped"), item(3)],
  });
  assert.deepEqual(Object.keys(state.items).sort(), ["1", "3"]);
  assert.equal(state.items["1"].status, "completed");
});

test("ID snapshot prunes items removed from the Simkl library", () => {
  let state = replaceWithInitialEligibleAnime(createEmptyState(), { anime: [item(1), item(2)] });
  state = pruneRemovedItems(state, { anime: [item(2)] });
  assert.deepEqual(Object.keys(state.items), ["2"]);
});

test("an older cache triggers a clean version 7 bootstrap", () => {
  const state = normalizeState({
    version: 4,
    lastAnimeActivity: "2026-08-01T00:00:00Z",
    items: { "1": item(1) },
  });
  assert.equal(state.version, 7);
  assert.equal(state.lastAnimeActivity, null);
  assert.deepEqual(state.items, {});
});

const showItem = (id, status = "watching") => ({
  status,
  show: { title: `Show ${id}`, ids: { simkl: id } },
});

test("TV sync stores shows and ignores the anime payload", () => {
  let state = replaceWithInitialEligibleItems(createEmptyState("tv"), {
    shows: [showItem(11), showItem(12, "plantowatch"), showItem(13, "completed")],
    anime: [item(99)],
  }, "tv");
  state = mergeItemsDelta(state, { shows: [showItem(11, "completed"), showItem(12, "dropped")] }, "tv");
  assert.deepEqual(Object.keys(state.items).sort(), ["11", "13"]);
  assert.equal(state.mediaType, "tv");
  assert.equal(state.items["11"].show.title, "Show 11");
});

test("switching an old anime-only account cache to TV forces a clean bootstrap", () => {
  const state = normalizeState({
    version: 7,
    lastAnimeActivity: "2026-08-01T00:00:00Z",
    items: { "1": item(1) },
  }, "tv");
  assert.equal(state.mediaType, "tv");
  assert.equal(state.lastActivity, null);
  assert.deepEqual(state.items, {});
});


test("full TV progress refresh updates next episode while preserving cached enrichment", () => {
  const state = {
    ...createEmptyState("tv"),
    lastActivity: "2026-08-01T00:00:00Z",
    items: {
      "11": {
        ...showItem(11),
        watched_episodes_count: 9,
        next_to_watch_info: { season: 1, episode: 10 },
        _addonLatestAiredInfo: { season: 2, episode: 2, date: "2026-08-05T00:00:00Z" },
        _addonVisuals: { poster: "https://image.tmdb.org/poster.jpg" },
        show: { title: "Show 11", ids: { simkl: 11, tvdb: 123 } },
      },
    },
  };

  const refreshed = replaceWithCurrentEligibleItems(state, {
    shows: [{
      ...showItem(11),
      watched_episodes_count: 10,
      next_to_watch_info: { season: 2, episode: 1 },
      show: { title: "Show 11", ids: { simkl: 11, imdb: "tt0011" } },
    }],
  }, "tv");

  assert.equal(refreshed.items["11"].next_to_watch_info.season, 2);
  assert.equal(refreshed.items["11"].next_to_watch_info.episode, 1);
  assert.equal(refreshed.items["11"]._addonLatestAiredInfo.episode, 2);
  assert.equal(refreshed.items["11"]._addonVisuals.poster, "https://image.tmdb.org/poster.jpg");
  assert.deepEqual(refreshed.items["11"].show.ids, { simkl: 11, tvdb: 123, imdb: "tt0011" });
});
