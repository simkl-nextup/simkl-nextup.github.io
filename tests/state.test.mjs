import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyState,
  mergeAnimeDelta,
  pruneRemovedItems,
  replaceWithInitialWatching,
} from "../src/state.mjs";

const item = (id, status = "watching") => ({
  status,
  anime: { title: `Anime ${id}`, ids: { simkl: id } },
});

test("initial sync stores only Watching anime", () => {
  const state = replaceWithInitialWatching(createEmptyState(), {
    anime: [item(1), item(2, "completed")],
  });
  assert.deepEqual(Object.keys(state.items), ["1"]);
});

test("delta overwrites Watching items and removes moved items", () => {
  let state = replaceWithInitialWatching(createEmptyState(), { anime: [item(1), item(2)] });
  state = mergeAnimeDelta(state, { anime: [item(1, "completed"), item(3)] });
  assert.deepEqual(Object.keys(state.items).sort(), ["2", "3"]);
});

test("ID snapshot prunes items removed from the Simkl library", () => {
  let state = replaceWithInitialWatching(createEmptyState(), { anime: [item(1), item(2)] });
  state = pruneRemovedItems(state, { anime: [item(2)] });
  assert.deepEqual(Object.keys(state.items), ["2"]);
});

