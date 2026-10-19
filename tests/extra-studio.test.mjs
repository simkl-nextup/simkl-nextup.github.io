import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Script } from 'node:vm';
import sharp from 'sharp';
import { POSTER_ACCOUNTS, normalizePosterConfig } from '../src/poster-style.mjs';
import { renderMoviePosters } from '../src/movie-posters.mjs';
import { writeReleaseStudio } from '../src/release-studio.mjs';

const now = new Date('2026-10-19T09:00:00Z');
const fakeImage = async () => sharp({create:{width:450,height:675,channels:3,background:'#2266aa'}}).jpeg().toBuffer();
function pictureFetch(source) {return async url => new Response(source, {status:200,headers:{'content-type':'image/jpeg'}});}
const makeEntry = (tags, id='tt9876543') => ({
  meta: {id, name:'Poster sample', type:'movie', poster:`https://btttr.cc/poster/imdb/poster-default/${id}.jpg?tag=none`},
  tmdbPoster:'https://image.tmdb.org/t/p/w500/sample.jpg', tags,
});

test('three extra Studio tabs can be styled individually without altering Anime/TV config', () => {
  const current = normalizePosterConfig({anime:{size:'compact', tagShadow:'none'},tv:{size:'large',contrast:'max'}});
  assert.equal(Object.keys(POSTER_ACCOUNTS).length, 5);
  assert.ok(['homeReleases','upcomingMovies','upcomingTV'].every(k=>POSTER_ACCOUNTS[k].movieTags));
  assert.equal(current.homeReleases.size,'large', 'movie tab starts with TV top-tag style');
  assert.equal(current.homeReleases.side.size,'compact','side tag starts with Anime dub style');
  const custom = normalizePosterConfig({
    anime:{size:'compact'},tv:{size:'large'},
    homeReleases:{size:'compact', contrast:'standard',side:{tagShadow:'none'}},
    upcomingMovies:{size:'large',tagShadow:'none'},
    upcomingTV:{size:'compact',contrast:'standard'},
  });
  assert.equal(custom.homeReleases.contrast,'standard');
  assert.equal(custom.upcomingMovies.tagShadow,'none');
  assert.equal(custom.upcomingTV.size,'compact');
  assert.equal(custom.anime.size,'compact');
  assert.equal(custom.tv.size,'large');
  assert.equal(custom.homeReleases.side.tagShadow,'none');
});

test('extra rows publish local untagged poster previews + tints, without secrets',async()=>{
  const out=await mkdtemp(path.join(os.tmpdir(),'studio-three-'));
  const bytes=await fakeImage();
  const tags={main:'S2 · NOV 18',chip:null,released:false,compactDate:false};
  const rendered=await renderMoviePosters([makeEntry(tags)],{
    outputDirectory:out, baseUrl:'https://example.github.io/account-2',
    fetchImpl:pictureFetch(bytes),tvStyle:{size:'compact'},animeStyle:{size:'large'},
    posterFolder:'upcoming-tv',studioSamples:6,
  });
  assert.equal(rendered.metas.length,1);
  assert.equal(rendered.studio.length,1);
  const sample=rendered.studio[0];
  assert.equal(sample.tags.main,'S2 · NOV 18');
  assert.equal(sample.tags.chip,null);
  assert.match(sample.poster,/^account-2\/studio\/base\/upcoming-tv\/base-[a-f0-9]{24}\.webp$/);
  const base=await stat(path.join(out,sample.poster.slice('account-2/'.length)));
  assert.ok(base.size>100);
  assert.match(sample.tints.max,/^#[a-fA-F0-9]{6}$/);
  await writeReleaseStudio({outputDirectory:out,account:'upcomingTV',samples:rendered.studio,generatedAt:now});
  const data=JSON.parse(await readFile(path.join(out,'studio','upcomingTV.json')));
  assert.equal(data.account,'upcomingTV');
  assert.equal(data.samples.length,1);
  assert.doesNotMatch(JSON.stringify(data), /authorization|api.key|access.token|secret/i);
  await assert.rejects(writeReleaseStudio({outputDirectory:out,account:'evil',samples:[],generatedAt:now}), /Invalid Studio row/);
});

test('Studio page loads three independent movie samples and exposes meaningful controls',async()=>{
  const html=await readFile(new URL('../assets/studio.html',import.meta.url),'utf8');
  const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(()=>new Script(script));
  for(const key of ['homeReleases','upcomingMovies','upcomingTV']) assert.match(script,new RegExp(key));
  assert.match(script,/section === "side"/);
  assert.match(script,/if \(accounts\[account\]\.movieTags\)/);
  assert.match(script,/sample\.tags\?\.chip/);
});
