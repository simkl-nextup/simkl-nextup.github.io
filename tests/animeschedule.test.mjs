import test from "node:test";
import assert from "node:assert/strict";
import { enrichDubInfo, isoWeek, laterSeasonDub, recordTimetable, resolveDub, routeFamily, websiteId } from "../src/animeschedule.mjs";
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
  assert.equal(resolveDub({ ...base, dubPremier: null }, null, NOW), null, "no premier and nothing on the dub timetable → no tag");
  assert.equal(resolveDub({ ...base, dubPremier: "2027-01-01T00:00:00Z" }, null, NOW), null);
  assert.deepEqual(resolveDub({ ...base, status: "Ongoing", episodes: 24, dubPremier: "2026-08-01T00:00:00Z" }, { episode: 9 }, NOW),
    { route: "show", episode: 9, full: false, estimated: false });
  assert.equal(resolveDub({ ...base, dubPremier: "2026-08-01T00:00:00Z" }, { episode: 12 }, NOW).full, true);
  // Finished long before the ledger window → fully dubbed.
  assert.equal(resolveDub({ ...base, dubPremier: "2024-01-01T00:00:00Z" }, null, NOW).full, true);
  // Finished recently but not in the ledger → no guess.
  assert.equal(resolveDub({ ...base, dubPremier: "2026-09-20T00:00:00Z" }, null, NOW), null);
  // Same-day simuldub: no dubPremier, but the dub timetable lists the episode.
  assert.deepEqual(resolveDub({ route: "mushoku-3", status: "Ongoing", episodes: 27, dubPremier: null }, { episode: 15 }, NOW),
    { route: "mushoku-3", episode: 15, full: false, estimated: false });
  // Batch release covering the whole season.
  assert.equal(resolveDub({ ...base, dubPremier: "2026-09-20T00:00:00Z", dubOverride: { date: "2026-09-27T00:00:00Z", episode: 7, extra: 5 } }, null, NOW).full, true);
});

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) };
}
function textResponse(text, status) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => JSON.parse(text), text: async () => text };
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
  assert.deepEqual(first.items[1]._addonDub, { route: "chainsmoker-cat", episode: 11, full: false, estimated: false, numberingMismatch: false, mal: 100 });
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

test("MAL score comes from Simkl's record first, without touching Jikan", async () => {
  let jikan = 0;
  const fetchImpl = async () => { jikan += 1; throw new Error("fetch failed"); };
  const items = { 1: { status: "watching", anime: { ids: { simkl: 1, mal: 100 } } }, 2: { status: "watching", anime: { ids: { simkl: 2, mal: 200 } } } };
  const simklDetails = async (id) => (id === 1 ? { ratings: { simkl: { rating: 8 }, mal: { rating: 8.71, votes: 5 } } } : { ratings: { simkl: { rating: 7 } } });
  const result = await enrichMalScores(items, {}, { fetchImpl, now: NOW, gapMs: 0, simklDetails });
  assert.equal(result.items[1]._addonMalScore, "8.7");
  assert.equal(result.items[2]._addonMalScore, undefined);
  assert.equal(jikan, 1, "Jikan is tried once for the title Simkl lacks, then skipped after a network failure");
  assert.equal(result.sources.simkl, 1);
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

test("titles without anime list IDs get MAL/AniList/AniDB from Simkl's full record, once a week", async () => {
  const { enrichAnimeListIds } = await import("../scripts/update.mjs");
  let calls = 0;
  const client = { getDetails: async (id, extended) => { calls += 1; assert.equal(extended, "full"); return { ids: { simkl: id, mal: 5114, anidb: 6107 } }; } };
  const items = {
    1: { status: "watching", anime: { title: "A", ids: { simkl: 1, imdb: "tt1" } } },
    2: { status: "watching", anime: { title: "B", ids: { simkl: 2, mal: 99 } } },
  };
  const first = await enrichAnimeListIds(client, items, NOW, () => true);
  assert.equal(first.items[1].anime.ids.mal, 5114);
  assert.equal(first.items[1].anime.ids.imdb, "tt1");
  assert.equal(calls, 1, "titles that already have a MAL ID are skipped");
  const noIds = { 3: { status: "watching", anime: { title: "C", ids: { simkl: 3 } } } };
  const emptyClient = { getDetails: async () => { calls += 1; return { ids: { simkl: 3 } }; } };
  const once = await enrichAnimeListIds(emptyClient, noIds, NOW, () => true);
  await enrichAnimeListIds(emptyClient, once.items, NOW, () => true);
  assert.equal(calls, 2, "a title with no anime IDs on Simkl is not re-checked within a week");
});

test("Fribb anime-lists fill MAL IDs by Simkl ID", async () => {
  const { indexFribb, applyFribbIds } = await import("../src/anime-ids.mjs");
  const index = indexFribb([
    { simkl_id: 36462, mal_id: 30, anidb_id: 22, anilist_id: 30, kitsu_id: 21, imdb_id: ["tt0112159"] },
  ]);
  const items = {
    1: { status: "watching", anime: { title: "Evangelion", ids: { simkl: 36462, imdb: "tt0112159" } } },
    2: { status: "watching", anime: { title: "Other", ids: { simkl: 999 } } },
  };
  assert.equal(applyFribbIds(items, index), 1);
  assert.deepEqual(items[1].anime.ids, { simkl: 36462, imdb: "tt0112159", mal: 30, anilist: 30, anidb: 22, kitsu: 21 });
  assert.deepEqual(items[2].anime.ids, { simkl: 999 });
});

test("MAL-Dubs marks older fully dubbed shows as DUB ALL, but not partial dubs", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("MAL-Dubs")) return jsonResponse({ dubbed: [30, 790, 500], incomplete: [500] });
    if (url.includes("/timetables/dub")) return jsonResponse([]);
    if (url.includes("/anime?")) return jsonResponse({ anime: [] });
    throw new Error(`unexpected ${url}`);
  };
  const items = {
    1: { status: "watching", next_to_watch_info: { episode: 2, date: "1995-10-11T00:00:00Z" }, anime: { title: "Evangelion", ids: { simkl: 1, mal: 30 } } },
    2: { status: "watching", anime: { title: "Partial", ids: { simkl: 2, mal: 500 } } },
    3: { status: "watching", anime: { title: "Undubbed", ids: { simkl: 3, mal: 777 } } },
    4: { status: "watching", _addonLatestAiredInfo: { episode: 13, date: "2026-10-04T00:00:00Z" }, anime: { title: "Airing simuldub", ids: { simkl: 4, mal: 790 } } },
  };
  const result = await enrichDubInfo(items, null, { token: "x", fetchImpl, now: NOW, gapMs: 0 });
  assert.equal(result.items[1]._addonDub.full, true);
  assert.equal(result.items[4]._addonDub.full, false, "a show still airing is never 'fully dubbed'");
  assert.equal(result.items[4]._addonDub.airing, true);
  assert.equal(result.items[2]._addonDub, undefined);
  assert.equal(result.items[3]._addonDub, undefined);
});

test("when list results carry no Websites link, a single-ID lookup is accepted only if the name matches", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("MAL-Dubs")) return jsonResponse({ dubbed: [], incomplete: [] });
    if (url.includes("/timetables/dub")) {
      return jsonResponse([{ route: "mushoku-tensei-3", airType: "dub", episodeNumber: 15, episodeDate: "2026-10-04T00:00:00Z", airingStatus: "aired" }]);
    }
    if (url.includes("/anime?mal-ids=111&mal-ids=222")) return jsonResponse({ anime: [{ route: "mushoku-tensei-3", title: "Mushoku Tensei III" }, { route: "x", title: "Other" }] });
    if (url.includes("/anime?mal-ids=111")) return jsonResponse({ anime: [{ route: "mushoku-tensei-3", title: "Mushoku Tensei III", status: "Ongoing", episodes: 27 }] });
    if (url.includes("/anime?mal-ids=222")) return jsonResponse({ anime: [{ route: "something-else", title: "Totally Different Show" }] });
    throw new Error(`unexpected ${url}`);
  };
  const items = {
    1: { status: "watching", anime: { title: "Mushoku Tensei III: Jobless Reincarnation", ids: { simkl: 1, mal: 111 } } },
    2: { status: "watching", anime: { title: "Sparks of Tomorrow", ids: { simkl: 2, mal: 222 } } },
  };
  const result = await enrichDubInfo(items, null, { token: "x", fetchImpl, now: NOW, gapMs: 0 });
  assert.equal(result.items[1]._addonDub.episode, 15);
  assert.equal(result.items[2]._addonDub, undefined, "a name mismatch is never accepted");
  assert.equal(result.stats.singleLookups, 2);
});

test("multi-ID lookups use mt=any (the API default 'all' returns nothing), and 'Couldn't find' means no results", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("MAL-Dubs")) return jsonResponse({ dubbed: [], incomplete: [] });
    if (url.includes("/timetables/dub")) return jsonResponse([]);
    if (url.includes("/anime?") && !url.includes("mt=any") && url.includes("&mal-ids=")) return textResponse("Couldn't find anime with these parameters.", 404);
    if (url.includes("/anime?mal-ids=21&mal-ids=999&mt=any")) {
      // Shape verified against the live API on 2026-10-10.
      return jsonResponse({ page: 1, totalAmount: 1, anime: [{ id: "urTI", title: "One Piece", route: "one-piece", dubPremier: "2020-11-24T00:00:00Z", dubTime: "2026-08-27T16:00:00Z", status: "Ongoing", episodes: 0, websites: { mal: "myanimelist.net/anime/21" } }] });
    }
    if (url.includes("/anime?mal-ids=999")) return textResponse("Couldn't find anime with these parameters.", 200);
    throw new Error(`unexpected ${url}`);
  };
  const items = {
    1: { status: "watching", anime: { title: "One Piece", ids: { simkl: 1, mal: 21 } } },
    2: { status: "watching", anime: { title: "Unknown", ids: { simkl: 2, mal: 999 } } },
  };
  const result = await enrichDubInfo(items, null, { token: "x", fetchImpl, now: NOW, gapMs: 0 });
  assert.ok(urls.some((url) => url.includes("mal-ids=21&mal-ids=999&mt=any")));
  assert.equal(result.items[1]._addonAnimeScheduleRoute, "one-piece");
  assert.equal(result.items[2]._addonAnimeScheduleRoute, undefined);
  assert.deepEqual(result.warnings, []);
});

test("Japanese 'Finished' alone never makes a recent show 'fully dubbed'", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("MAL-Dubs")) return jsonResponse({ dubbed: [42], incomplete: [] });
    if (url.includes("/timetables/dub")) return jsonResponse([]);
    if (url.includes("/anime?")) return jsonResponse({ anime: [{ route: "sparks", title: "Sparks of Tomorrow", status: "Finished", episodes: 13, dubPremier: "2026-07-10T00:00:00Z", websites: { mal: "myanimelist.net/anime/42" } }] });
    throw new Error(`unexpected ${url}`);
  };
  // Final Japanese episode aired 3 weeks ago; dub not on the timetable window.
  const items = { 1: { status: "watching", _addonLatestAiredInfo: { episode: 13, date: "2026-09-19T00:00:00Z" }, anime: { title: "Sparks of Tomorrow", ids: { simkl: 1, mal: 42 } } } };
  const result = await enrichDubInfo(items, null, { token: "x", fetchImpl, now: NOW, gapMs: 0 });
  assert.equal(result.items[1]._addonDub.full, false);
  assert.equal(result.items[1]._addonDub.unknown, true);
  assert.equal(result.stats.perTitle[0].result, "DUB (progress unknown)");
});

test("routeFamily splits a season suffix off AnimeSchedule routes", () => {
  assert.deepEqual(routeFamily("re-zero-kara-hajimeru-isekai-seikatsu-2-part-2"), { stem: "re-zero-kara-hajimeru-isekai-seikatsu", season: 2 });
  assert.deepEqual(routeFamily("re-zero-kara-hajimeru-isekai-seikatsu-4th-season"), { stem: "re-zero-kara-hajimeru-isekai-seikatsu", season: 4 });
  assert.deepEqual(routeFamily("re-zero-kara-hajimeru-isekai-seikatsu"), { stem: "re-zero-kara-hajimeru-isekai-seikatsu", season: 1 });
  assert.deepEqual(routeFamily("shi-guang-dai-li-ren-3"), { stem: "shi-guang-dai-li-ren", season: 3 });
  assert.deepEqual(routeFamily("one-piece"), { stem: "one-piece", season: 1 });
  assert.deepEqual(routeFamily("mob-psycho-100"), { stem: "mob-psycho-100", season: 1 }, "numbers that are part of the name stay");
  assert.deepEqual(routeFamily("steins-gate-0"), { stem: "steins-gate-0", season: 1 });
});

test("laterSeasonDub finds a newer season of the same show only", () => {
  const ledger = {
    "re-zero-kara-hajimeru-isekai-seikatsu-4th-season": { episode: 5, date: "2026-10-08T00:00:00Z" },
    "re-zero-kara-hajimeru-isekai-seikatsu-3rd-season": { episode: 16, date: "2025-03-01T00:00:00Z" },
    "one-piece-film-red": { episode: 1, date: "2026-10-08T00:00:00Z" },
  };
  assert.deepEqual(laterSeasonDub("re-zero-kara-hajimeru-isekai-seikatsu-2-part-2", ledger),
    { route: "re-zero-kara-hajimeru-isekai-seikatsu-4th-season", season: 4, episode: 5, date: "2026-10-08T00:00:00Z" });
  assert.equal(laterSeasonDub("re-zero-kara-hajimeru-isekai-seikatsu-4th-season", ledger), null, "nothing newer than S4");
  assert.equal(laterSeasonDub("one-piece", ledger), null, "a film is not a later season");
});

function dubFetch({ timetable = [], anime = [], malDubs = { dubbed: [], incomplete: [] } }) {
  return async (url) => {
    if (url.includes("MAL-Dubs")) return jsonResponse(malDubs);
    if (url.includes("/timetables/dub")) return jsonResponse(timetable);
    if (url.includes("/anime?")) return jsonResponse({ page: 1, totalAmount: anime.length, anime });
    throw new Error(`unexpected ${url}`);
  };
}

test("Re:Zero: watching S2 Part 2 while the S4 dub airs shows the S4 dub, not 'S2 AIRING'", async () => {
  const fetchImpl = dubFetch({
    timetable: [{ route: "re-zero-kara-hajimeru-isekai-seikatsu-4th-season", airType: "dub", episodeNumber: 5, episodeDate: "2026-10-07T00:00:00Z", airingStatus: "aired" }],
    anime: [{ route: "re-zero-kara-hajimeru-isekai-seikatsu-2-part-2", title: "Re:Zero 2 Part 2", status: "Finished", episodes: 12, websites: { mal: "myanimelist.net/anime/42203" } }],
    malDubs: { dubbed: [42203], incomplete: [] },
  });
  const items = { 1: { status: "watching", anime: { title: "Re:Zero 2 Part 2", ids: { simkl: 1, mal: 42203 } } } };
  const { items: out, stats } = await enrichDubInfo(items, null, { token: "x", fetchImpl, now: NOW, gapMs: 0 });
  assert.equal(out[1]._addonDub.laterSeason, true);
  assert.equal(out[1]._addonDub.season, 4);
  assert.equal(out[1]._addonDub.episode, 5);
  assert.match(stats.perTitle[0].result, /^S4 E5 \(later season/);
});

test("a finished season is not 'airing' just because a later season is on TheTVDB's list", async () => {
  const videos = [
    { id: "tt1:2:25", season: 2, episode: 25, released: "2021-03-24T00:00:00Z" },
    { id: "tt1:4:5", season: 4, episode: 5, released: "2026-10-07T00:00:00Z" },
  ];
  const fetchImpl = dubFetch({
    anime: [{ route: "re-zero-kara-hajimeru-isekai-seikatsu-2-part-2", title: "Re:Zero 2 Part 2", status: "Finished", episodes: 12, websites: { mal: "myanimelist.net/anime/42203" } }],
    malDubs: { dubbed: [42203], incomplete: [] },
  });
  const items = { 1: {
    status: "watching",
    _addonLatestAiredInfo: { episode: 25, date: "2021-03-24T00:00:00Z" },
    _addonTvdbMeta: { videos, matchedSeasonNumber: 2 },
    anime: { title: "Re:Zero 2 Part 2", ids: { simkl: 1, mal: 42203 } },
  } };
  const { items: out } = await enrichDubInfo(items, null, { token: "x", fetchImpl, now: NOW, gapMs: 0 });
  assert.equal(out[1]._addonDub.full, true, "S2 finished in 2021 → fully dubbed");
});

test("One Piece: ongoing Japanese run means 'ongoing', and a typed episode number is used until the schedule passes it", async () => {
  const onePiece = { route: "one-piece", title: "One Piece", status: "Ongoing", dubPremier: "2020-11-24T00:00:00Z", websites: { mal: "myanimelist.net/anime/21" } };
  const items = { 1: { status: "watching", anime: { title: "One Piece", ids: { simkl: 1, mal: 21 } } } };
  const malDubs = { dubbed: [21], incomplete: [] };

  const plain = await enrichDubInfo(items, null, { token: "x", fetchImpl: dubFetch({ anime: [onePiece], malDubs }), now: NOW, gapMs: 0 });
  assert.equal(plain.items[1]._addonDub.airing, true);
  assert.equal(plain.items[1]._addonDub.episode, null);

  const typed = await enrichDubInfo(items, null, { token: "x", fetchImpl: dubFetch({ anime: [onePiece], malDubs }), now: NOW, gapMs: 0, overrides: { 21: 1155 } });
  assert.equal(typed.items[1]._addonDub.episode, 1155);
  assert.equal(typed.items[1]._addonDub.manual, true);

  const weekly = dubFetch({ anime: [onePiece], malDubs,
    timetable: [{ route: "one-piece", airType: "dub", episodeNumber: 1157, episodeDate: "2026-10-06T00:00:00Z", airingStatus: "aired" }] });
  const scheduled = await enrichDubInfo(items, null, { token: "x", fetchImpl: weekly, now: NOW, gapMs: 0, overrides: { 21: 1155 } });
  assert.equal(scheduled.items[1]._addonDub.episode, 1157, "the dub timetable wins once it is ahead");
  assert.equal(scheduled.items[1]._addonDub.manual, undefined);
});
