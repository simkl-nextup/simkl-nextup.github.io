import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { composeMovieReleasePoster } from '../src/poster-tags.mjs';
import { loadPosterConfig } from '../src/poster-style.mjs';

const poster = await sharp({ create: { width: 500, height: 750, channels: 3,
  background: { r: 42, g: 69, b: 92 } } }).png().toBuffer();
const styles = await loadPosterConfig(new URL('../config/poster-style.json', import.meta.url));
const tags = { main: 'OCT 19', chip: 'DIGITAL + PHYSICAL', label: 'DIGITAL + PHYSICAL', released: true };

async function regionHash(buffer, { left, top, width, height }) {
  return sharp(buffer).extract({ left, top, width, height }).raw().toBuffer();
}

test('movie release poster renders at 500x750 using the real TV/anime shared tag primitives', async () => {
  const rendered = await composeMovieReleasePoster({ poster, tags, tvStyle: styles.tv, animeStyle: styles.anime });
  assert.deepEqual([ (await sharp(rendered).metadata()).width, (await sharp(rendered).metadata()).height ], [500, 750]);
  assert.notDeepEqual(await regionHash(rendered, { left: 160, top: 12, width: 150, height: 55 }),
    await regionHash(poster, { left: 160, top: 12, width: 150, height: 55 }));
  assert.notDeepEqual(await regionHash(rendered, { left: 0, top: 90, width: 150, height: 56 }),
    await regionHash(poster, { left: 0, top: 90, width: 150, height: 56 }));
  const originalBottom = await sharp(poster).extract({ left: 180, top: 620, width: 120, height: 70 }).stats();
  const renderedBottom = await sharp(rendered).extract({ left: 180, top: 620, width: 120, height: 70 }).stats();
  assert.ok(Math.abs(originalBottom.channels[0].mean - renderedBottom.channels[0].mean) < 4,
    'BetterPosters lower genre/rating area should remain the base image, not be replaced');
});

test('TV top-tab setting and anime side-chip setting independently change movie render', async () => {
  const standard = await composeMovieReleasePoster({ poster, tags, tvStyle: styles.tv, animeStyle: styles.anime });
  const tvVariant = await composeMovieReleasePoster({ poster, tags, tvStyle: { ...styles.tv, size: 'compact' }, animeStyle: styles.anime });
  const animeVariant = await composeMovieReleasePoster({ poster, tags, tvStyle: styles.tv, animeStyle: { ...styles.anime, size: 'compact' } });
  assert.notDeepEqual(await regionHash(standard, { left: 100, top: 0, width: 300, height: 80 }),
    await regionHash(tvVariant, { left: 100, top: 0, width: 300, height: 80 }));
  assert.notDeepEqual(await regionHash(standard, { left: 0, top: 85, width: 440, height: 65 }),
    await regionHash(animeVariant, { left: 0, top: 85, width: 440, height: 65 }));
});

test('long Coming Soon date fits within the TV top tag', async () => {
  const rendered = await composeMovieReleasePoster({ poster, tags: {
    main: 'COMING SOON · SEPT 30', chip: 'DIGITAL + PHYSICAL', released: false,
  }, tvStyle: styles.tv, animeStyle: styles.anime });
  assert.equal((await sharp(rendered).metadata()).width, 500);
});
