import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildUpcomingShows,buildUpcomingMovies } from '../src/discovery.mjs';
import { addPersonalNextTags } from '../scripts/refresh-discovery.mjs';
import { discoveryBadge } from '../src/discovery-posters.mjs';
import { composeTaggedPoster, STATUS_TAGS, contrast,inkFor } from '../src/poster-tags.mjs';
import { normalizePosterConfig } from '../src/poster-style.mjs';
const now=new Date('2026-10-19T12:00:00Z');
const overview='An acclaimed international thriller returning with a new season and unexpected revelations.';
const tv={id:5432,name:'The Sample',poster_path:'/a.jpg',overview,first_air_date:'2022-08-01',popularity:40,vote_average:8.2,vote_count:51,external_ids:{imdb_id:'tt5432123'}};
test('only eligible returning shows in Account 2 Watching or Plan to Watch receive NEXT',()=>{
 const entries=buildUpcomingShows([
  {tmdb:tv,season:2,date:'2026-10-24',imdb:'tt5432123'},
  {tmdb:{...tv,id:5433,name:'New Series'},season:1,date:'2026-10-24'},
 ],now);
 const tracked={items:{x:{status:'plantowatch',show:{title:'The Sample',ids:{imdb:'tt5432123'}}}}};
 const matched=addPersonalNextTags(entries,tracked);
 assert.ok(matched.find(e=>e.meta.id==='tt5432123').tags.next);
 assert.ok(!matched.find(e=>e.tags.statusKey==='newSeries').tags.next);
 assert.equal(discoveryBadge(matched.find(e=>e.meta.id==='tt5432123'),normalizePosterConfig({}).upcomingTV).nextLabel,'NEXT');
 assert.equal(discoveryBadge(matched.find(e=>e.meta.id==='tt5432123'),{showNext:false}).nextLabel,null);
 const wrongStatus={items:{x:{status:'completed',show:{title:'The Sample',ids:{imdb:'tt5432123'}}}}};
 assert.ok(!addPersonalNextTags(entries,wrongStatus).find(e=>e.meta.id==='tt5432123').tags.next);
});
test('custom upcoming poster status colours and date tabs render with Up Next poster engine',async()=>{
 const poster=await sharp({create:{width:500,height:750,channels:3,background:'#4b5975'}}).png().toBuffer();
 const entries=buildUpcomingShows([{tmdb:tv,season:3,date:'2026-10-25',imdb:'tt5432123'}],now);
 const entry=addPersonalNextTags(entries,{items:{x:{status:'watching',show:{title:'The Sample',ids:{imdb:'tt5432123'}}}}})[0];
 const style=normalizePosterConfig({upcomingTV:{statusColours:{returning:'#3923A0'},showNext:true}}).upcomingTV;
 const badge=discoveryBadge(entry,style);
 assert.equal(badge.status,'discoveryReturning');
 assert.equal(badge.statusFill,'#3923A0');
 assert.equal(badge.topLabel,'OCT 25');
 assert.equal(badge.nextLabel,'NEXT');
 const image=await composeTaggedPoster({poster,name:'The Sample',badge,style});
 const metadata=await sharp(image).metadata();
 assert.equal(metadata.width,500);assert.equal(metadata.height,750);
 assert.ok(image.length>3000);
});
test('upcoming movie status tags require no BetterPosters and have sufficiently contrasting defaults',()=>{
 const candidate={id:88,title:'Test Film',poster_path:'/poster.jpg',overview,popularity:25,
  release_dates:{results:[{iso_3166_1:'US',release_dates:[{type:2,release_date:'2026-10-28T00:00:00Z'}]}]}};
 const [entry]=buildUpcomingMovies([candidate],now);
 assert.equal(entry.tags.statusKey,'limited');
 assert.ok(entry.meta.poster.includes('image.tmdb.org'));
 assert.ok(!entry.meta.poster.includes('btttr.cc'));
 for(const status of Object.values(STATUS_TAGS)) assert.ok(contrast(status.fill,inkFor(status.fill))>=4.5);
});
test('Studio script parses and exposes upcoming-color and NEXT controls without removing existing row tabs',async()=>{
 const html=await readFile(new URL('../assets/studio.html',import.meta.url),'utf8');
 const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(js);new vm.Script(js);
 for(const token of ['upcomingTV','upcomingMovies','statusColours','showNext','renderDiscoveryCard','homeReleases'])assert.ok(js.includes(token));
});
