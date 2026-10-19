import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { refreshGlobalDiscovery } from '../scripts/refresh-discovery.mjs';
const time=new Date('2026-10-19T11:00:00Z');
const str=(x)=>JSON.stringify(x);
const asJson=(d)=>new Response(str(d),{status:200,headers:{'content-type':'application/json'}});
async function workspace(){
  const root=await mkdtemp(path.join(os.tmpdir(),'simkl-discovery-'));
  const output=path.join(root,'account-2');await mkdir(output,{recursive:true});
  await writeFile(path.join(output,'manifest.json'),str({id:'community.simkl.new-tv-episodes.account2',resources:['catalog','meta'],types:['series','movie'],description:'Account 2',catalogs:[
    {type:'series',id:'simkl-new-tv-episodes-account2',name:'TV'},
    {type:'movie',id:'simkl-plan-to-watch-home-releases-account2',name:'Home Releases'},
  ],idPrefixes:['tt','tmdb:']}));
  await writeFile(path.join(output,'status.json'),str({mediaType:'tv',movieRow:{published:1},catalogItems:1}));
  return {root,output};
}
const description='A determined family discovers the hidden truth behind a mysterious village disappearance.';
const movie={id:40,title:'Upcoming Film',poster_path:'/movie.jpg',backdrop_path:'/bg.jpg',overview:description,popularity:20,
  imdb_id:'tt1234567',release_dates:{results:[{iso_3166_1:'US',release_dates:[{type:3,release_date:'2026-11-06T00:00:00Z'}]}]}};
const newShow={id:50,name:'Fresh Drama',poster_path:'/new.jpg',overview:description,popularity:10,first_air_date:'2026-11-07',genre_ids:[18]};
const returning={id:60,name:'Returning Drama',poster_path:'/return.jpg',overview:description,popularity:22,first_air_date:'2022-03-10',genre_ids:[18]};
const tvmaze={id:77,name:'Returning Drama',type:'Scripted',genres:['Drama'],image:{medium:'https://tvmaze.com/image.jpg'},
  rating:{average:8},externals:{imdb:'tt7654321'},url:'https://www.tvmaze.com/shows/77/returning-drama'};
function fakeFetch(image, log){
  return async (url)=>{
    const u=new URL(String(url));log.push(String(url));
    if(u.hostname==='btttr.cc'||u.hostname==='image.tmdb.org')return new Response(image,{status:200,headers:{'content-type':'image/jpeg'}});
    if(u.pathname.includes('/discover/movie'))return asJson({page:1,total_pages:1,results:[movie]});
    if(u.pathname==='/3/movie/40')return asJson(movie);
    if(u.pathname.includes('/discover/tv'))return asJson({page:1,total_pages:1,results:[newShow]});
    if(u.pathname==='/schedule/full')return asJson([
      {season:3,number:1,airdate:'2026-11-11',show:tvmaze},
      {season:3,number:2,airdate:'2026-11-18',show:tvmaze},
      {season:4,number:1,airdate:'2027-11-11',show:tvmaze},
    ]);
    if(u.pathname==='/3/find/tt7654321')return asJson({tv_results:[returning]});
    if(u.pathname==='/3/tv/50')return asJson({...newShow,external_ids:{imdb_id:'tt5555555'}});
    if(u.pathname==='/3/tv/60')return asJson({...returning,external_ids:{imdb_id:'tt7654321'}});
    throw new Error(`Unexpected URL: ${url}`);
  };
}
test('full global refresh appends two rows, publishes tagged artwork and metadata, leaves existing catalogs intact, caches APIs',async()=>{
  const {root,output}=await workspace();
  try {
    const image=await sharp({create:{width:500,height:750,channels:3,background:'#274152'}}).jpeg().toBuffer();
    const calls=[],fetchImpl=fakeFetch(image,calls),stateFile=path.join(root,'discovery.json');
    await mkdir(path.join(output,'meta/series'),{recursive:true});
    const existing={meta:{id:'tt7654321',type:'series',name:'Returning Drama',videos:[{id:'tt7654321:2:3',season:2,episode:3}]}};
    await writeFile(path.join(output,'meta/series/tt7654321.json'),str(existing));
    const opts={tmdbToken:'secret-tmdb',fetchImpl,now:time,outputDirectory:output,stateFile,baseUrl:'https://test.github.io/account-2'};
    const result=await refreshGlobalDiscovery(opts);
    assert.equal(result.movies.length,1);assert.equal(result.tv.length,2);
    const manifest=JSON.parse(await readFile(path.join(output,'manifest.json'),'utf8'));
    assert.deepEqual(manifest.catalogs.map(x=>x.id),[
      'simkl-new-tv-episodes-account2','simkl-plan-to-watch-home-releases-account2','global-upcoming-movies','global-upcoming-tv',
    ]);
    const movieCat=JSON.parse(await readFile(path.join(output,'catalog/movie/global-upcoming-movies.json'),'utf8'));
    const tvCat=JSON.parse(await readFile(path.join(output,'catalog/series/global-upcoming-tv.json'),'utf8'));
    assert.equal(movieCat.metas[0].id,'tt1234567');
    assert.ok(movieCat.metas[0].poster.includes('upcoming-movies/'));
    assert.ok(!calls.some(x=>x.includes('btttr.cc')),'discovery must not call BetterPosters');
    assert.equal(tvCat.metas.length,2);
    assert.ok(tvCat.metas.find(x=>x.id==='tt7654321'));
    assert.ok(tvCat.metas.find(x=>x.id==='tt7654321').links.some(x=>x.url.includes('tvmaze.com')));
    assert.ok(tvCat.metas.every(x=>x.poster.includes('upcoming-tv/')));
    const movieStudio=JSON.parse(await readFile(path.join(output,'studio/upcomingMovies.json'),'utf8'));
    const tvStudio=JSON.parse(await readFile(path.join(output,'studio/upcomingTV.json'),'utf8'));
    assert.equal(movieStudio.samples.length,1);
    assert.equal(tvStudio.samples.length,2);
    assert.deepEqual(new Set(tvStudio.samples.map(s=>s.tags.statusKey)),new Set(['newSeries','returning']));
    assert.ok(tvStudio.samples.some(s=>s.tags.main==='S3 · NOV 11' && s.tags.statusKey==='returning'));
    assert.ok(tvStudio.samples.some(s=>s.tags.main==='NOV 7' && s.tags.statusKey==='newSeries'));
    assert.ok((await stat(path.join(output,'meta/series/tt7654321.json'))).isFile());
    assert.deepEqual(JSON.parse(await readFile(path.join(output,'meta/series/tt7654321.json'),'utf8')),existing);
    const published=JSON.stringify(movieCat)+JSON.stringify(tvCat)+JSON.stringify(manifest);
    assert.ok(!published.includes('secret-tmdb'));
    const status=JSON.parse(await readFile(path.join(output,'status.json'),'utf8'));
    assert.equal(status.movieRow.published,1);
    assert.equal(status.discovery.upcomingTV,2);
    const firstTmdbCalls=calls.filter(x=>x.includes('api.themoviedb.org')).length;
    assert.ok(firstTmdbCalls>0);
    await refreshGlobalDiscovery({...opts,now:new Date('2026-10-19T12:00:00Z')});
    assert.equal(calls.filter(x=>x.includes('api.themoviedb.org')).length,firstTmdbCalls);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('missing TMDB credential refuses to produce fake empty discovery',async()=>{
  const {root,output}=await workspace();
  try{await assert.rejects(()=>refreshGlobalDiscovery({tmdbToken:'',outputDirectory:output}),/TMDB_READ_ACCESS_TOKEN/);}
  finally{await rm(root,{recursive:true,force:true});}
});
test('TVmaze outage still produces new TV and upcoming movies from TMDB',async()=>{
  const {root,output}=await workspace();
  try{
    const image=await sharp({create:{width:500,height:750,channels:3,background:'#688399'}}).jpeg().toBuffer();
    const fetchImpl=async url=>{
      if(String(url).includes('api.tvmaze.com'))return new Response('service down',{status:503});
      return fakeFetch(image,[])(url);
    };
    const result=await refreshGlobalDiscovery({tmdbToken:'token',fetchImpl,now:time,outputDirectory:output,stateFile:path.join(root,'cache.json'),baseUrl:'https://test.github.io/account-2'});
    assert.equal(result.movies.length,1);assert.equal(result.tv.length,1);
    assert.ok(result.status.warnings.some(w=>String(w).includes('TVmaze schedule unavailable')));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('TMDB collection relationship is checked against earlier installments before showing SEQUEL',async()=>{
  const {root,output}=await workspace();
  try {
    const image=await sharp({create:{width:500,height:750,channels:3,background:'#456781'}}).jpeg().toBuffer();
    const calls=[];
    const fetchImpl=async(url)=>{
      const u=new URL(String(url));calls.push(String(url));
      if(u.pathname==='/3/movie/40')return asJson({...movie,
        genres:[{id:18,name:'Drama'}],
        belongs_to_collection:{id:77,name:'A Movie Collection'},
        release_date:'2026-11-06'});
      if(u.pathname==='/3/collection/77')return asJson({parts:[
        {id:10,release_date:'2024-01-01'}, {id:40,release_date:'2026-11-06'},
      ]});
      return fakeFetch(image,[])(url);
    };
    const result=await refreshGlobalDiscovery({tmdbToken:'token',fetchImpl,now:time,
      outputDirectory:output,stateFile:path.join(root,'collection.json'),
      baseUrl:'https://test.github.io/account-2'});
    assert.equal(result.movies[0].releaseInfo,'SEQUEL · THEATRICAL · NOV 6');
    assert.ok(calls.some(u=>u.includes('/collection/77')));
    const studio=JSON.parse(await readFile(path.join(output,'studio/upcomingMovies.json')));
    assert.equal(studio.samples[0].tags.main,'SEQUEL · NOV 6');
  } finally {await rm(root,{recursive:true,force:true});}
});
