import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const smartId = 'simkl-movies-smart-shuffle-account2';
const tvId = 'simkl-new-tv-episodes-account2';
const ids = [tvId, 'simkl-plan-to-watch-home-releases-account2',
  'global-upcoming-movies', 'global-upcoming-tv', smartId];
const save = (file, content) => writeFile(file, `${JSON.stringify(content)}\n`);

async function buildFixture(t, count) {
  const temp = await mkdtemp(path.join(root, 'tmp-smart-verifier-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const dir = path.join(temp, 'account-2');
  const catDir = path.join(dir, 'catalog', 'movie');
  const pagesDir = path.join(catDir, smartId);
  const metaDir = path.join(dir, 'meta', 'movie');
  await mkdir(pagesDir, { recursive: true });
  await mkdir(metaDir, { recursive: true });
  await mkdir(path.join(dir, 'catalog', 'series'), { recursive: true });
  const manifest = {
    id: 'community.simkl.new-tv-episodes.account2',
    version: '1.15.0', resources: ['catalog', 'meta'], types: ['series', 'movie'],
    idPrefixes: ['simkl-tvdb-unified:', 'tt', 'tmdb:', 'simkl:'],
    catalogs: ids.map((id, i) => ({ type: [0, 3].includes(i) ? 'series' : 'movie', id, name: id })),
  };
  const metas = Array.from({ length: count }, (_, i) => ({
    id: `tt${1000000 + i}`, name: `Movie ${i}`, type: 'movie',
    poster: `https://example.org/poster/${i}.jpg`,
  }));
  const pageSize = 50;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  await save(path.join(dir, 'manifest.json'), manifest);
  await save(path.join(dir, 'status.json'), { mediaType: 'tv', smartShuffle: {
    published: count, featured: Math.min(5, count), random: count - Math.min(5, count),
    pages, pageSize,
  } });
  await save(path.join(dir, 'catalog', 'series', `${tvId}.json`), { metas: [] });
  await writeFile(path.join(dir, 'setup.html'), '<script type="module">const setup = true;</script>');
  await save(path.join(catDir, `${smartId}.json`), { metas });
  for (let skip = 0; skip < Math.max(1, count); skip += pageSize) {
    await save(path.join(pagesDir, `skip=${skip}.json`), { metas: metas.slice(skip, skip + pageSize) });
  }
  await save(path.join(pagesDir, `skip=${Math.ceil(count / pageSize) * pageSize}.json`), { metas: [] });
  for (const meta of metas) await save(path.join(metaDir, `${meta.id}.json`), { meta });
  return { dir, manifest, metas, pagesDir, catDir };
}

function runVerifier(dir) {
  return spawnSync(process.execPath, ['scripts/verify-output.mjs'], {
    cwd: root, encoding: 'utf8',
    env: {
      ...process.env, OUTPUT_DIRECTORY: path.relative(root, dir),
      CATALOG_ID: tvId, ADDON_ID: 'community.simkl.new-tv-episodes.account2',
      MEDIA_TYPE: 'tv', VERIFY_SMART_SHUFFLE: 'true',
      VERIFY_MOVIE_ROW: 'false', VERIFY_DISCOVERY: 'false',
      SIMKL_ACCESS_TOKEN: '', SIMKL_ACCESS_TOKEN_2: '', TMDB_READ_ACCESS_TOKEN: '',
      MDBLIST_API_KEY: '', TVDB_API_KEY: '', TVDB_SUBSCRIBER_PIN: '',
      ANIMESCHEDULE_TOKEN: '',
    },
  });
}

test('production verifier accepts 31 movies without a skip declaration in the manifest', async t => {
  const f = await buildFixture(t, 31);
  const result = runVerifier(f.dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /31 movies available in a standard catalog/);
});

test('production verifier accepts the full 107-movie catalog and checks optional pages', async t => {
  const f = await buildFixture(t, 107);
  const result = runVerifier(f.dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /107 movies available in a standard catalog/);
});

test('production verifier rejects a Smart Shuffle page that differs from the full catalog', async t => {
  const f = await buildFixture(t, 107);
  await save(path.join(f.pagesDir, 'skip=50.json'), { metas: f.metas.slice(0, 50) });
  const result = runVerifier(f.dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /skip=50 differs from base catalog/);
});

test('production verifier rejects manifest skip extras to maintain Nuvio plain-catalog compatibility', async t => {
  const f = await buildFixture(t, 31);
  const manifest = JSON.parse(await readFile(path.join(f.dir, 'manifest.json'), 'utf8'));
  manifest.catalogs[4].extra = [{ name: 'skip', isRequired: false }];
  await save(path.join(f.dir, 'manifest.json'), manifest);
  const result = runVerifier(f.dir);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /expected a plain movie catalog/);
});

test('production verifier supports empty watchlists without inventing movies', async t => {
  const f = await buildFixture(t, 0);
  const result = runVerifier(f.dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0 movies available in a standard catalog/);
});
