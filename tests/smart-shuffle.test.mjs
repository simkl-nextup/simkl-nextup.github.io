import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {join} from 'node:path';
import { buildSmartEntries,interleaveSmartMovies,paginateSmartCatalog,SMART_SHUFFLE_ID } from '../src/smart-shuffle.mjs';
import { refreshSmartShuffle } from '../scripts/refresh-smart-shuffle.mjs';

const make = (n, date, category='recent') => ({meta:{id:`tt${1000000+n}`,name:`Movie ${n}`,type:'movie',poster:`https://btttr.cc/poster/imdb/poster-default/tt${1000000+n}.jpg?tag=none`},
  release:date?{released:category==='recent',firstHomeDate:date,sortDate:date}:null,tags:null});
const seededRandom=(limit)=>limit-1;

test('1 release + 2 randoms, no duplicates, featured stay chronologically sorted',()=>{
  const movies=[make(1,'2026-10-18'),make(2,null),make(3,'2026-10-17'),make(4,null),make(5,'2026-08-11'),make(6,null),make(7,null)];
  const {entries,featured,shuffled}=interleaveSmartMovies(movies,{now:new Date('2026-10-19T12:00:00Z'),rng:seededRandom});
  assert.deepEqual(entries.map(x=>x.meta.id),['tt1000001','tt1000002','tt1000004','tt1000003','tt1000006','tt1000007','tt1000005']);
  assert.equal(featured,3);assert.equal(shuffled,4);
  assert.equal(new Set(entries.map(x=>x.meta.id)).size,7);
});

test('old movies remain included, but are not prioritized; imminent home releases are featured',()=>{
  const movies=[make(1,'2026-01-01'),make(2,'2026-10-25','soon'),make(3,'2026-10-12'),make(4,null)];
  const {entries,featured}=interleaveSmartMovies(movies,{now:new Date('2026-10-19'),rng:seededRandom});
  assert.equal(featured,2);
  assert.deepEqual(entries.map(x=>x.meta.id),['tt1000003','tt1000001','tt1000004','tt1000002']);
});

test('if no releases, full list is shuffled; if no ordinary movies, releases remain',()=>{
  const {entries}=interleaveSmartMovies([make(1,null),make(2,null),make(3,null)],{rng:seededRandom});
  assert.equal(entries.length,3);
  assert.equal(new Set(entries.map(x=>x.meta.id)).size,3);
  assert.equal(interleaveSmartMovies([make(1,'2026-10-12'),make(2,'2026-10-13')],{now:new Date('2026-10-19')}).entries.length,2);
});

test('pagination preserves all titles with Stremio skip pages',()=>{
  const entries=Array.from({length:121},(_,i)=>({id:`tt${1000000+i}`}));
  const pages=paginateSmartCatalog(entries);
  assert.deepEqual(pages.map(p=>[p.skip,p.metas.length]),[[0,50],[50,50],[100,21]]);
  assert.deepEqual(pages.flatMap(p=>p.metas),entries);
});

test('old release tags retain year and verified unknowns have no misleading tag',()=>{
  const movies=[{status:'plantowatch',movie:{title:'Classic',ids:{simkl:11,imdb:'tt1234567'},poster:'1/xyz'}},
    {status:'plantowatch',movie:{title:'No date',ids:{simkl:12,imdb:'tt1234568'}}}];
  const cache={'11':{tmdb:{id:55,title:'Classic',release_dates:{results:[{iso_3166_1:'US',release_dates:[{type:4,release_date:'2018-09-02T00:00:00Z'}]}]}}},'12':{tmdb:null}};
  const {entries}=buildSmartEntries(movies,cache,{now:new Date('2026-10-19')});
  assert.equal(entries[0].tags.main,"SEP 2 '18");
  assert.equal(entries[1].tags,null);
  assert.equal(entries[1].meta.id,'tt1234568');
});

test('end-to-end fifth catalog preserves first four, status and existing metadata; publishes 3 pages',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'smart-shuffle-'));
  const outputDirectory=join(temp,'public/account-2');
  const releaseStateFile=join(temp,'state/movie.json');
  await mkdir(join(outputDirectory,'catalog','movie'),{recursive:true});
  await mkdir(join(outputDirectory,'meta','movie'),{recursive:true});
  await mkdir(path.dirname(releaseStateFile),{recursive:true});
  const ids=['simkl-new-tv-episodes-account2','simkl-plan-to-watch-home-releases-account2','global-upcoming-movies','global-upcoming-tv'];
  const manifest={id:'community.simkl.new-tv-episodes.account2',types:['series','movie'],idPrefixes:['tt','tmdb:'],catalogs:ids.map((id,i)=>({type:i===0||i===3?'series':'movie',id,name:id}))};
  const status={old:'original',discovery:{foo:1},movieRow:{bar:2}};
  await writeFile(join(outputDirectory,'manifest.json'),JSON.stringify(manifest));
  await writeFile(join(outputDirectory,'status.json'),JSON.stringify(status));
  const originalMeta={meta:{type:'movie',id:'tt1000001',videos:[{id:'existing',season:1,episode:1}]}};
  await writeFile(join(outputDirectory,'meta/movie/tt1000001.json'),JSON.stringify(originalMeta));
  const movies=Array.from({length:107},(_,i)=>({status:'plantowatch',movie:{title:`Film ${i}`,ids:{simkl:i+1,imdb:`tt${1000001+i}`}}}));
  const cache=Object.fromEntries(movies.map((movie,i)=>[String(i+1),{tmdb:null,fetchedAt:'2026-10-19T00:00:00Z'}]));
  await writeFile(releaseStateFile,JSON.stringify({movies:cache}));
  const fetchImpl=async (url)=>{assert.match(String(url),/api.simkl.com/);return {ok:true,json:async()=>({movies})};};
  const result=await refreshSmartShuffle({clientId:'fake',accessToken:'fake',fetchImpl,outputDirectory,releaseStateFile,baseUrl:'https://unit.test/account-2',rng:seededRandom});
  assert.equal(result.metas.length,107);
  const updated=JSON.parse(await readFile(join(outputDirectory,'manifest.json')));
  assert.deepEqual(updated.catalogs.slice(0,4),manifest.catalogs);
  assert.equal(updated.catalogs[4].id,SMART_SHUFFLE_ID);
  assert.equal(updated.catalogs[4].extra[0].name,'skip');
  const base=JSON.parse(await readFile(join(outputDirectory,`catalog/movie/${SMART_SHUFFLE_ID}.json`)));
  const pages=await Promise.all([0,50,100,150].map(async skip=>JSON.parse(await readFile(join(outputDirectory,`catalog/movie/${SMART_SHUFFLE_ID}/skip=${skip}.json`)))));
  assert.deepEqual(base,pages[0]);
  assert.deepEqual(pages.map(p=>p.metas.length),[50,50,7,0]);
  assert.equal(new Set(pages.flatMap(p=>p.metas.map(x=>x.id))).size,107);
  assert.deepEqual(JSON.parse(await readFile(join(outputDirectory,'meta/movie/tt1000001.json'))),originalMeta);
  const updatedStatus=JSON.parse(await readFile(join(outputDirectory,'status.json')));
  assert.equal(updatedStatus.old,'original');
  assert.deepEqual(updatedStatus.discovery,status.discovery);
  assert.deepEqual(updatedStatus.movieRow,status.movieRow);
  assert.equal(updatedStatus.smartShuffle.published,107);
});

test('released poster in fifth row uses the established TV/anime style and separate folder',async()=>{
  const sharp=(await import('sharp')).default;
  const temp=await mkdtemp(join(tmpdir(),'smart-shuffle-poster-'));
  const outputDirectory=join(temp,'public/account-2');
  const releaseStateFile=join(temp,'state/movie.json');
  await mkdir(outputDirectory,{recursive:true});
  await mkdir(path.dirname(releaseStateFile),{recursive:true});
  const baseIds=['simkl-new-tv-episodes-account2','simkl-plan-to-watch-home-releases-account2','global-upcoming-movies','global-upcoming-tv'];
  const catalogNames=baseIds.map((id,i)=>({type:i===0||i===3?'series':'movie',id}));
  await writeFile(join(outputDirectory,'manifest.json'),JSON.stringify({id:'community.simkl.new-tv-episodes.account2',catalogs:catalogNames,types:['movie','series'],idPrefixes:['tt','tmdb:']}));
  await writeFile(join(outputDirectory,'status.json'),JSON.stringify({movieRow:{},discovery:{}}));
  const tmdb={id:500,title:'Recent Movie',imdb_id:'tt1234567',poster_path:'/recent.jpg',release_dates:{results:[{
    iso_3166_1:'US',release_dates:[{type:4,release_date:'2026-10-14T00:00:00Z'}]
  }]}};
  await writeFile(releaseStateFile,JSON.stringify({movies:{1:{fetchedAt:'2026-10-19T00:00:00Z',tmdb}}}));
  const image=await sharp({create:{width:500,height:750,channels:3,background:{r:50,g:120,b:180}}}).png().toBuffer();
  const fetchImpl=async(url)=>String(url).includes('api.simkl.com')
    ? {ok:true,json:async()=>({movies:[{status:'plantowatch',movie:{title:'Recent Movie',ids:{simkl:1,imdb:'tt1234567'}}}]})}
    : {ok:true,url:String(url),headers:{get:()=>null},arrayBuffer:async()=>image};
  const result=await refreshSmartShuffle({clientId:'fake',accessToken:'fake',fetchImpl,outputDirectory,releaseStateFile,
    baseUrl:'https://unit.test/account-2'});
  assert.equal(result.status.featured,1);
  assert.match(result.metas[0].poster,/\/posters\/smart-shuffle\/[0-9a-f]{24}\.webp$/);
  const filename=result.metas[0].poster.split('/').at(-1);
  const poster=await readFile(join(outputDirectory,'posters/smart-shuffle',filename));
  assert.equal((await sharp(poster).metadata()).height,750);
  assert.equal((await sharp(poster).metadata()).width,500);
});
