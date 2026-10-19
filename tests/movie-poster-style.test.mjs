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


async function meanRed(buffer, region) {
  const { data, info } = await sharp(buffer).extract(region).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let red = 0;
  for (let i = 0; i < data.length; i += info.channels) red += data[i];
  return red / (data.length / info.channels);
}

test('short released-date tabs are slimmer than Coming Soon tabs', async () => {
  const short = await composeMovieReleasePoster({ poster, tags: {
    main: 'OCT 6', chip: 'DIGITAL', released: true,
  }, tvStyle: styles.tv, animeStyle: styles.anime });
  const future = await composeMovieReleasePoster({ poster, tags: {
    main: 'COMING SOON · OCT 20', chip: 'DIGITAL', released: false,
  }, tvStyle: styles.tv, animeStyle: styles.anime });
  // Below the small 56px date tab only its subtle shadow remains, while
  // the full-height (78px) Coming Soon tab still occupies the same area.
  const region = { left: 245, top: 69, width: 10, height: 4 };
  assert.ok((await meanRed(future, region)) - (await meanRed(short, region)) > 10,
    'the short date should not use the old full-height rectangular tab');
  assert.equal((await sharp(short).metadata()).height, 750);
  assert.equal((await sharp(future).metadata()).height, 750);
});

test('a normal anime episode top tab retains its original height', async () => {
  const { composeTaggedPoster } = await import('../src/poster-tags.mjs');
  const badge = { status: 'plantowatch', tags: { aired: 3, airedSeason: 1 }, score: '8.0' };
  const standard = await composeTaggedPoster({ poster, name: 'Test', badge, style: styles.anime });
  assert.equal((await sharp(standard).metadata()).width, 500);
  const region = { left: 245, top: 69, width: 10, height: 4 };
  assert.ok((await meanRed(standard, region)) > 48,
    'regular anime and TV tag geometry must remain unchanged');
});

test('upcoming TV premieres show colored new-series / new-season chips and never a literal null chip', async () => {
  const tvStyle = styles.upcomingTV;
  const animeStyle = styles.upcomingTV.side;
  const base = { main: 'S2 · OCT 25', released: false };
  const render = (chip, chipTone) => composeMovieReleasePoster({
    poster, tags: { ...base, chip, chipTone }, tvStyle, animeStyle,
  });
  const [series, season, none] = await Promise.all([
    render('NEW SERIES', 'newSeries'), render('NEW SEASON', 'newSeason'), render(null, null),
  ]);
  const pixel = (buf) => sharp(buf).extract({ left: 4, top: 110, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  const [sColor, pColor, missingColor] = await Promise.all([pixel(series), pixel(season), pixel(none)]);
  assert.notDeepEqual(sColor, pColor, 'series and returning-season chips must be distinctly color coded');
  assert.ok(sColor[1] > sColor[0] && sColor[1] > sColor[2], 'new series chip should be teal/green');
  assert.ok(pColor[2] > pColor[1], 'new season chip should be purple');
  assert.ok([...missingColor].every((x, i) => Math.abs(x - [42, 69, 92][i]) <= 3),
    'absent chip must leave the poster background visible (no "null")');
});
