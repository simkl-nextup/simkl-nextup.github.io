import test from "node:test";
import assert from "node:assert/strict";
import { enrichDubInfo, isoWeek, recordTimetable, resolveDub, websiteId } from "../src/animeschedule.mjs";
import { enrichMalScores } from "../src/mal-score.mjs";

const NOW = new Date("2026-10-10T12:00:00Z");

test("isoWeek matches ISO-8601 week numbering", () => {
  assert.deepEqual(isoWeek(new Date("2026-10-10")), { year: 2026, week: 41 });
  assert.deepEqual(isoWeek(new Date("2026-01-01")), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek(new Date("2027-01-03")), { year: 2026, week: 53 });
});

test("websiteId reads IDs from MAL, AniList and AniDB links, ignoring numbers in titles", () => {
  assert.equal(websiteId({ websites: { mal: "myanimelist.net/anime/5114/Title_2" } }, "mal"), 5114);
  assert.equal(websiteId({ websites: { aniList: "https://anilist.co/anime/21/" } }, "aniList"), 21);
  assert.equal(websiteId({ websites: { anidb: "anidb.net/a12345" } }, "anidb"), 12345);
  assert.equal(websiteId({ websites: { anidb: "https://anidb.net/perl-bin/animedb.pl?show=anime&aid=777" } }, "anidb"), 777);
  assert.equal(websiteId({ websites: {} }, "mal"), null);
});

test("recordTimetable keeps the highest aired dub episode per show and skips unaired/delayed", () => {
  const ledger = recordTimetable({}, [
    { route: "a", airType: "dub", episodeNumber: 3, episodeDate: "2026-10-01T00:00:00Z", airingStatus: "aired" },
    { route: "a", airType: "dub", episodeNumber: 4, episodeDate: "2026-10-08T00:00:00Z", airingStatus: "aired" },
    { route: "a", airType: "dub", episodeNumber: 5, episodeDate: "2026-10-15T00:00:00Z", airingStatus: "unaired" },
    { route: "b", airType: "dub", episodeNumber: 2, episodeDate: "2026-10-09T00:00:00Z", airingStatus: "delayed-air" },
    { route: "c", airType: "sub", episodeNumber: 9, episodeDate: "2026-10-09T00:00:00Z", airingStatus: "aired" },
  ], NOW);
  assert.deepEqual(Object.keys(ledger), ["a"]);
  assert.equal(ledger.a.episode, 4);
});

test("resolveDub: no dubPremier means no dub; ledger gives exact episode; old finished dubs are 'full'", () => {
  const base = { route: "show", status: "Finished", episodes: 12 };
  assert.equal(resolveDub({ ...base, dubPremier: null }, null, NOW), null);
  assert.equal(resolveDub({ ...base, dubPremier: "2027-01-01T00:00:00Z" }, null, NOW), null);
  assert.deepEqual(resolveDub({ ...base, status: "Ongoing", episodes: 24, dubPremier: "2026-08-01T00:00:00Z" }, { episode: 9 }, NOW),
    { route: "show", episode: 9, full: false, estimated: false });
  assert.equal(resolveDub({ ...base, dubPremier: "2026-08-01T00:00:00Z" }, { episode: 12 }, NOW).full, true);
  // Finished long before the ledger window → fully dubbed.
  assert.equal(resolveDub({ ...base, dubPremier: "2024-01-01T00:00:00Z" }, null, NOW).full, true);
  // Finished recently but not in the ledger → no guess.
  assert.equal(resolveDub({ ...base, dubPremier: "2026-09-20T00:00:00Z" }, null, NOW), null);
  // Batch release covering the whole season.
  assert.equal(resolveDub({ ...base, dubPremier: "2026-09-20T00:00:00Z", dubOverride: { date: "2026-09-27T00:00:00Z", episode: 7, extra: 5 } }, null, NOW).full, true);
});

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body };
}

test("enrichDubInfo matches by MAL ID, backfills once, and attaches dub state", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("/timetables/dub")) {
      return jsonResponse([
        { route: "chainsmoker-cat", airType: "dub", episodeNumber: 11, episodeDate: "2026-10-05T00:00:00Z", airingStatus: "aired" },
        { route: "split-cour", airType: "dub", episodeNumber: 20, episodeDate: "2026-10-05T00:00:00Z", airingStatus: "aired" },
      ]);
    }
    if (url.includes("/anime?")) {
      return jsonResponse({ page: 1, totalAmount: 3, anime: [
        { route: "chainsmoker-cat", title: "Chainsmoker Cat", status: "Ongoing", episodes: 12, dubPremier: "2026-07-20T00:00:00Z", websites: { mal: "myanimelist.net/anime/100/Chainsmoker_Cat" } },
        { route: "split-cour", title: "Split", status: "Ongoing", episodes: 24, dubPremier: "2026-07-20T00:00:00Z", websites: { mal: "myanimelist.net/anime/300" } },
        { route: "subbed-only", title: "Sub", status: "Ongoing", episodes: 12, dubPremier: "0001-01-01T00:00:00Z", websites: { mal: "myanimelist.net/anime/200" } },
      ] });
    }
    throw new Error(`unexpected ${url}`);
  };
  const items = {
    1: { status: "watching", total_episodes_count: 12, anime: { title: "Chainsmoker Cat", ids: { simkl: 1, mal: 100 } } },
    2: { status: "watching", total_episodes_count: 12, anime: { title: "Sub", ids: { simkl: 2, mal: 200 } } },
    3: { status: "watching", total_episodes_count: 12, anime: { title: "Split", ids: { simkl: 3, mal: 300 } } },
    4: { status: "watching", anime: { title: "No IDs", ids: { simkl: 4 } } },
  };
  const first = await enrichDubInfo(items, null, { token: "x", fetchImpl, now: NOW, gapMs: 0 });
  assert.equal(calls.filter((url) => url.includes("/timetables/dub")).length, 26);
  assert.equal(calls.filter((url) => url.includes("/anime?")).length, 1);
  assert.ok(first.dubState.backfilledAt);
  assert.deepEqual(first.items[1]._addonDub, { route: "chainsmoker-cat", episode: 11, full: false, estimated: false, numberingMismatch: false });
  assert.equal(first.items[1]._addonAnimeScheduleRoute, "chainsmoker-cat");
  assert.equal(first.items[2]._addonDub, undefined);
  assert.equal(first.items[3]._addonDub.numberingMismatch, true);
  assert.equal(first.items[4]._addonDub, undefined);

  calls.length = 0;
  await enrichDubInfo(first.items, first.dubState, { token: "x", fetchImpl, now: NOW, gapMs: 0 });
  assert.equal(calls.filter((url) => url.includes("/timetables/dub")).length, 2, "later runs read this week and last week only");
  assert.equal(calls.filter((url) => url.includes("/anime?")).length, 0, "matches are cached for a day");
});

test("enrichDubInfo is a no-op without a token", async () => {
  const result = await enrichDubInfo({ 1: { status: "watching" } }, null, { token: "", fetchImpl: async () => { throw new Error("no"); } });
  assert.equal(result.enabled, false);
});

test("enrichMalScores caches Jikan scores", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return jsonResponse({ data: { score: 8.37 } }); };
  const items = { 1: { status: "watching", anime: { ids: { simkl: 1, mal: 100 } } } };
  const first = await enrichMalScores(items, {}, { fetchImpl, now: NOW, gapMs: 0 });
  assert.equal(first.items[1]._addonMalScore, "8.4");
  const second = await enrichMalScores(first.items, first.cache, { fetchImpl, now: NOW, gapMs: 0 });
  assert.equal(second.items[1]._addonMalScore, "8.4");
  assert.equal(calls, 1);
});
