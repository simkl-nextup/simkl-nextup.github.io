import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import sharp from 'sharp';
import {hasExplicitSequelNumber, upcomingMovieContext, buildUpcomingMovies} from '../src/discovery.mjs';
import {recentTheatricalPremiere,theatricalPremiere, buildSmartEntries} from '../src/smart-shuffle.mjs';
import {refreshSmartShuffle} from '../scripts/refresh-smart-shuffle.mjs';
import {discoveryBadge} from '../src/discovery-posters.mjs';
import {composeTaggedPoster} from '../src/poster-tags.mjs';
const now=new Date('2026-10-19T12:00:00Z');
const event=(type,day)=>({type,release_date:`${day}T00:00:00.000Z`});
const region=(country,...values)=>({iso_3166_1:country,release_dates:values});
const tmdb=(extras={})=>({id:11,title:'Clayface',release_date:'2026-10-23',poster_path:'/cover.jpg',
 overview:'A dark and twisting story about a mysterious character and transformation.',
 release_dates:{results:[region('US',event(3,'2026-10-23'))]},popularity:55, ...extras});

test('movie discovery top tag: proven sequel > genre > release year, while retaining actual date',()=>{
 const sequel=buildUpcomingMovies([tmdb({id:1,title:'Adventure Story',_addonPriorCollectionMovie:true,genres:[{name:'Horror'}]})],now)[0];
 assert.equal(sequel.tags.main,'SEQUEL · OCT 23');
 assert.equal(discoveryBadge(sequel).topLabel,'SEQUEL · OCT 23');
 const genre=buildUpcomingMovies([tmdb({id:2,genres:[{name:'Science Fiction'}]})],now)[0];
 assert.equal(genre.tags.main,'SCI-FI · OCT 23');
 const year=buildUpcomingMovies([tmdb({id:3,genres:[]})],now)[0];
 assert.equal(year.tags.main,'2026 · OCT 23');
 assert.equal(year.tags.statusKey,'theatrical');
 assert.equal(year.meta.type,'movie');
});
test('first installment in collection is not automatically a sequel',()=>{
 assert.equal(upcomingMovieContext({title:'First Movie',_addonPriorCollectionMovie:false,genres:[{name:'Drama'}]},'2026-10-23'),'DRAMA');
 assert.equal(hasExplicitSequelNumber('Dune: Part Three'),false,'spelled-out parts require verified collection evidence');
 assert.equal(hasExplicitSequelNumber('Dune: Part 3'),true);
 assert.equal(hasExplicitSequelNumber('Street Fighter'),false);
 assert.equal(hasExplicitSequelNumber('Kung Fu Panda 4'),true);
 assert.equal(hasExplicitSequelNumber('28 Days Later'),false);
});
test('cinema classification requires recent theatrical and no released digital/physical anywhere',()=>{
 const base={release_dates:{results:[region('US',event(3,'2026-10-14'))]}};
 assert.equal(recentTheatricalPremiere(base,{now}).date,'2026-10-14');
 assert.equal(recentTheatricalPremiere({release_dates:{results:[region('US',event(3,'2026-08-01'))]}},{now}),null);
 assert.equal(recentTheatricalPremiere({release_dates:{results:[region('US',event(3,'2026-10-20'))]}},{now}),null);
 assert.equal(recentTheatricalPremiere({release_dates:{results:[region('US',event(3,'2026-10-14')),region('GB',event(4,'2026-10-15'))]}},{now}),null);
 assert.equal(recentTheatricalPremiere({release_dates:{results:[region('US',event(3,'2026-10-14')),region('GB',event(5,'2026-10-16'))]}},{now}),null);
 assert.equal(recentTheatricalPremiere({release_dates:{results:[region('GB',event(3,'2026-10-13')),region('US',event(3,'2026-10-12'))]}},{now}).date,'2026-10-12');
 assert.equal(recentTheatricalPremiere({release_dates:{results:[region('GB',event(3,'2026-10-13'))]}},{now}).country,'GB');
});
test('Smart Shuffle cinema films stay in randomized positions, not Home Release slots',()=>{
 const movie=(id)=>({status:'plantowatch',movie:{title:`Film ${id}`,ids:{simkl:id,imdb:`tt100000${id}`}}});
 const entries=buildSmartEntries([movie(1),movie(2)],{
  1:{tmdb:{...tmdb({id:1,title:'Film 1',imdb_id:'tt1000001',release_date:'2026-10-13'}),release_dates:{results:[region('US',event(3,'2026-10-13'))]}}},
  2:{tmdb:{...tmdb({id:2,title:'Film 2',imdb_id:'tt1000002'}),release_dates:{results:[region('US',event(4,'2026-10-13'),event(3,'2026-10-01'))]}}},
 },{homeCatalog:[],now}).entries;
 assert.equal(entries[0].homeRank,null);
 assert.equal(entries[0].theatrical.date,'2026-10-13');
 assert.equal(entries[0].meta.releaseInfo,'IN THEATERS');
 assert.equal(entries[1].theatrical,null);
 assert.equal(Object.hasOwn(entries[1].meta,'releaseInfo'),false);
});
test('Smart Shuffle end-to-end renders a theatrical-only poster without changing original four rows',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'smart-theatrical-'));
 try {
  const outputDirectory=path.join(root,'account-2');
  const releaseStateFile=path.join(root,'movie-state.json');
  const movie={status:'plantowatch',movie:{title:'Street Fighter',ids:{simkl:100,imdb:'tt1010101'}}};
  const record=tmdb({id:101,title:'Street Fighter',imdb_id:'tt1010101',poster_path:'/sf.jpg',release_dates:{results:[region('US',event(3,'2026-10-18'))]}});
  await mkdir(path.join(outputDirectory,'catalog/movie'),{recursive:true});
  await mkdir(path.join(outputDirectory,'meta/movie'),{recursive:true});
  await writeFile(releaseStateFile,JSON.stringify({movies:{100:{tmdb:record}}}));
  const originalIds=['simkl-new-tv-episodes-account2','simkl-plan-to-watch-home-releases-account2','global-upcoming-movies','global-upcoming-tv'];
  const manifest={id:'community.simkl.new-tv-episodes.account2',version:'1.14.0',idPrefixes:['tt'],catalogs:originalIds.map((id,i)=>({type:i===0||i===3?'series':'movie',id,name:id}))};
  await writeFile(path.join(outputDirectory,'manifest.json'),JSON.stringify(manifest));
  await writeFile(path.join(outputDirectory,'status.json'),JSON.stringify({movieRow:{published:0},discovery:{upcomingMovies:0}}));
  await writeFile(path.join(outputDirectory,'catalog/movie/simkl-plan-to-watch-home-releases-account2.json'),JSON.stringify({metas:[]}));
  const image=await sharp({create:{width:500,height:750,channels:3,background:'#6e4555'}}).jpeg().toBuffer();
  const fetchImpl=async(url)=>{
    if(String(url).includes('api.simkl.com'))return {ok:true,json:async()=>({movies:[movie]})};
    return new Response(image,{status:200,headers:{'content-type':'image/jpeg'}});
  };
  const res=await refreshSmartShuffle({clientId:'x',accessToken:'secret',fetchImpl,now,
    outputDirectory,releaseStateFile,baseUrl:'https://unit.test/account-2'});
  assert.equal(res.metas.length,1);
  assert.equal(res.status.featured,0);
  assert.equal(res.status.theatricalTagged,1);
  assert.equal(res.metas[0].releaseInfo,'IN THEATERS');
  assert.match(res.metas[0].poster,/smart-theatrical/);
  const updated=JSON.parse(await readFile(path.join(outputDirectory,'manifest.json')));
  assert.deepEqual(updated.catalogs.slice(0,4),manifest.catalogs);
  const status=JSON.parse(await readFile(path.join(outputDirectory,'status.json')));
  assert.equal(status.movieRow.published,0);
 } finally {await rm(root,{recursive:true,force:true});}
});

test('future theatrical, limited, and premiere titles receive scheduled dates but remain randomized',()=>{
 const movie=(id)=>({status:'plantowatch',movie:{title:`Film ${id}`,ids:{simkl:id,imdb:`tt100000${id}`}}});
 const cache={
  1:{tmdb:{...tmdb({id:1,title:'Film 1'}),release_dates:{results:[region('US',event(3,'2026-10-23'))]}}},
  2:{tmdb:{...tmdb({id:2,title:'Film 2'}),release_dates:{results:[region('US',event(2,'2026-11-03'))]}}},
  3:{tmdb:{...tmdb({id:3,title:'Film 3'}),release_dates:{results:[region('DE',event(1,'2026-11-04'))]}}},
  4:{tmdb:{...tmdb({id:4,title:'Film 4'}),release_dates:{results:[region('US',event(3,'2027-05-01'))]}}},
 };
 const entries=buildSmartEntries([movie(1),movie(2),movie(3),movie(4)],cache,{homeCatalog:[],now}).entries;
 for(const [index,kind] of [[0,'THEATRICAL'],[1,'LIMITED'],[2,'PREMIERE']]){
   assert.equal(entries[index].homeRank,null);
   assert.equal(entries[index].theatrical.kind,kind);
   assert.equal(entries[index].theatrical.upcoming,true);
   assert.match(entries[index].meta.releaseInfo,new RegExp('^'+kind+' · 2026'));
 }
 assert.equal(entries[3].theatrical,null,'outside 90-day window stays untagged');
});
test('cinema tags ignore reissues and any film already available at home, but respect US priority',()=>{
 const movie={release_dates:{results:[region('GB',event(3,'2026-10-19')),region('US',event(3,'2026-11-07'))]}};
 assert.equal(theatricalPremiere(movie,{now}).date,'2026-11-07');
 assert.equal(theatricalPremiere(movie,{now}).country,'US');
 assert.equal(theatricalPremiere({release_dates:{results:[region('US',event(3,'2015-10-20'),event(3,'2026-10-25'))]}},{now}),null);
 assert.equal(theatricalPremiere({release_dates:{results:[region('US',event(3,'2026-10-25')),region('JP',event(4,'2026-10-18'))]}},{now}),null);
 assert.equal(theatricalPremiere({release_dates:{results:[region('US',event(3,'2026-10-25')),region('JP',event(5,'2026-10-17'))]}},{now}),null);
});

test('Smart Shuffle publishes future cinema labels in ordinary shuffled slots, without touching Home Releases',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'smart-future-cinema-'));
 try {
  const outputDirectory=path.join(root,'account-2'),releaseStateFile=path.join(root,'movie-state.json');
  const movie={status:'plantowatch',movie:{title:'Clayface',ids:{simkl:123,imdb:'tt1231231'}}};
  const record=tmdb({id:123,title:'Clayface',imdb_id:'tt1231231',release_dates:{results:[region('US',event(3,'2026-10-23'))]}});
  await mkdir(path.join(outputDirectory,'catalog/movie'),{recursive:true});
  await mkdir(path.join(outputDirectory,'meta/movie'),{recursive:true});
  await writeFile(releaseStateFile,JSON.stringify({movies:{123:{tmdb:record}}}));
  const ids=['simkl-new-tv-episodes-account2','simkl-plan-to-watch-home-releases-account2','global-upcoming-movies','global-upcoming-tv'];
  await writeFile(path.join(outputDirectory,'manifest.json'),JSON.stringify({id:'community.simkl.new-tv-episodes.account2',version:'1.14.0',idPrefixes:['tt'],catalogs:ids.map((id,i)=>({id,type:i===0||i===3?'series':'movie',name:id}))}));
  await writeFile(path.join(outputDirectory,'status.json'),JSON.stringify({movieRow:{published:0},discovery:{upcomingMovies:0}}));
  await writeFile(path.join(outputDirectory,'catalog/movie/simkl-plan-to-watch-home-releases-account2.json'),JSON.stringify({metas:[]}));
  const buffer=await sharp({create:{width:500,height:750,channels:3,background:'#6e4555'}}).jpeg().toBuffer();
  const fetchImpl=async(url)=>String(url).includes('api.simkl.com')
    ? {ok:true,json:async()=>({movies:[movie]})}
    : new Response(buffer,{status:200,headers:{'content-type':'image/jpeg'}});
  const result=await refreshSmartShuffle({clientId:'unit',accessToken:'unit',fetchImpl,now,outputDirectory,releaseStateFile,baseUrl:'https://unit.test/account-2'});
  assert.equal(result.status.featured,0);
  assert.equal(result.status.upcomingCinemaTagged,1);
  assert.match(result.metas[0].releaseInfo,/^THEATRICAL · 2026-10-23$/);
  assert.match(result.metas[0].poster,/smart-theatrical/);
  const full=JSON.parse(await readFile(path.join(outputDirectory,'catalog/movie/simkl-movies-smart-shuffle-account2.json')));
  assert.equal(full.metas.length,1);
  const home=JSON.parse(await readFile(path.join(outputDirectory,'catalog/movie/simkl-plan-to-watch-home-releases-account2.json')));
  assert.deepEqual(home,{metas:[]});
 } finally {await rm(root,{recursive:true,force:true});}
});
