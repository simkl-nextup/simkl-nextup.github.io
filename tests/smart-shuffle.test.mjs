import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { buildSmartEntries, eligibleSmartHomeRelease, SMART_FEATURE_DAYS, interleaveSmartMovies, paginateSmartCatalog, recentTheatricalPremiere, SMART_SHUFFLE_ID } from '../src/smart-shuffle.mjs';
import { refreshSmartShuffle } from '../scripts/refresh-smart-shuffle.mjs';

const seededRandom = (limit) => limit - 1;
const make = (n, homeRank = null) => ({
  meta: { id: `tt${1000000 + n}`, name: `Movie ${n}`, type: 'movie',
    poster: `https://btttr.cc/poster/imdb/poster-default/tt${1000000 + n}.jpg?tag=none` },
  homeRank,
});
const originalIds = [
  'simkl-new-tv-episodes-account2', 'simkl-plan-to-watch-home-releases-account2',
  'global-upcoming-movies', 'global-upcoming-tv',
];
function originalManifest() {
  return { id: 'community.simkl.new-tv-episodes.account2', types: ['series', 'movie'],
    idPrefixes: ['tt', 'tmdb:'], catalogs: originalIds.map((id, i) => ({
      type: i === 0 || i === 3 ? 'series' : 'movie', id, name: id,
    })) };
}
const homeFile = (outputDirectory) => join(outputDirectory, 'catalog/movie/simkl-plan-to-watch-home-releases-account2.json');

async function fixture(t, { movies, homeMetas = [], tmdbCache = null, originalMetadata = null } = {}) {
  const temp = await mkdtemp(join(tmpdir(), 'smart-shuffle-tags-'));
  const outputDirectory = join(temp, 'public/account-2');
  const releaseStateFile = join(temp, 'state/movie.json');
  await mkdir(join(outputDirectory, 'catalog/movie'), { recursive: true });
  await mkdir(join(outputDirectory, 'meta/movie'), { recursive: true });
  await mkdir(path.dirname(releaseStateFile), { recursive: true });
  const manifest = originalManifest();
  const status = { old: 'original', discovery: { foo: 1 }, movieRow: { bar: 2 } };
  await writeFile(join(outputDirectory, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(outputDirectory, 'status.json'), JSON.stringify(status));
  await writeFile(homeFile(outputDirectory), JSON.stringify({ metas: homeMetas }));
  const cache = tmdbCache ?? Object.fromEntries(movies.map((movie) => [String(movie.movie.ids.simkl),
    { tmdb: null, fetchedAt: '2026-10-19T00:00:00Z' }]));
  await writeFile(releaseStateFile, JSON.stringify({ movies: cache }));
  if (originalMetadata) await writeFile(join(outputDirectory, `meta/movie/${originalMetadata.meta.id}.json`), JSON.stringify(originalMetadata));
  const fetchImpl = async (url) => {
    assert.match(String(url), /api.simkl.com/);
    return { ok: true, json: async () => ({ movies }) };
  };
  return { temp, outputDirectory, releaseStateFile, fetchImpl, manifest, status };
}

const planMovie = (n) => ({ status: 'plantowatch', movie: {
  title: `Film ${n}`, ids: { simkl: n, imdb: `tt${1000000 + n}` },
}});


const movieRelease = (first, { laterPhysical = null, usDate = null } = {}) => ({
  release_dates: { results: [
    { iso_3166_1: 'GB', release_dates: [
      { type: 4, release_date: `${first}T00:00:00Z` },
      ...(laterPhysical ? [{ type: 5, release_date: `${laterPhysical}T00:00:00Z` }] : []),
    ] },
    ...(usDate ? [{ iso_3166_1: 'US', release_dates: [{ type: 4, release_date: `${usDate}T00:00:00Z` }] }] : []),
  ] },
});

test('Smart Shuffle uses 60 UTC calendar days, including day 60 but not 61; Home Releases keeps six months', async () => {
  const now = new Date('2026-10-19T16:30:00Z');
  assert.equal(SMART_FEATURE_DAYS, 60);
  assert.equal(eligibleSmartHomeRelease(movieRelease('2026-10-19'), now), true);
  assert.equal(eligibleSmartHomeRelease(movieRelease('2026-08-20'), now), true, 'day 60');
  assert.equal(eligibleSmartHomeRelease(movieRelease('2026-08-19'), now), false, 'day 61');
  assert.equal(eligibleSmartHomeRelease(movieRelease('2026-05-19'), now), false, 'five months old');
  assert.equal(eligibleSmartHomeRelease(movieRelease('2026-11-18'), now), true, 'day 30 upcoming');
  assert.equal(eligibleSmartHomeRelease(movieRelease('2026-11-19'), now), false, 'day 31 upcoming');
  assert.equal(eligibleSmartHomeRelease(movieRelease('2026-08-19', {
    laterPhysical: '2026-10-19', usDate: '2026-10-17',
  }), now), false, 'US rollout and physical reissue do not restart first availability');
  const { classifyHomeReleases } = await import('../src/movie-releases.mjs');
  assert.ok(classifyHomeReleases(movieRelease('2026-08-19').release_dates, { now }),
    'Home Releases must still include the 61-day-old movie');
});

test('expired featured movies fall back to randomized untagged posters without leaving Smart Shuffle', () => {
  const now = new Date('2026-10-19T12:00:00Z');
  const dates = ['2026-08-20', '2026-08-19', '2026-11-18', '2026-05-19'];
  const movies = dates.map((_, i) => planMovie(i + 1));
  const cache = Object.fromEntries(dates.map((date, i) => [i + 1, {
    tmdb: { ...movieRelease(date), id: i + 1, title: `Film ${i + 1}`,
      imdb_id: `tt${1000000 + i + 1}` },
  }]));
  const homeCatalog = dates.map((_, i) => ({ id: `tt${1000000 + i + 1}`,
    type: 'movie', poster: `https://example.test/home/${i}.webp`,
    releaseInfo: i === 2 ? 'COMING SOON' : 'DIGITAL OUT',
  }));
  const { entries } = buildSmartEntries(movies, cache, { homeCatalog, now });
  assert.deepEqual(entries.map(entry => entry.homeRank), [0, null, 2, null]);
  for (const i of [0, 2]) {
    assert.equal(entries[i].meta.poster, homeCatalog[i].poster);
    assert.equal(entries[i].meta.releaseInfo, homeCatalog[i].releaseInfo);
  }
  for (const i of [1, 3]) {
    assert.match(entries[i].meta.poster, /^https:\/\/btttr\.cc\//);
    assert.equal(Object.hasOwn(entries[i].meta, 'releaseInfo'), false);
    assert.equal(entries[i].theatrical, null);
  }
  const mixed = interleaveSmartMovies(entries, { rng: seededRandom });
  assert.equal(mixed.featured, 2);
  assert.equal(mixed.shuffled, 2);
  assert.equal(mixed.entries.length, 4);
  assert.deepEqual(mixed.entries.map(entry => entry.meta.id), [
    'tt1000001', 'tt1000002', 'tt1000004', 'tt1000003',
  ]);
});

test('Smart Shuffle never upgrades a movie just because Home Releases has a tag and its cache lacks a date', () => {
  const movies = [planMovie(1)];
  const { entries } = buildSmartEntries(movies, { 1: { tmdb: { title: 'Film 1' } } }, {
    homeCatalog: [{ id: 'tt1000001', type: 'movie', poster: 'https://example.test/tagged.webp', releaseInfo: 'DIGITAL OUT' }],
    now: new Date('2026-10-19T00:00:00Z'),
  });
  assert.equal(entries[0].homeRank, null);
  assert.match(entries[0].meta.poster, /btttr\.cc/);
});

test('one published Home Releases movie then two randomized movies; no repeats; preserves Home Releases order', () => {
  const entries = [make(1, 0), make(2), make(3, 2), make(4), make(5, 1), make(6), make(7)];
  const { entries: ordered, featured, shuffled } = interleaveSmartMovies(entries, { rng: seededRandom });
  assert.deepEqual(ordered.map(x => x.meta.id), [
    'tt1000001', 'tt1000002', 'tt1000004', 'tt1000005', 'tt1000006',
    'tt1000007', 'tt1000003',
  ]);
  assert.equal(featured, 3);
  assert.equal(shuffled, 4);
  assert.equal(new Set(ordered.map(x => x.meta.id)).size, 7);
});

test('unfeatured entire Plan to Watch is still included, no matter how old, with randomization', () => {
  const entries = [make(1), make(2), make(3)];
  const result = interleaveSmartMovies(entries, { rng: seededRandom });
  assert.equal(result.featured, 0);
  assert.equal(result.shuffled, 3);
  assert.equal(result.entries.length, 3);
  assert.equal(interleaveSmartMovies([make(1, 1), make(2, 0)]).entries.length, 2);
});

test('pagination preserves all titles with Stremio skip pages', () => {
  const entries = Array.from({ length: 121 }, (_, i) => ({ id: `tt${1000000 + i}` }));
  const pages = paginateSmartCatalog(entries);
  assert.deepEqual(pages.map(p => [p.skip, p.metas.length]), [[0, 50], [50, 50], [100, 21]]);
  assert.deepEqual(pages.flatMap(p => p.metas), entries);
});

test('ONLY actual published Home Releases titles receive tags; older and non-featured recent movies get plain BetterPosters', () => {
  const movies = [planMovie(1), planMovie(2), planMovie(3), planMovie(4)];
  const cache = {
    1: { tmdb: { id: 55, title: 'Film 1', release_dates: { results: [
      { iso_3166_1: 'US', release_dates: [{ type: 4, release_date: '2018-09-02T00:00:00Z' }] },
    ] } } },
    2: { tmdb: { id: 66, title: 'Film 2', release_dates: { results: [
      { iso_3166_1: 'US', release_dates: [{ type: 4, release_date: '2026-10-15T00:00:00Z' }] },
    ] } } },
    3: { tmdb: { id: 77, title: 'Film 3', release_dates: { results: [
      { iso_3166_1: 'US', release_dates: [{ type: 4, release_date: '2026-10-14T00:00:00Z' }] },
    ] } } },
    4: { tmdb: null },
  };
  // Film 3 has a recent release date but is not on the actual Home Releases
  // catalog (e.g. max 50). Film 1 has an old date. Neither gets an overlay.
  const taggedPoster = 'https://site.test/account-2/posters/movies/released.webp';
  const homeCatalog = [
    { id: 'tt1000002', type: 'movie', name: 'Film 2', poster: taggedPoster,
      releaseInfo: 'DIGITAL OUT', description: 'DIGITAL OUT · OCT 15 (US).' },
  ];
  const { entries } = buildSmartEntries(movies, cache, { homeCatalog, now: new Date('2026-10-19T00:00:00Z') });
  const featured = entries.find(e => e.meta.id === 'tt1000002');
  assert.equal(featured.homeRank, 0);
  assert.equal(featured.meta.poster, taggedPoster);
  assert.equal(featured.meta.releaseInfo, 'DIGITAL OUT');
  for (const id of ['tt1000001', 'tt1000003', 'tt1000004']) {
    const entry = entries.find(e => e.meta.id === id);
    assert.equal(entry.homeRank, null);
    assert.equal('releaseInfo' in entry.meta, false);
    assert.match(entry.meta.poster, /^https:\/\/btttr\.cc\/poster\/imdb\/poster-default\//);
    assert.doesNotMatch(entry.meta.description, /DIGITAL OUT|PHYSICAL OUT|COMING SOON/);
  }
});

test('end-to-end fifth catalog preserves four rows, existing metadata, pagination; reuses home tagged poster without rewriting it', async () => {
  const movies = Array.from({ length: 107 }, (_, i) => planMovie(i + 1));
  const homePosters = [3, 9, 20].map((n) => ({
    type: 'movie', id: `tt${1000000 + n}`, name: `Film ${n}`,
    poster: `https://example.test/account-2/posters/movie/${n}.webp`,
    releaseInfo: n === 20 ? 'COMING SOON' : 'DIGITAL OUT',
  }));
  const originalMetadata = { meta: { type: 'movie', id: 'tt1000003', videos: [{ id: 'existing', season: 1, episode: 1 }] } };
  const tmdbCache = Object.fromEntries(movies.map((movie) => [String(movie.movie.ids.simkl), {
    tmdb: { id: movie.movie.ids.simkl, title: movie.movie.title, imdb_id: movie.movie.ids.imdb,
      release_dates: { results: [{ iso_3166_1: 'US', release_dates: [
        { type: 4, release_date: '2026-10-15T00:00:00Z' },
      ] }] } },
    fetchedAt: '2026-10-19T00:00:00Z',
  }]));
  const f = await fixture(null, { movies, homeMetas: homePosters, originalMetadata, tmdbCache });
  const result = await refreshSmartShuffle({ clientId: 'fake', accessToken: 'fake',
    fetchImpl: f.fetchImpl, outputDirectory: f.outputDirectory, releaseStateFile: f.releaseStateFile,
    baseUrl: 'https://unit.test/account-2', rng: seededRandom, now: new Date('2026-10-19T00:00:00Z') });
  assert.equal(result.metas.length, 107);
  assert.equal(result.status.featured, 3);
  assert.equal(result.status.taggedFromHomeReleases, 3);
  assert.equal(result.status.featuredHomeReleaseDays, 60);
  assert.equal(result.status.random, 104);
  assert.deepEqual(result.metas.slice(0, 1).map(x => x.id), ['tt1000003']);
  for (let i = 0; i < homePosters.length; i++) {
    const meta = result.metas.find(e => e.id === homePosters[i].id);
    assert.equal(meta.poster, homePosters[i].poster);
    assert.equal(meta.releaseInfo, homePosters[i].releaseInfo);
  }
  for (const meta of result.metas.filter(e => !homePosters.some(home => home.id === e.id))) {
    assert.match(meta.poster, /btttr\.cc\/poster\/imdb\/poster-default/);
    assert.equal(Object.hasOwn(meta, 'releaseInfo'), false);
  }
  const updated = JSON.parse(await readFile(join(f.outputDirectory, 'manifest.json')));
  assert.deepEqual(updated.catalogs.slice(0, 4), f.manifest.catalogs);
  assert.equal(updated.catalogs[4].id, SMART_SHUFFLE_ID);
  assert.equal(updated.catalogs[4].extra, undefined,'plain Nuvio-compatible catalog');
  const base = JSON.parse(await readFile(join(f.outputDirectory, `catalog/movie/${SMART_SHUFFLE_ID}.json`)));
  const pages = await Promise.all([0, 50, 100, 150].map(async (skip) => JSON.parse(await readFile(
    join(f.outputDirectory, `catalog/movie/${SMART_SHUFFLE_ID}/skip=${skip}.json`)))));
  assert.equal(base.metas.length,107,'all movies are in the base catalog so Nuvio can render without skip');
  assert.deepEqual(base.metas.slice(0,50),pages[0].metas);
  assert.deepEqual(pages.map(p => p.metas.length), [50, 50, 7, 0]);
  assert.equal(new Set(pages.flatMap(p => p.metas.map(x => x.id))).size, 107);
  assert.deepEqual(JSON.parse(await readFile(join(f.outputDirectory, 'meta/movie/tt1000003.json'))), originalMetadata);
  const updatedStatus = JSON.parse(await readFile(join(f.outputDirectory, 'status.json')));
  assert.equal(updatedStatus.old, 'original');
  assert.deepEqual(updatedStatus.discovery, f.status.discovery);
  assert.deepEqual(updatedStatus.movieRow, f.status.movieRow);
  assert.equal(updatedStatus.smartShuffle.published, 107);
  assert.deepEqual(JSON.parse(await readFile(homeFile(f.outputDirectory))), { metas: homePosters });
});


test('end-to-end: day-61 Home Releases title becomes a plain randomized Smart Shuffle title, while Home Releases is unchanged', async () => {
  const movies = [planMovie(1), planMovie(2), planMovie(3)];
  const homeMetas = [1, 2].map(n => ({ id: `tt${1000000 + n}`, type: 'movie',
    name: `Film ${n}`, poster: `https://example.test/home/${n}.webp`, releaseInfo: 'DIGITAL OUT' }));
  const tmdbCache = Object.fromEntries(movies.map((movie, i) => [String(i + 1), {
    tmdb: { id: i + 1, title: movie.movie.title, imdb_id: movie.movie.ids.imdb,
      release_dates: { results: [{ iso_3166_1: 'US', release_dates: [
        { type: 4, release_date: `${i === 0 ? '2026-10-18' : i === 1 ? '2026-08-19' : '2011-05-01'}T00:00:00Z` },
      ] }] } },
    fetchedAt: '2026-10-19T00:00:00Z',
  }]));
  const f = await fixture(null, { movies, homeMetas, tmdbCache });
  const result = await refreshSmartShuffle({ clientId: 'test', accessToken: 'test',
    outputDirectory: f.outputDirectory, releaseStateFile: f.releaseStateFile,
    fetchImpl: f.fetchImpl, baseUrl: 'https://unit.test/account-2', rng: seededRandom,
    now: new Date('2026-10-19T00:00:00Z') });
  assert.equal(result.status.featured, 1);
  assert.equal(result.status.random, 2);
  assert.equal(result.status.featuredHomeReleaseDays, 60);
  assert.deepEqual(result.metas.map(m => m.id), ['tt1000001', 'tt1000002', 'tt1000003']);
  assert.equal(result.metas[0].poster, homeMetas[0].poster);
  assert.equal(result.metas[0].releaseInfo, 'DIGITAL OUT');
  assert.ok(result.metas.slice(1).every(m => m.poster.includes('btttr.cc') && !('releaseInfo' in m)));
  assert.deepEqual(JSON.parse(await readFile(homeFile(f.outputDirectory))), { metas: homeMetas });
  const manifest = JSON.parse(await readFile(join(f.outputDirectory, 'manifest.json')));
  assert.deepEqual(manifest.catalogs.slice(0, 4), f.manifest.catalogs);
  assert.equal(manifest.catalogs[4].id, SMART_SHUFFLE_ID);
});

test('if Home Releases has no eligible movies, Smart Shuffle never adds release tags', async () => {
  const movies = [planMovie(1), planMovie(2)];
  const f = await fixture(null, { movies, homeMetas: [] });
  const result = await refreshSmartShuffle({ clientId: 'fake', accessToken: 'fake',
    fetchImpl: f.fetchImpl, outputDirectory: f.outputDirectory, releaseStateFile: f.releaseStateFile,
    baseUrl: 'https://unit.test/account-2', rng: seededRandom });
  assert.equal(result.status.featured, 0);
  assert.equal(result.metas.length, 2);
  assert.ok(result.metas.every(meta => meta.poster.includes('btttr.cc') && !('releaseInfo' in meta)));
});
