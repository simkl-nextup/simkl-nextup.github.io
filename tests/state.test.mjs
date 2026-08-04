import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyState,
  mergeAnimeDelta,
  normalizeState,
  pruneRemovedItems,
  replaceWithInitialEligibleAnime,
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

test("an older cache triggers a clean version 6 bootstrap", () => {
  const state = normalizeState({
    version: 4,
    lastAnimeActivity: "2026-08-01T00:00:00Z",
    items: { "1": item(1) },
  });
  assert.equal(state.version, 6);
  assert.equal(state.lastAnimeActivity, null);
  assert.deepEqual(state.items, {});
});
