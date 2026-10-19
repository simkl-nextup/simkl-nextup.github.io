import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHomeReleases, buildMovieCatalog, formatMovieDate, movieTags, COMING_SOON_DAYS } from '../src/movie-releases.mjs';

const TODAY = new Date('2026-10-19T12:00:00Z');
const release = (country, entries) => ({ iso_3166_1: country, release_dates: entries.map(([type, date]) => ({ type, release_date: `${date}T00:00:00.000Z` })) });
const data = (...regions) => ({ results: regions });
const movie = (simklId, releases, extra = {}) => ({
  simklId, title: `Movie ${simklId}`, status: 'plantowatch',
  ids: { imdb: `tt${String(simklId).padStart(7, '0')}` },
  tmdb: { id: Number(simklId), imdb_id: `tt${String(simklId).padStart(7, '0')}`, title: `Movie ${simklId}`, poster_path: '/poster.jpg', release_dates: releases, ...extra },
});

test('release types 2 and 3 (theatrical) never qualify', () => {
  assert.equal(classifyHomeReleases(data(release('US', [[2, '2026-10-01'], [3, '2026-10-03']])), { now: TODAY }), null);
});
test('no known home release stays hidden', () => {
  assert.equal(classifyHomeReleases(data(), { now: TODAY }), null);
});
test('digital five months away is hidden even if theaters opened today', () => {
  assert.equal(classifyHomeReleases(data(release('US', [[3, '2026-10-19'], [4, '2027-03-19']])), { now: TODAY }), null);
});
test('30 days before a known digital home release is Coming Soon', () => {
  const result = classifyHomeReleases(data(release('US', [[4, '2026-11-18']])), { now: TODAY });
  assert.equal(result.released, false);
  assert.equal(result.digital.date, '2026-11-18');
  assert.equal(movieTags(result).label, 'COMING SOON');
  assert.equal(movieTags(result).main, 'COMING SOON · NOV 18');
  assert.equal(COMING_SOON_DAYS, 30);
});
test('31 days before remains hidden', () => {
  assert.equal(classifyHomeReleases(data(release('US', [[4, '2026-11-19']])), { now: TODAY }), null);
});
test('anywhere counts when US release is still months away', () => {
  const result = classifyHomeReleases(data(
    release('US', [[4, '2027-02-01']]),
    release('FR', [[4, '2026-10-18']]),
  ), { now: TODAY });
  assert.equal(result.released, true);
  assert.equal(result.digital.country, 'FR');
  assert.equal(movieTags(result).label, 'DIGITAL OUT');
});
test('US published date takes precedence if already released in US', () => {
  const result = classifyHomeReleases(data(
    release('FR', [[4, '2026-10-17']]),
    release('US', [[4, '2026-10-19']]),
  ), { now: TODAY });
  assert.equal(result.digital.country, 'US');
  assert.equal(result.event.date, '2026-10-19');
});
test('release date of today is considered released', () => {
  const result = classifyHomeReleases(data(release('US', [[5, '2026-10-19']])), { now: TODAY });
  assert.equal(result.released, true);
  assert.equal(movieTags(result).chip, 'PHYSICAL');
});
test('digital release followed by physical Coming Soon stays released', () => {
  const result = classifyHomeReleases(data(release('US', [[4, '2026-10-01'], [5, '2026-11-01']])), { now: TODAY });
  assert.equal(result.released, true);
  assert.equal(movieTags(result).main, 'OCT 1');
  assert.equal(movieTags(result).chip, 'DIGITAL');
});
test('physical release later bumps the same movie with both-format tag', () => {
  const result = classifyHomeReleases(data(release('US', [[4, '2026-09-15'], [5, '2026-10-19']])), { now: TODAY });
  assert.equal(result.released, true);
  assert.equal(result.sortDate, '2026-10-19');
  assert.equal(movieTags(result).label, 'DIGITAL + PHYSICAL');
  assert.equal(movieTags(result).main, 'OCT 19');
  assert.equal(movieTags(result).chip, 'DIGITAL + PHYSICAL');
});
test('date is formatted independent of machine timezone', () => {
  assert.equal(formatMovieDate('2026-01-01'), 'JAN 1');
});
test('released first sorted by actual release, coming soon follows nearest date', () => {
  const catalog = buildMovieCatalog([
    movie('1001', data(release('US', [[4, '2026-08-01']]))),
    movie('1002', data(release('US', [[4, '2026-10-25']]))),
    movie('1003', data(release('US', [[4, '2026-10-18']]))),
    movie('1004', data(release('US', [[5, '2026-11-16']]))),
    movie('1005', data(release('US', [[3, '2026-10-18']]))),
  ], { now: TODAY });
  assert.deepEqual(catalog.map((e) => e.meta.name), ['Movie 1003', 'Movie 1001', 'Movie 1002', 'Movie 1004']);
  assert.ok(catalog.every((e) => e.meta.type === 'movie'));
});
test('adding an already released movie does not give it a new sort date', () => {
  const catalog = buildMovieCatalog([
    movie('1001', data(release('US', [[4, '2024-01-01']]))),
    movie('1002', data(release('US', [[5, '2026-10-18']]))),
  ], { now: TODAY });
  assert.equal(catalog[0].meta.name, 'Movie 1002');
  assert.equal(catalog.length, 1, 'old releases must disappear, not merely sort behind newer ones');
});
test('Completed/watched movies are excluded', () => {
  const catalog = buildMovieCatalog([movie('1001', data(release('US', [[4, '2026-10-18']])), { status: 'completed' })], { now: TODAY });
  // Test explicit status; passing status in TMDB extra cannot override source status.
  assert.equal(catalog.length, 1);
  assert.equal(buildMovieCatalog([{ ...movie('1001', data(release('US', [[4, '2026-10-18']]))), status: 'completed' }], { now: TODAY }).length, 0);
});
test('movie without IMDb uses tmdb id and fallback poster', () => {
  const record = movie('1001', data(release('US', [[4, '2026-10-18']])));
  record.ids = {};
  record.tmdb.imdb_id = null;
  const catalog = buildMovieCatalog([record], { now: TODAY });
  assert.equal(catalog[0].meta.id, 'tmdb:1001');
  assert.match(catalog[0].meta.poster, /image\.tmdb\.org/);
});


test('movie initially released before six-calendar-month cutoff is excluded', () => {
  assert.equal(classifyHomeReleases(data(release('US', [[4, '2026-04-18']])), { now: TODAY }), null);
  assert.equal(classifyHomeReleases(data(release('US', [[4, '2026-04-19']])), { now: TODAY })?.released, true);
});

test('physical reissues do not resurrect old digital films', () => {
  const result = classifyHomeReleases(data(
    release('FR', [[4, '2002-11-01']]),
    release('US', [[4, '2003-03-01'], [5, '2026-10-18']]),
  ), { now: TODAY });
  assert.equal(result, null);
});

test('US priority does not override the worldwide first-availability cutoff', () => {
  assert.equal(classifyHomeReleases(data(
    release('JP', [[4, '2026-03-01']]),
    release('US', [[4, '2026-10-01']]),
  ), { now: TODAY }), null);
});

test('six months are calendar months, including end-of-month dates', () => {
  const now = new Date('2026-08-31T12:00:00Z');
  assert.equal(classifyHomeReleases(data(release('US', [[4, '2026-02-27']])), { now }), null);
  assert.equal(classifyHomeReleases(data(release('US', [[4, '2026-02-28']])), { now })?.released, true);
});

test('Coming Soon does not resurrect an old film with a new upcoming physical release', () => {
  assert.equal(classifyHomeReleases(data(release('US', [[4, '2025-10-01'], [5, '2026-11-01']])), { now: TODAY }), null);
});

test('newly available film is bumped when its second format releases', () => {
  const before = classifyHomeReleases(data(release('US', [[4, '2026-10-01'], [5, '2026-10-20']])), { now: TODAY });
  assert.equal(before.sortDate, '2026-10-01');
  const after = classifyHomeReleases(data(release('US', [[4, '2026-10-01'], [5, '2026-10-20']])), { now: new Date('2026-10-20T00:00:00Z') });
  assert.equal(after.sortDate, '2026-10-20');
  assert.equal(movieTags(after).chip, 'DIGITAL + PHYSICAL');
});


test('simultaneous upcoming digital and physical dates produce a combined dub-style chip', () => {
  const result = classifyHomeReleases(data(release('US', [[4, '2026-10-25'], [5, '2026-10-25']])), { now: TODAY });
  assert.equal(movieTags(result).chip, 'DIGITAL + PHYSICAL');
  assert.equal(movieTags(result).main, 'COMING SOON · OCT 25');
});
