// Additional Account 2 row. Runs AFTER Home Releases and global discovery.
// Existing catalogs/metadata are never overwritten by this job.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SMART_SHUFFLE_ID, SMART_SHUFFLE_NAME, SMART_PAGE_SIZE,
  buildSmartEntries, interleaveSmartMovies, paginateSmartCatalog,
} from '../src/smart-shuffle.mjs';
import { appendPublicPath, deriveBaseUrl } from '../src/site.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toJson = value => `${JSON.stringify(value,null,2)}\n`;

function assertSafeId(id) {
  if (!/^(?:tt\d+|tmdb:\d+|simkl:\d+)$/.test(id)) throw new Error(`Unsafe movie ID: ${id}`);
}

export async function refreshSmartShuffle({
  clientId,accessToken,fetchImpl=fetch,now=new Date(),
  outputDirectory=path.join(root,'public/account-2'),
  releaseStateFile=path.join(root,'state/account-2/movie-release-state.json'),
  baseUrl=appendPublicPath(deriveBaseUrl({
    explicitBaseUrl:process.env.PUBLIC_BASE_URL,
    githubRepository:process.env.GITHUB_REPOSITORY,
  }),'account-2'),
  randomBetween=2,pageSize=SMART_PAGE_SIZE,rng,
}={}) {
  if(!clientId || !accessToken) throw new Error('Account 2 Simkl access token and client ID required');
  if (!baseUrl?.startsWith('https://')) throw new Error('HTTPS public URL required');
  const source = new URL('https://api.simkl.com/sync/all-items/movies/plantowatch');
  source.searchParams.set('client_id',clientId);
  const response = await fetchImpl(source,{headers:{Accept:'application/json',
    'simkl-api-key':clientId,Authorization:`Bearer ${accessToken}`}});
  if(!response.ok)throw new Error(`Simkl Plan to Watch request failed: HTTP ${response.status}`);
  const data=await response.json();
  if(!Array.isArray(data?.movies))throw new Error('Simkl movie list has no movies array');
  const cache=JSON.parse(await readFile(releaseStateFile,'utf8'));
  if(!cache?.movies || typeof cache.movies!=='object')throw new Error('Home Releases movie cache missing or invalid: run refresh:movies first');
  // Match the EXACT published Home Releases row, not independently computed
  // old release dates. This preserves its cutoff and any max-items limit.
  const homeCatalogPath=path.join(outputDirectory,'catalog','movie',
    'simkl-plan-to-watch-home-releases-account2.json');
  const homeCatalog=JSON.parse(await readFile(homeCatalogPath,'utf8'));
  if(!Array.isArray(homeCatalog?.metas)) throw new Error('Home Releases catalog missing metas array');
  const { entries, skipped }=buildSmartEntries(data.movies,cache.movies,{homeCatalog:homeCatalog.metas});
  const result=interleaveSmartMovies(entries,{randomBetween,rng});
  // Featured movies reuse the exact rendered poster already published by
  // Home Releases. Random movies stay plain — no extra poster renders.
  const metas=result.entries.map(({meta})=>meta);

  const manifestPath=path.join(outputDirectory,'manifest.json');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  const expected=['simkl-new-tv-episodes-account2','simkl-plan-to-watch-home-releases-account2',
    'global-upcoming-movies','global-upcoming-tv'];
  if(manifest.id!=='community.simkl.new-tv-episodes.account2'
    || expected.some((id,index)=>manifest.catalogs?.[index]?.id!==id)){
    throw new Error('Original four Account 2 catalogs must exist and be in their previous order. No changes made.');
  }
  // Nuvio may hide static catalogs that advertise optional `skip` extras.
  // Publish a plain fifth catalog first; retain static skip pages as optional
  // direct URLs. This is compatible with clients that only fetch base JSON.
  manifest.catalogs=manifest.catalogs.filter(c=>c.id!==SMART_SHUFFLE_ID);
  manifest.catalogs.push({type:'movie',id:SMART_SHUFFLE_ID,name:SMART_SHUFFLE_NAME});
  manifest.version = '1.15.0';
  if (!manifest.idPrefixes.includes('simkl:')) manifest.idPrefixes.push('simkl:');

  const catalogDir=path.join(outputDirectory,'catalog','movie');
  const pageDir=path.join(catalogDir,SMART_SHUFFLE_ID);
  const metaDir=path.join(outputDirectory,'meta','movie');
  await mkdir(pageDir,{recursive:true});
  await mkdir(metaDir,{recursive:true});
  const pages=paginateSmartCatalog(metas,pageSize);
  // Include the full list in the basic catalog because some Nuvio versions
  // do not request extra skip pages. The optional page files remain available.
  await writeFile(path.join(catalogDir,`${SMART_SHUFFLE_ID}.json`),toJson({metas}));
  for(const page of pages){
    await writeFile(path.join(pageDir,`skip=${page.skip}.json`),toJson({metas:page.metas}));
  }
  // An empty page explicitly tells Stremio/Nuvio pagination has ended.
  const afterLastPage=Math.ceil(metas.length/pageSize)*pageSize;
  await writeFile(path.join(pageDir,`skip=${afterLastPage}.json`),toJson({metas:[]}));
  for(const meta of metas){
    assertSafeId(meta.id);
    const filename=path.join(metaDir,`${meta.id}.json`);
    // Do not overwrite richer metadata from previously published rows.
    try { await readFile(filename,'utf8'); }
    catch(e){if(e.code!=='ENOENT')throw e;await writeFile(filename,toJson({meta}));}
  }
  const statusPath=path.join(outputDirectory,'status.json');
  const status=JSON.parse(await readFile(statusPath,'utf8'));
  status.smartShuffle={catalogId:SMART_SHUFFLE_ID,totalWatchlist:data.movies.length,
    published:metas.length,featured:result.featured,random:result.shuffled,
    taggedFromHomeReleases:result.featured,
    randomBetween,pageSize,pages:pages.length,
    generatedAt:now.toISOString(),shuffleMode:'reshuffle each scheduled build',
    releaseCacheSource:'existing Account 2 movie-release-state.json',
    warnings:skipped.map(s=>`${s.id}: ${s.reason}`).slice(0,30)};
  await writeFile(statusPath,toJson(status));
  await writeFile(manifestPath,toJson(manifest));
  return {metas,status:status.smartShuffle};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{
    const result=await refreshSmartShuffle({
      clientId:process.env.SIMKL_CLIENT_ID_2||process.env.SIMKL_CLIENT_ID,
      accessToken:process.env.SIMKL_ACCESS_TOKEN_2,
    });
    console.log(`Smart Shuffle added ${result.metas.length} movies, ${result.status.featured} featured, ${result.status.random} randomized.`);
  }catch(e){console.error(e.stack||e.message);process.exitCode=1;}
}
