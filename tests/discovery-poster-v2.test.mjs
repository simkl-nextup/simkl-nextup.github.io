import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildUpcomingShows,buildUpcomingMovies } from '../src/discovery.mjs';
import { addPersonalNextTags } from '../scripts/refresh-discovery.mjs';
import { discoveryBadge, upcomingTvTopLabel } from '../src/discovery-posters.mjs';
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
 assert.ok(!matched.find(e=>e.meta.id==='tt5432123').tags.next,'unverified NEXT must not be rendered');
 assert.ok(!matched.find(e=>e.tags.statusKey==='newSeries').tags.next);
 assert.equal(discoveryBadge(matched.find(e=>e.meta.id==='tt5432123'),normalizePosterConfig({}).upcomingTV).topLabel,'S2 · OCT 24');
 assert.equal(discoveryBadge(matched.find(e=>e.meta.id==='tt5432123'),normalizePosterConfig({}).upcomingTV).nextLabel,null);
 assert.equal(discoveryBadge(matched.find(e=>e.meta.id==='tt5432123'),{showNext:false}).topLabel,'S2 · OCT 24');
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
 assert.equal(badge.topLabel,'S3 · OCT 25');
 assert.equal(badge.nextLabel,null);
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

test('NEXT is placed inside the top tab using real Simkl episode numbers, including earlier seasons',()=>{
 const entries=buildUpcomingShows([{tmdb:tv,season:3,date:'2026-11-02',imdb:'tt5432123'}],now);
 const tracked={items:{a:{status:'watching',show:{title:'The Sample',ids:{imdb:'tt5432123'}},
   next_to_watch_info:{season:3,episode:2}}}};
 const own=addPersonalNextTags(entries,tracked)[0];
 assert.equal(own.tags.nextEpisode,2);
 assert.equal(discoveryBadge(own,{showNext:true}).topLabel,'S3 · NOV 2 · Next E2');
 assert.equal(discoveryBadge(own,{showNext:false}).topLabel,'S3 · NOV 2');
 assert.equal(discoveryBadge(own,{showNext:true}).nextLabel,null);
 const behind=addPersonalNextTags(entries,{items:{a:{status:'watching',show:{title:'The Sample',ids:{imdb:'tt5432123'}},
    next_to_watch_info:{season:1,episode:4}}}})[0];
 assert.equal(discoveryBadge(behind).topLabel,'S3 · NOV 2 · Next S1E4');
 assert.equal(upcomingTvTopLabel({...own.tags,next:false}),'S3 · NOV 2');
 assert.equal(own.tags.main,'S3 · NOV 2','source discovery date label stays stable');
});


test('tracked returning shows use an authoritative TV Up Next default video when Simkl omits next_to_watch_info',()=>{
 const entries=buildUpcomingShows([{tmdb:tv,season:3,date:'2026-11-02',imdb:'tt5432123'}],now);
 const state={items:{one:{status:'watching',show:{title:'The Sample',ids:{imdb:'tt5432123'}}}}};
 const catalog={metas:[{id:'tt5432123',name:'The Sample',behaviorHints:{defaultVideoId:'tt5432123:2:8'}}]};
 const result=addPersonalNextTags(entries,state,catalog)[0];
 assert.equal(discoveryBadge(result).topLabel,'S3 · NOV 2 · Next S2E8');
 assert.equal(addPersonalNextTags(entries,state,{metas:[]})[0].tags.next,false);
});

test('tracked shows use the actual TVDB next episode by cumulative count when Simkl omits NEXT',()=>{
 const entries=buildUpcomingShows([{tmdb:tv,season:3,date:'2026-11-02',imdb:'tt5432123'}],now);
 const item={status:'watching',watched_episodes_count:3,show:{title:'The Sample',ids:{imdb:'tt5432123'}},
   _addonTvdbMeta:{videos:[
     {season:1,episode:1,absoluteNumber:1},
     {season:1,episode:2,absoluteNumber:2},
     {season:1,episode:3,absoluteNumber:3},
     {season:2,episode:1,absoluteNumber:4},
   ]}};
 const tagged=addPersonalNextTags(entries,{items:{a:item}})[0];
 assert.equal(discoveryBadge(tagged).topLabel,'S3 · NOV 2 · Next S2E1');
 const ambiguous=addPersonalNextTags(entries,{items:{a:{...item,watched_episodes_count:99}}})[0];
 assert.equal(discoveryBadge(ambiguous).topLabel,'S3 · NOV 2');
});

test('an unwatched Plan to Watch title gets its documented TVDB first episode, not a guessed season premiere',()=>{
 const entries=buildUpcomingShows([{tmdb:tv,season:3,date:'2026-11-02',imdb:'tt5432123'}],now);
 const item={status:'plantowatch',show:{title:'The Sample',ids:{imdb:'tt5432123'}},
   _addonTvdbMeta:{videos:[{season:1,episode:1},{season:1,episode:2},{season:3,episode:1}]}};
 assert.equal(discoveryBadge(addPersonalNextTags(entries,{items:{x:item}})[0]).topLabel,'S3 · NOV 2 · Next S1E1');
});

test('new series show genre then date, while returning seasons always show season then date',()=>{
 const newSeries=buildUpcomingShows([
  {tmdb:{...tv,id:701,name:'Dramatic New',genres:[{id:18,name:'Drama'}]},season:1,date:'2026-10-30'},
  {tmdb:{...tv,id:702,name:'Sci Fi',genres:[{id:10765,name:'Sci-Fi & Fantasy'}]},season:1,date:'2026-10-31'},
  {tmdb:{...tv,id:703,name:'Genre Missing',genres:[],genre_ids:[]},season:1,date:'2026-11-01'},
  {tmdb:{...tv,id:704,name:'Return Drama',genres:[{id:18,name:'Drama'}]},season:2,date:'2026-11-02'},
 ],now);
 const byName=Object.fromEntries(newSeries.map(e=>[e.meta.name,e]));
 assert.equal(byName['Dramatic New'].tags.main,'DRAMA · OCT 30');
 assert.equal(byName['Sci Fi'].tags.main,'SCI-FI · OCT 31');
 assert.equal(byName['Genre Missing'].tags.main,'NOV 1');
 assert.equal(byName['Return Drama'].tags.main,'S2 · NOV 2');
});
