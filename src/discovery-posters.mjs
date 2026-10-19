// Global Upcoming: same full Up Next artwork/tag renderer, no BetterPosters.
// Uses TMDB posters/title logos and the existing status/date/optional NEXT primitives.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { composeTaggedPoster, posterTints, TAG_STYLE_VERSION } from './poster-tags.mjs';
import { normalizePosterStyle, normalizeDiscoveryColours } from './poster-style.mjs';

const STATUS = { newSeries:'discoveryNewSeries', returning:'discoveryReturning',
  theatrical:'discoveryTheatrical', streaming:'discoveryStreaming', limited:'discoveryLimited', premiere:'discoveryPremiere' };
const MAX_BYTES=12*1024*1024;
async function fetchImage(url, fetchImpl) {
  const parsed=new URL(url);
  if(parsed.protocol!=='https:' || parsed.hostname!=='image.tmdb.org') throw new Error('Upcoming artwork must originate from TMDB');
  const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),15000);
  try {
    const res=await fetchImpl(url,{signal:abort.signal,headers:{Accept:'image/*'}});
    if(!res.ok)throw new Error(`TMDB poster ${res.status}`);
    const mime=res.headers?.get?.('content-type');
    if(mime && !mime.startsWith('image/'))throw new Error(`Unexpected artwork content-type: ${mime}`);
    if(Number(res.headers?.get?.('content-length')||0)>MAX_BYTES)throw new Error('Artwork exceeds limit');
    const bytes=Buffer.from(await res.arrayBuffer());
    if(!bytes.length || bytes.length>MAX_BYTES)throw new Error('Invalid artwork size');
    return bytes;
  } finally {clearTimeout(timeout);}
}
// Reuse the Up Next single-line top-tab convention. For matching returning
// shows, put NEXT alongside the season/premiere date, never in a side chip.
// Episode numbers come only from Simkl's actual next_to_watch_info.
export function upcomingTvTopLabel(tags,showNext=true) {
  const base=String(tags?.main||'').trim();
  if(!base || !showNext || tags?.statusKey!=='returning' || !tags?.next)return base;
  const episode=Number(tags.nextEpisode),nextSeason=Number(tags.nextSeason);
  if(Number.isInteger(episode) && episode>0){
    return Number.isInteger(nextSeason) && nextSeason>0 && nextSeason!==Number(tags.season)
      ? `${base} · Next S${nextSeason}E${episode}`
      : `${base} · Next E${episode}`;
  }
  // Unavailable episode positions never render a generic or guessed NEXT.
  return base;
}
export function discoveryBadge(entry, config={}) {
  const tag=entry.tags || {};
  const status=STATUS[tag.statusKey];
  if(!status)throw new Error(`Unknown discovery status: ${tag.statusKey}`);
  const colors=normalizeDiscoveryColours(config.statusColours,entry.meta.type==='series'?'upcomingTV':'upcomingMovies');
  return { status, topLabel:entry.meta.type==='series'
      ? upcomingTvTopLabel(tag,config.showNext!==false) : tag.main,
    statusFill:colors[tag.statusKey], compactDate:true,
    nextLabel:null,
    score:config.showRatings===false?null:tag.score, textless:Boolean(entry.artwork?.textless),
  };
}
export async function renderDiscoveryPosters(entries,{outputDirectory,baseUrl,fetchImpl=fetch,style={},posterFolder,studioSamples=6,skipFailures=true}={}) {
  if(!/^(upcoming-movies|upcoming-tv)$/.test(posterFolder))throw new Error('Invalid discovery folder');
  const directory=path.join(outputDirectory,'posters',posterFolder);
  await mkdir(directory,{recursive:true});
  const output=Array(entries.length).fill(null),studio=Array(entries.length).fill(null),warnings=[];
  const design=normalizePosterStyle(style);
  let cursor=0;
  async function worker(){
    while(cursor<entries.length){
      const idx=cursor++,entry=entries[idx];
      try {
        let raw;
        try{raw=await fetchImage(entry.meta.poster,fetchImpl);}
        catch(e){if(entry.tmdbPoster===entry.meta.poster)throw e;raw=await fetchImage(entry.tmdbPoster,fetchImpl);warnings.push(`TMDB alternate poster used for ${entry.meta.id}: ${e.message}`);}
        let logo=null;
        if(entry.artwork?.logo){try{logo=await fetchImage(entry.artwork.logo,fetchImpl);}catch(e){warnings.push(`Logo unavailable for ${entry.meta.id}: ${e.message}`);}}
        const badge=discoveryBadge(entry,style);
        const rendered=await composeTaggedPoster({poster:raw,logo,name:entry.meta.name,badge,style:design});
        const key=createHash('sha256').update(JSON.stringify({version:TAG_STYLE_VERSION,badge,style:design})).update(raw).update(logo||Buffer.alloc(0)).digest('hex').slice(0,24);
        const name=`${key}.webp`;
        await writeFile(path.join(directory,name),rendered);
        output[idx]={...entry.meta,poster:`${baseUrl.replace(/\/$/,'')}/posters/${posterFolder}/${name}`};
        if(idx<studioSamples){
          const baseDir=path.join(outputDirectory,'studio','base',posterFolder);
          await mkdir(baseDir,{recursive:true});
          await writeFile(path.join(baseDir,`base-${name}`),await sharp(raw).resize(500,750,{fit:'cover'}).webp({quality:88}).toBuffer());
          studio[idx]={name:entry.meta.name,id:entry.meta.id,
            poster:`account-2/studio/base/${posterFolder}/base-${name}`,
            ...(entry.artwork?.logo?{logo:entry.artwork.logo}:{}),
            tags:entry.tags, tints:await posterTints(raw),textless:Boolean(entry.artwork?.textless)};
        }
      }catch(e){
        if(!skipFailures)throw e;
        warnings.push(`Could not publish upcoming ${entry.meta?.id}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({length:Math.min(4,entries.length)},worker));
  return {metas:output.filter(Boolean),studio:studio.filter(Boolean),warnings};
}
