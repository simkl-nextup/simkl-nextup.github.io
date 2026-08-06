import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyState,
  effectiveStatus,
  mergeAnimeDelta,
  mergeItemsDelta,
  normalizeState,
  pruneRemovedItems,
  replaceWithInitialEligibleAnime,
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

// Simkl auto-promotes a title from Completed back to Watching the moment a
// new season is confirmed on TVDB/AniDB, before any episode is watched.
// effectiveStatus should keep reporting "completed" until watched progress
// actually moves, so the poster badge stays purple ("NEW SEASON") instead of
// flipping straight to green ("NEW EPISODE").
const withProgress = (base, watched, total) => ({
  ...base,
  watched_episodes_count: watched,
  total_episodes_count: total,
});

test("a title just revived by Simkl (not yet started) still reports completed", () => {
  let state = replaceWithInitialEligibleAnime(createEmptyState(), {
    anime: [withProgress(item(1, "completed"), 12, 12)],
  });
  // A new season lands: Simkl silently flips status to watching, but the
  // user hasn't watched anything from it yet.
  state = mergeAnimeDelta(state, {
    anime: [withProgress(item(1, "watching"), 12, 24)],
  });
  assert.equal(state.items["1"].status, "watching");
  assert.equal(effectiveStatus(state.items["1"]), "completed");
});

test("effectiveStatus reports watching once the user starts the revived season", () => {
  let state = replaceWithInitialEligibleAnime(createEmptyState(), {
    anime: [withProgress(item(1, "completed"), 12, 12)],
  });
  state = mergeAnimeDelta(state, {
    anime: [withProgress(item(1, "watching"), 12, 24)],
  });
  assert.equal(effectiveStatus(state.items["1"]), "completed");

  // They watch the season 4 premiere.
  state = mergeAnimeDelta(state, {
    anime: [withProgress(item(1, "watching"), 13, 24)],
  });
  assert.equal(effectiveStatus(state.items["1"]), "watching");
});

test("a title that was always watching is unaffected by revival tracking", () => {
  let state = replaceWithInitialEligibleAnime(createEmptyState(), {
    anime: [withProgress(item(1, "watching"), 3, 12)],
  });
  state = mergeAnimeDelta(state, {
    anime: [withProgress(item(1, "watching"), 4, 12)],
  });
  assert.equal(effectiveStatus(state.items["1"]), "watching");
});
