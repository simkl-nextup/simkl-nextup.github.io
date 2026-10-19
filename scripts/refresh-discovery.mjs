// Global public discovery, independent of either Simkl account.
// Runs AFTER the existing TV and movie jobs, which create account-2 output.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPosterConfig } from '../src/poster-style.mjs';
import { writeReleaseStudio } from '../src/release-studio.mjs';
import { resolveTvdbEpisode } from '../src/tvdb.mjs';
import { renderDiscoveryPosters } from '../src/discovery-posters.mjs';
import { deriveBaseUrl, appendPublicPath } from '../src/site.mjs';
import {
  DISCOVERY_MOVIES_ID, DISCOVERY_TV_ID, DISCOVERY_MOVIES_NAME, DISCOVERY_TV_NAME,
  buildUpcomingMovies, buildUpcomingShows, tvmazePremieres, isQualityTitle,
  isTvmazePremiere, tvmazeMatch, day, futureEnd, scoreItem,
  UPCOMING_TV_STREAMING_WHITELIST, upcomingTvStreamingPlatform,
} from '../src/discovery.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const VERSION=6; // verified streaming-platform whitelist for Upcoming TV
const CACHE_TTL_MS=22*3600*1000;
const API='https://api.themoviedb.org/3';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function jsonFetch(fetchImpl,url,headers={}) {
  for(let n=0;n<3;n++) {
    const response=await fetchImpl(url,{headers:{Accept:'application/json',...headers},signal:AbortSignal.timeout(60000)});
    if((response.status===429 || response.status>=500) && n<2) { await sleep(750*(n+1)); continue; }
    if(!response.ok) {
      const err=new Error(`${new URL(url).hostname}: HTTP ${response.status}`);err.status=response.status; throw err;
    }
    return response.json();
  }
}
function tmdbGet(fetchImpl,token,route,params={}) {
  const url=new URL(`${API}${route}`);
  for(const [key,value] of Object.entries(params)) if(value!=null)url.searchParams.set(key,String(value));
  return jsonFetch(fetchImpl,url,{Authorization:`Bearer ${token}`});
}
async function concurrent(inputs,limit,fn) {
  const out=Array(inputs.length);let index=0;
  await Promise.all(Array.from({length:Math.min(limit,inputs.length)},async()=>{
    while(index<inputs.length){const i=index++;out[i]=await fn(inputs[i],i);}
  }));return out.filter(Boolean);
}
async function readCache(file) {
  try { const data=JSON.parse(await readFile(file,'utf8'));return data?.version===VERSION?data:null; }
  catch(e) {if(e.code==='ENOENT'||e instanceof SyntaxError)return null;throw e;}
}
async function getMovieCandidates({fetchImpl,token,now,warnings}) {
  const today=day(now),end=futureEnd(now,90);
  const searches=[
    // Global original/primary release date + region-sensitive US commercial release.
    { 'primary_release_date.gte':today,'primary_release_date.lte':end },
    { region:'US','release_date.gte':today,'release_date.lte':end,with_release_type:'2|3|4|6' },
  ];
  const selected=new Map();
  for(const query of searches) {
    for(let page=1;page<=4;page++) {
      const data=await tmdbGet(fetchImpl,token,'/discover/movie',{...query,page,include_adult:'false',sort_by:'popularity.desc',language:'en-US'});
      for(const item of data?.results||[]) {
        if(!isQualityTitle(item))continue;
        if(!selected.has(item.id))selected.set(item.id,item);
      }
      if(page >= (data?.total_pages||1))break;
    }
  }
  const choices=[...selected.values()].sort((a,b)=>scoreItem(b)-scoreItem(a)).slice(0,110);
  const detailed=await concurrent(choices,6,async movie=>{
    try {
      return await tmdbGet(fetchImpl,token,`/movie/${movie.id}`,{append_to_response:'release_dates,external_ids,images',include_image_language:'en,null',language:'en-US'});
    } catch(e) {if([401,403].includes(e.status))throw e;warnings.push(`Movie ${movie.id}: ${e.message}`);return null;}
  });
  // TMDB's `belongs_to_collection` alone is NOT proof of being a sequel:
  // confirm an earlier-released installment to avoid tagging originals.
  const collectionIds=[...new Set(detailed.map(d=>d.belongs_to_collection?.id).filter(id=>Number.isInteger(id)&&id>0))];
  const collections=new Map();
  await concurrent(collectionIds,5,async id=>{
    try {
      const data=await tmdbGet(fetchImpl,token,`/collection/${id}`,{language:'en-US'});
      collections.set(id,data?.parts||[]);
    }catch(e){if([401,403].includes(e.status))throw e;
      warnings.push(`Sequel information for collection ${id}: ${e.message}`);}
  });
  return detailed.map(movie=>{
    const parts=collections.get(movie.belongs_to_collection?.id);
    if(!parts?.length)return movie;
    const firstDate=movie.release_date?.slice(0,10);
    const previous=Boolean(firstDate && parts.some(part=>Number(part.id)!==Number(movie.id)
      && /^\d{4}-\d\d-\d\d$/.test(String(part.release_date))
      && part.release_date<firstDate));
    return {...movie,_addonPriorCollectionMovie:previous};
  });
}
function cleanName(s) {return String(s||'').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
async function resolveTvmaze({fetchImpl,token,record}) {
  const show=record.show,ext=show.externals||{};
  let item=null,verifiedExternalId=false;
  if(/^tt\d+$/.test(String(ext.imdb||''))) {
    const data=await tmdbGet(fetchImpl,token,`/find/${ext.imdb}`,{external_source:'imdb_id',language:'en-US'});
    item=data.tv_results?.[0];verifiedExternalId=Boolean(item);
  }
  if(!item && Number(ext.thetvdb)>0) {
    const data=await tmdbGet(fetchImpl,token,`/find/${ext.thetvdb}`,{external_source:'tvdb_id',language:'en-US'});
    item=data.tv_results?.[0];verifiedExternalId=Boolean(item);
  }
  if(!item) {
    const data=await tmdbGet(fetchImpl,token,'/search/tv',{query:show.name,language:'en-US',page:1});
    item=(data.results||[]).find(row=>[row.name,row.original_name].some(n=>cleanName(n)===cleanName(show.name)));
  }
  if(!item || !tvmazeMatch(item,{...record,verifiedExternalId}) || !isQualityTitle(item,{tv:true}))return null;
  return {tmdb:item,season:record.season,date:record.date,imdb:ext.imdb,source:'tvmaze',
    tvmazeWebChannel:show.webChannel || null,tvmazeNetwork:show.network || null,
    tvmazeUrl:(typeof show.url==='string' && /^https:\/\/www\.tvmaze\.com\/shows\//.test(show.url))?show.url:`https://www.tvmaze.com/shows/${Number(show.id)||0}`};
}
async function getTvCandidates({fetchImpl,token,now,warnings}) {
  const today=day(now),end=futureEnd(now,60);
  const newShows=new Map();
  for(let page=1;page<=7;page++) {
    const data=await tmdbGet(fetchImpl,token,'/discover/tv',{
      'first_air_date.gte':today,'first_air_date.lte':end,
      include_adult:'false',language:'en-US',sort_by:'popularity.desc',page,
    });
    for(const item of data.results||[]) if(isQualityTitle(item,{tv:true}))newShows.set(item.id,{tmdb:item,season:1,date:item.first_air_date,source:'tmdb'});
    if(page >= (data.total_pages||1))break;
  }
  let external=[];
  try {
    const schedule=await jsonFetch(fetchImpl,'https://api.tvmaze.com/schedule/full');
    if(!Array.isArray(schedule))throw new Error('TVmaze full schedule is not an array');
    const all=tvmazePremieres(schedule,now,60);
    const strong=all.filter(({show})=>{
      const ext=show.externals||{};
      const rating=Number(show.rating?.average)||0;
      // Keep scripted/animated international shows and sizable new discoveries.
      return Boolean(ext.imdb||ext.thetvdb||rating>=6.0) && show.image && show.name;
    });
    strong.sort((a,b)=>{
      const rating=(v)=>Number(v.show.rating?.average)||0;
      return (b.season>1?4:0)-(a.season>1?4:0)
        || rating(b)-rating(a) || a.date.localeCompare(b.date);
    });
    external=await concurrent(strong.slice(0,130),5,async rec=>{
      try{return await resolveTvmaze({fetchImpl,token,record:rec});}
      catch(e){if([401,403].includes(e.status))throw e;warnings.push(`TVmaze match ${rec.show.name}: ${e.message}`);return null;}
    });
  } catch(e) {
    if([401,403].includes(e.status))throw e;
    warnings.push(`TVmaze schedule unavailable; TMDB new-series discovery continues: ${e.message}`);
  }
  // If a show is new in TMDB but an upcoming season is verified by TVmaze,
  // keep the season premiere. All others retain their documented first air date.
  for(const r of external){
    const previous=newShows.get(r.tmdb.id);
    if(!previous || r.season>previous.season || (r.season===previous.season && r.date<previous.date))newShows.set(r.tmdb.id,r);
  }
  const shortlist=[...newShows.values()].sort((a,b)=>scoreItem(b.tmdb,{season:b.season})-scoreItem(a.tmdb,{season:a.season})).slice(0,125);
  return concurrent(shortlist,5,async row=>{
    try{
      const details=await tmdbGet(fetchImpl,token,`/tv/${row.tmdb.id}`,{
        append_to_response:'external_ids,images',include_image_language:'en,null',language:'en-US'});
      return {...row,tmdb:{...row.tmdb,...details},imdb:row.imdb||details.external_ids?.imdb_id};
    }catch(e){if([401,403].includes(e.status))throw e;
      warnings.push(`TV ${row.tmdb.id} artwork metadata: ${e.message}`);
      return row;}
  });
}
function normalizeName(name){return String(name||'').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
function validPosition(info){
  const episode=Number(info?.episode),season=Number(info?.season);
  if(!Number.isInteger(episode)||episode<=0)return null;
  return {episode,season:Number.isInteger(season)&&season>0?season:null};
}
function tvdbFallback(item){
  const videos=(item?._addonTvdbMeta?.videos||[])
    .filter(v=>Number.isInteger(Number(v.season))&&Number(v.season)>0
      &&Number.isInteger(Number(v.episode))&&Number(v.episode)>0);
  if(!videos.length)return null;
  const countValue=item?.watched_episodes_count;
  const watched=countValue==null?null:Number(countValue);
  if(watched!==null && (!Number.isInteger(watched)||watched<0))return null;
  // An exact absolute number is a reliable index for the next unwatched
  // episode, including episodes of seasons not yet aired. Never just assume
  // the upcoming premiere is next: the user might be behind several seasons.
  if(watched!==null){
    const indexed=videos.filter(v=>Number(v.absoluteNumber)===watched+1);
    if(indexed.length===1)return validPosition(indexed[0]);
  }
  // Planned-but-unstarted shows can start at the first documented episode.
  // This avoids generic NEXT for a Plan to Watch title with no Simkl info.
  if(item.status==='plantowatch' && (watched===null||watched===0)){
    const first=videos.filter(v=>Number(v.season)===1 && Number(v.episode)===1);
    if(first.length===1)return validPosition(first[0]);
  }
  return null;
}
function indexTvUpNext(catalog){
  const byId=new Map(),byName=new Map();
  const entries=Array.isArray(catalog?.metas)?catalog.metas:[];
  for(const meta of entries){
    const id=String(meta?.id||'');
    // Use the same canonical video chosen by the TV Up Next poster/detail.
    // Do not infer its default from catalog releaseInfo (latest aired != next).
    const match=String(meta?.behaviorHints?.defaultVideoId||'').match(/:(\d+):(\d+)$/);
    if(!match)continue;
    const position=validPosition({season:match[1],episode:match[2]});
    if(!position)continue;
    if(id)byId.set(id,position);
    const name=normalizeName(meta?.name);
    if(name){
      if(byName.has(name))byName.set(name,null); // ambiguous; no fallback
      else byName.set(name,position);
    }
  }
  return {byId,byName};
}
export function addPersonalNextTags(entries,state,upNextCatalog=null){
  const matches=new Map(),names=new Map(),upNext=indexTvUpNext(upNextCatalog);
  for(const item of Object.values(state?.items||{})){
    if(!['watching','plantowatch'].includes(item?.status))continue;
    const media=item.show||item.anime||{};
    for(const [kind,id] of Object.entries(media.ids||{})){
      if(['imdb','tmdb','tvdb'].includes(kind)&&id)matches.set(`${kind}:${id}`,item);
    }
    if(media.title)names.set(normalizeName(media.title),item);
  }
  return entries.map(entry=>{
    if(entry.tags?.statusKey!=='returning')return entry;
    const id=entry.meta.id;
    const tmdbUrl=entry.meta.links.find(l=>l.category==='tmdb')?.url;
    const tmdbId=tmdbUrl?.match(/\/tv\/(\d+)$/)?.[1];
    const tracked=matches.get(`imdb:${id}`)
      ||(tmdbId?matches.get(`tmdb:${tmdbId}`):null)
      ||names.get(normalizeName(entry.meta.name));
    if(!tracked)return entry;
    const nextInfo=tracked.next_to_watch_info;
    // First use Simkl's actual position; when Simkl omitted it, resolve
    // it from its TVDB-enriched episode records or the existing TV Up Next
    // catalog's canonical default-video ID. No generic/guessed NEXT label.
    const raw=validPosition(nextInfo);
    const mapped=raw && resolveTvdbEpisode(tracked._addonTvdbMeta,nextInfo);
    const current=validPosition(mapped)||raw;
    const position=current || tvdbFallback(tracked)
      || upNext.byId.get(id) || (tmdbId?upNext.byId.get(`tmdb:${tmdbId}`):null)
      || upNext.byName.get(normalizeName(entry.meta.name));
    if(!position)return entry;
    return {...entry,tags:{...entry.tags,next:true,
      personalStatus:tracked.status,
      nextEpisode:position.episode,
      ...(position.season?{nextSeason:position.season}:{})}};
  });
}
export async function refreshGlobalDiscovery({
  tmdbToken,fetchImpl=fetch,now=new Date(),outputDirectory=path.join(root,'public/account-2'),
  stateFile=path.join(root,'state/account-2/discovery-state.json'),
  personalStatePath=path.join(root,'state/account-2/simkl-state.json'),
  baseUrl=appendPublicPath(deriveBaseUrl({explicitBaseUrl:process.env.PUBLIC_BASE_URL,githubRepository:process.env.GITHUB_REPOSITORY}),'account-2'),
  maxMovies=50,maxTV=50,
}={}) {
  if(!tmdbToken)throw new Error('TMDB_READ_ACCESS_TOKEN is required for public discovery rows.');
  if(!baseUrl?.startsWith('https://'))throw new Error('Global discovery requires an HTTPS base URL.');
  const warnings=[];
  let cache=await readCache(stateFile);
  const fresh=cache && Number.isFinite(Date.parse(cache.fetchedAt)) && now-Date.parse(cache.fetchedAt)<CACHE_TTL_MS;
  if(!fresh) {
    const movies=await getMovieCandidates({fetchImpl,token:tmdbToken,now,warnings});
    const shows=await getTvCandidates({fetchImpl,token:tmdbToken,now,warnings});
    cache={version:VERSION,fetchedAt:now.toISOString(),movies,shows};
  }
  const movieEntries=buildUpcomingMovies(cache.movies,now,maxMovies);
  const personalState=await readFile(personalStatePath,'utf8').then(JSON.parse).catch(e=>{
    if(e.code!=='ENOENT')warnings.push(`Personal NEXT matching disabled: ${e.message}`);
    return {items:{}};
  });
  const tvUpNextFile=path.join(outputDirectory,'catalog','series','simkl-new-tv-episodes-account2.json');
  const tvUpNext=await readFile(tvUpNextFile,'utf8').then(JSON.parse).catch(e=>{
    if(e.code!=='ENOENT')warnings.push(`TV Up Next position fallback unavailable: ${e.message}`);
    return {metas:[]};
  });
  const eligibleTv=buildUpcomingShows(cache.shows,now,maxTV);
  const tvEntries=addPersonalNextTags(eligibleTv,personalState,tvUpNext);
  const posterStyle=await loadPosterConfig(path.join(root,'config/poster-style.json'));
  const movieImages=await renderDiscoveryPosters(movieEntries,{outputDirectory,baseUrl,fetchImpl,style:posterStyle.upcomingMovies,posterFolder:'upcoming-movies',skipFailures:true,studioSamples:6});
  const tvImages=await renderDiscoveryPosters(tvEntries,{outputDirectory,baseUrl,fetchImpl,style:posterStyle.upcomingTV,posterFolder:'upcoming-tv',skipFailures:true,studioSamples:6});
  await writeReleaseStudio({outputDirectory,account:'upcomingMovies',samples:movieImages.studio,generatedAt:now});
  await writeReleaseStudio({outputDirectory,account:'upcomingTV',samples:tvImages.studio,generatedAt:now});
  const manifestPath=path.join(outputDirectory,'manifest.json');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  if(manifest.id!=='community.simkl.new-tv-episodes.account2' || !manifest.catalogs?.some(c=>c.id==='simkl-plan-to-watch-home-releases-account2')) {
    throw new Error('Account 2 TV + movie manifest must exist before discovery refresh.');
  }
  manifest.types=Array.from(new Set([...manifest.types,'series','movie']));
  manifest.catalogs=manifest.catalogs.filter(c=>![DISCOVERY_MOVIES_ID,DISCOVERY_TV_ID].includes(c.id));
  manifest.catalogs.push({type:'movie',id:DISCOVERY_MOVIES_ID,name:DISCOVERY_MOVIES_NAME});
  manifest.catalogs.push({type:'series',id:DISCOVERY_TV_ID,name:DISCOVERY_TV_NAME});
  const json=(x)=>`${JSON.stringify(x,null,2)}\n`;
  for(const [type,id,metas] of [['movie',DISCOVERY_MOVIES_ID,movieImages.metas],['series',DISCOVERY_TV_ID,tvImages.metas]]) {
    await mkdir(path.join(outputDirectory,'catalog',type),{recursive:true});
    await mkdir(path.join(outputDirectory,'meta',type),{recursive:true});
    await writeFile(path.join(outputDirectory,'catalog',type,`${id}.json`),json({metas}));
    for(const meta of metas) {
      if(!/^(?:tt\d+|tmdb:\d+)$/.test(meta.id))throw new Error(`Invalid discovery ID: ${meta.id}`);
      const metaPath=path.join(outputDirectory,'meta',type,`${meta.id}.json`);
      // Never replace the existing TV Up Next episode-rich metadata (or a
      // home-release movie detail) with a lightweight discovery preview.
      let exists=false;
      try { await readFile(metaPath); exists=true; }
      catch(e) { if(e.code!=='ENOENT')throw e; }
      if(!exists)await writeFile(metaPath,json({meta}));
    }
  }
  // TVmaze uses CC BY-SA licensing: credit their episode schedule with a
  // visible link on Account 2's public index, not just in the source code.
  const indexPath=path.join(outputDirectory,'index.html');
  const indexHtml=await readFile(indexPath,'utf8').catch(e=>e.code==='ENOENT'?null:Promise.reject(e));
  if(indexHtml && !indexHtml.includes('Global TV premiere schedule: TVmaze')) {
    const credit='<p style="font-size:12px;color:#9ca3af">Global TV premiere schedule: <a href="https://www.tvmaze.com/" rel="noopener noreferrer">TVmaze</a> (CC BY-SA).</p>';
    await writeFile(indexPath,indexHtml.replace('</body>',`${credit}</body>`));
  }
  const statusFile=path.join(outputDirectory,'status.json');
  const status=JSON.parse(await readFile(statusFile,'utf8'));
  status.discovery={
    generatedAt:now.toISOString(),dataFetchedAt:cache.fetchedAt,source:'TMDB movie/TV discovery + TVmaze global premiere schedule',
    upcomingMovies:movieImages.metas.length,upcomingTV:tvImages.metas.length,
    movieWindowDays:90,tvWindowDays:60,
    streamingWhitelist:[...UPCOMING_TV_STREAMING_WHITELIST],
    tvCandidatesFetched:cache.shows.length,
    tvWithoutVerifiedPlatform:cache.shows.filter(row => !upcomingTvStreamingPlatform(row)).length,
    warnings:[...warnings,...movieImages.warnings,...tvImages.warnings].slice(0,30),
  };
  await writeFile(statusFile,json(status));
  await writeFile(manifestPath,json(manifest));
  await mkdir(path.dirname(stateFile),{recursive:true});
  await writeFile(stateFile,json(cache));
  return {movies:movieImages.metas,tv:tvImages.metas,status:status.discovery};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try {
    const result=await refreshGlobalDiscovery({tmdbToken:process.env.TMDB_READ_ACCESS_TOKEN,
      maxMovies:Number(process.env.MAX_DISCOVERY_MOVIES||50),maxTV:Number(process.env.MAX_DISCOVERY_TV||50)});
    console.log(`Upcoming discovery published: ${result.movies.length} movies; ${result.tv.length} shows (${result.status.warnings.length} warnings).`);
  } catch(e) {console.error(e.stack||e.message);process.exitCode=1;}
}
