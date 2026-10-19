import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { refreshMovieRow } from '../scripts/refresh-movies.mjs';

const rel = (type, date) => ({ type, release_date: `${date}T00:00:00.000Z` });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'simkl-movie-release-'));
  const output = path.join(root, 'account-2');
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify({
    id: 'community.simkl.new-tv-episodes.account2', types: ['series'], resources: ['catalog', 'meta'],
    idPrefixes: ['tt', 'simkl-tvdb-unified:', 'tmdb:'],
    description: 'TV', catalogs: [{ id: 'simkl-new-tv-episodes-account2', type: 'series', name: 'TV' }],
  }));
  await writeFile(path.join(output, 'status.json'), JSON.stringify({ mediaType: 'tv', catalogItems: 1 }));
  return { root, output };
}

const response = (data, contentType = 'application/json') => new Response(
  contentType === 'application/json' ? JSON.stringify(data) : data,
  { status: 200, headers: { 'Content-Type': contentType } },
);

test('refresh appends movies to existing TV addon and renders BetterPosters with local overlays', async () => {
  const { root, output } = await fixture();
  try {
    const image = await sharp({ create: { width: 500, height: 750, channels: 3, background: '#192634' } }).jpeg().toBuffer();
    const called = [];
    const fetchImpl = async (url) => {
      const str = String(url); called.push(str);
      if (str.includes('/sync/all-items/movies/plantowatch')) return response({ movies: [
        { status: 'plantowatch', movie: { title: 'Example Film', ids: { simkl: 42, tmdb: 2020, imdb: 'tt1234567' } } },
      ] });
      if (str.includes('/3/movie/2020')) return response({ id: 2020, title: 'Example Film', imdb_id: 'tt1234567',
        poster_path: '/poster.jpg', overview: 'A movie.', release_dates: { results: [
          { iso_3166_1: 'US', release_dates: [rel(3, '2026-08-01'), rel(4, '2026-10-19')] },
        ] },
      });
      if (str.includes('/poster/imdb/')) return response(image, 'image/jpeg');
      throw new Error(`Unexpected request: ${str}`);
    };
    const result = await refreshMovieRow({ clientId: 'client', accessToken: 'private-token', tmdbToken: 'private-tmdb',
      now: new Date('2026-10-19T12:00:00Z'), outputDirectory: output,
      stateFile: path.join(root, 'movie-cache.json'), baseUrl: 'https://test.github.io/account-2', fetchImpl });
    assert.equal(result.movies.length, 1);
    assert.equal(result.status.released, 1);
    assert.match(result.movies[0].poster, /^https:\/\/test\.github\.io\/account-2\/posters\/movie-releases\//);
    const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.types, ['series', 'movie']);
    assert.equal(manifest.catalogs.length, 2);
    const stored = JSON.parse(await readFile(path.join(output, 'catalog/movie/simkl-plan-to-watch-home-releases-account2.json'), 'utf8'));
    assert.equal(stored.metas[0].id, 'tt1234567');
    const detail = JSON.parse(await readFile(path.join(output, 'meta/movie/tt1234567.json'), 'utf8'));
    assert.equal(detail.meta.type, 'movie');
    assert.ok(called.some((url) => url.includes('tag=none')));
    assert.ok(!JSON.stringify(manifest).includes('private-token'));
    assert.ok(!JSON.stringify(stored).includes('private-tmdb'));
    const originalCalls = called.length;
    await refreshMovieRow({ clientId: 'client', accessToken: 'private-token', tmdbToken: 'private-tmdb',
      now: new Date('2026-10-19T13:00:00Z'), outputDirectory: output,
      stateFile: path.join(root, 'movie-cache.json'), baseUrl: 'https://test.github.io/account-2', fetchImpl });
    assert.equal(called.slice(originalCalls).filter((url) => url.includes('/3/movie/2020')).length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('invalid TMDB credential cannot silently deploy an empty row', async () => {
  const { root, output } = await fixture();
  try {
    await assert.rejects(() => refreshMovieRow({ clientId: 'a', accessToken: 'b', tmdbToken: '', outputDirectory: output,
      stateFile: path.join(root, 'cache.json'), baseUrl: 'https://test.github.io/account-2' }), /TMDB_READ_ACCESS_TOKEN/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a failed BetterPosters request falls back to TMDB image and still overlays release tags', async () => {
  const { renderMoviePosters } = await import('../src/movie-posters.mjs');
  const { root, output } = await fixture();
  try {
    const image = await sharp({ create: { width: 500, height: 750, channels: 3, background: '#e7e5e3' } }).jpeg().toBuffer();
    const poster = 'https://btttr.cc/poster/imdb/poster-default/tt1234567.jpg?tag=none';
    const tmdbPoster = 'https://image.tmdb.org/t/p/w500/poster.jpg';
    const fetchImpl = async (url) => String(url) === poster
      ? new Response('unavailable', { status: 503 })
      : response(image, 'image/jpeg');
    const result = await renderMoviePosters([{
      meta: { id: 'tt1234567', type: 'movie', name: 'Example Film', poster },
      tmdbPoster,
      tags: { main: 'OUT OCT 19', sub: 'DIGITAL OUT', chip: 'DIGITAL', label: 'DIGITAL OUT' },
    }], { outputDirectory: output, baseUrl: 'https://test.github.io/account-2', fetchImpl });
    assert.equal(result.metas.length, 1);
    assert.equal(result.warnings.length, 1);
    const filename = result.metas[0].poster.split('/').pop();
    const file = path.join(output, 'posters/movie-releases', filename);
    const img = await sharp(file).extract({ left: 50, top: 20, width: 10, height: 10 }).stats();
    assert.ok(img.channels[0].mean < 200, 'the dark top tab must overlay the bright fallback poster');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('empty Simkl Plan to Watch produces an empty second row without deleting TV', async () => {
  const { root, output } = await fixture();
  try {
    const fetchImpl = async () => response({ movies: [] });
    const result = await refreshMovieRow({ clientId: 'client', accessToken: 'secret', tmdbToken: 'tmdb-secret',
      now: new Date('2026-10-19T12:00:00Z'), outputDirectory: output,
      stateFile: path.join(root, 'cache.json'), baseUrl: 'https://test.github.io/account-2', fetchImpl });
    assert.equal(result.movies.length, 0);
    const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
    assert.equal(manifest.catalogs.length, 2);
    assert.equal(manifest.catalogs[0].id, 'simkl-new-tv-episodes-account2');
  } finally { await rm(root, { recursive: true, force: true }); }
});
