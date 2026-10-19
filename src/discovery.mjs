// Public, Simkl-independent global discovery catalogs. Date comparisons are
// UTC calendar days; only confirmed movie commercial premieres and TV season
// premieres enter these rows. No guessed dates or weekly episodes.
export const DISCOVERY_MOVIES_ID = 'global-upcoming-movies';
export const DISCOVERY_TV_ID = 'global-upcoming-tv';
export const DISCOVERY_MOVIES_NAME = 'Upcoming Movies';
export const DISCOVERY_TV_NAME = 'Upcoming TV Shows';
export const DAY = 86400000;
const UNDESIRED_TV = /\b(?:news|talk|reality|game show|sports?|soap|variety|weather|shopping|late night|awards?)\b/i;
const UNDESIRED_NAME = /\b(?:tonight|live news|morning show|daily news|evening news|lottery|highlights|weather forecast)\b/i;
const FILM_FORMATS = new Map([[1,'PREMIERE'],[2,'LIMITED'],[3,'THEATRICAL'],[4,'STREAMING'],[6,'STREAMING']]);
export const day = (date) => new Date(date).toISOString().slice(0,10);
export function futureEnd(now, days) { return day(new Date(Date.parse(`${day(now)}T00:00:00Z`) + days * DAY)); }
export function daysUntil(date, today) { return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY); }
export function dateLabel(date) {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.toLocaleDateString('en-US', {month:'short', timeZone:'UTC'}).toUpperCase()} ${d.getUTCDate()}`;
}
export function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d/.test(value)) return null;
  const s = value.slice(0,10), t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0,10) === s ? s : null;
}
export function isQualityTitle(value, { tv = false } = {}) {
  const name = String(value?.name || value?.title || '').trim();
  if (!name || name.length < 2 || value?.adult || !value.poster_path) return false;
  if (String(value.overview || '').trim().length < 35) return false;
  if (tv) {
    if (UNDESIRED_NAME.test(name)) return false;
    if ((value.genre_ids || []).some(id => [10763,10764,10767,10766].includes(Number(id)))) return false;
  }
  return true;
}
export function pickMoviePremiere(details, now, windowDays=90) {
  const today=day(now), end=futureEnd(now,windowDays);
  const events=[];
  for (const region of details?.release_dates?.results || []) {
    for (const r of region.release_dates || []) {
      const kind=FILM_FORMATS.get(Number(r.type)), d=validDay(r.release_date);
      if (kind && d) events.push({date:d,kind,country:String(region.iso_3166_1||'').toUpperCase()});
    }
  }
  if (!events.length) return null;
  // An older movie receiving its digital release is NOT a new premiere.
  const commercial=events.filter(e=>e.kind!=='PREMIERE');
  const source=commercial.length?commercial:events;
  const earliest=source.reduce((min,e)=>e.date<min?e.date:min,source[0].date);
  const inWindow=source.filter(e=>e.date>=today && e.date<=end);
  inWindow.sort((a,b)=>a.date.localeCompare(b.date));
  const usPremiere=inWindow.find(e=>e.country==='US' && ['THEATRICAL','LIMITED'].includes(e.kind));
  // Some international films open overseas slightly earlier but are still
  // genuinely upcoming in the US. Include a scheduled US theatrical debut
  // when the foreign first release was recent (<=90 days), not for old
  // movies receiving home-video reissues years later.
  const earlyAge=daysUntil(today,earliest);
  if (earliest<today && !(usPremiere && earlyAge<=90)) return null;
  if (earliest>end) return null;
  const chosen=inWindow.find(e=>e.country==='US') || inWindow[0];
  return chosen ? {...chosen,firstWorldwide:earliest} : null;
}
export function isTvmazePremiere(episode, now, windowDays=60) {
  const date=validDay(episode?.airdate);
  if (!date || date<day(now) || date>futureEnd(now,windowDays)) return false;
  if (Number(episode?.season)<1 || Number(episode?.number)!==1 || episode?.type==='significant_special') return false;
  const show=episode.show || episode._embedded?.show;
  if (!show?.name || UNDESIRED_NAME.test(show.name)) return false;
  if (show.type && !['Scripted','Animation'].includes(show.type)) return false;
  if ((show.genres||[]).some(g=>UNDESIRED_TV.test(g))) return false;
  if (show.status==='Ended' && Number(episode.season)<2) return false;
  return true;
}
export function tvmazePremieres(schedule, now, windowDays=60) {
  const byShow=new Map();
  for (const ep of schedule||[]) {
    if (!isTvmazePremiere(ep,now,windowDays)) continue;
    const show=ep.show || ep._embedded?.show;
    const key=String(show.id || show.externals?.imdb || show.name);
    const candidate={show,season:Number(ep.season),date:validDay(ep.airdate)};
    if (!byShow.has(key) || candidate.date<byShow.get(key).date) byShow.set(key,candidate);
  }
  return [...byShow.values()];
}
const cleanName = (s)=>String(s||'').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function tvmazeMatch(tmdb, record) {
  if (!tmdb?.id) return false;
  const first=cleanName(tmdb.name), second=cleanName(record.show.name);
  if (first===second || cleanName(tmdb.original_name)===second) return true;
  // Foreign/translated titles need a strong external ID instead of a name match.
  return !!record.verifiedExternalId;
}
export function scoreItem(tmdb, {season=1, tv=false}={}) {
  const popularity=Math.max(0,Number(tmdb.popularity)||0);
  const votes=Math.max(0,Number(tmdb.vote_count)||0);
  const overview=String(tmdb.overview||'');
  const quality = Math.min(18, Math.log1p(popularity)*5) + Math.min(10, Math.log1p(votes)*1.5)
    + (overview.length>110?3:0) + (season>1?4:0);
  return quality;
}
export function tier(date, now) { const d=daysUntil(date, day(now)); return d<=7?0:d<=30?1:2; }
function rank(a,b,now) {
  // Netflix-like: near-term first, then anticipation and variety rather than
  // listing obscure daily entries solely because they debut tomorrow.
  return tier(a.date,now)-tier(b.date,now) || b.score-a.score || a.date.localeCompare(b.date) || a.meta.name.localeCompare(b.meta.name);
}
function posterFor(tmdb) {
  // Upcoming rows use our Up Next renderer, never BetterPosters.
  const images=tmdb.images?.posters || [];
  const textless=images.filter(p=>p.file_path && p.iso_639_1==null)
    .sort((a,b)=>(Number(b.vote_count)||0)-(Number(a.vote_count)||0))[0];
  const logos=(tmdb.images?.logos||[]).filter(l=>l.file_path)
    .sort((a,b)=>(a.iso_639_1==='en'?0:a.iso_639_1==null?1:2)-(b.iso_639_1==='en'?0:b.iso_639_1==null?1:2));
  const posterPath=textless?.file_path || tmdb.poster_path;
  return { poster: `https://image.tmdb.org/t/p/w500${posterPath}`,
    logo: logos[0]?.file_path ? `https://image.tmdb.org/t/p/w500${logos[0].file_path}` : null,
    textless: !!textless };
}
function releaseEntry(tmdb, date, chip, mediaType, imdb, now, score, note) {
  const id= /^tt\d+$/.test(String(imdb||''))?imdb:`tmdb:${tmdb.id}`;
  const title=String(tmdb.title||tmdb.name||'');
  const art=posterFor(tmdb);
  const backup=`https://image.tmdb.org/t/p/w500${tmdb.poster_path}`;
  const meta={id,type:mediaType,name:title,poster:art.poster,
    ...(tmdb.backdrop_path?{background:`https://image.tmdb.org/t/p/w1280${tmdb.backdrop_path}`} : {}),
    ...(tmdb.genre_ids?.length?{genres:[]} : {}),
    releaseInfo: `${chip} · ${dateLabel(date)}`,
    description: `${note} ${dateLabel(date)}. ${tmdb.overview || ''}`.trim(),
    links:[{name:'View on TMDB',category:'tmdb',url:`https://www.themoviedb.org/${mediaType==='movie'?'movie':'tv'}/${tmdb.id}`}],
  };
  const statusKey = mediaType==='series' ? (chip==='NEW SERIES'?'newSeries':'returning')
    : ({THEATRICAL:'theatrical',STREAMING:'streaming',LIMITED:'limited',PREMIERE:'premiere'}[chip]);
  const rating = Number(tmdb.vote_average)>=1 && Number(tmdb.vote_count)>=20 ? Number(tmdb.vote_average).toFixed(1) : null;
  return {meta,date,score,tmdbPoster:backup,artwork:art,
    tags:{main:dateLabel(date),statusKey,score:rating,compactDate:true}};
}
// Enrich an upcoming film's DATE tab with one truthful context cue.
// Verified earlier installments beat genre; genre beats the release year.
// Collection membership alone is NOT sequel evidence: the first movie in a
// franchise belongs to its collection, too.
export function hasExplicitSequelNumber(title) {
  const value=String(title||'').trim();
  return /\b(?:part|chapter|episode|volume|vol\.?|film)\s*(?:[2-9]\d*|II|III|IV|V|VI|VII|VIII|IX|X)\b/i.test(value)
    || /(?:^|[\s:–-])(?:[2-9]\d*|II|III|IV|V|VI|VII|VIII|IX|X)$/i.test(value);
}
export function upcomingMovieContext(movie, date) {
  if (movie?._addonPriorCollectionMovie===true || hasExplicitSequelNumber(movie?.title || movie?.original_title)) return 'SEQUEL';
  const firstGenre=Array.isArray(movie?.genres) ? movie.genres.find(g=>typeof g?.name==='string' && g.name.trim())?.name : null;
  const compact={ 'Science Fiction':'SCI-FI', 'Documentary':'DOC', 'Animation':'ANIMATION',
    'Adventure':'ADVENTURE', 'Romance':'ROMANCE' };
  const genre=firstGenre && (compact[firstGenre] || firstGenre.toUpperCase());
  if (genre && genre.length<=14 && /^[A-Z][A-Z\s-]*$/.test(genre)) return genre;
  const year=validDay(movie?.release_date)?.slice(0,4) || validDay(date)?.slice(0,4);
  return year || 'MOVIE';
}
export function buildUpcomingMovies(candidates, now=new Date(), maxItems=50) {
  const rows=[];
  for (const row of candidates||[]) {
    const tmdb=row.details||row, premiere=pickMoviePremiere(tmdb,now,90);
    if (!premiere || !isQualityTitle(tmdb)) continue;
    const imdb=tmdb.imdb_id || tmdb.external_ids?.imdb_id;
    const entry=releaseEntry(tmdb,premiere.date,premiere.kind,'movie',imdb,now,scoreItem(tmdb),`${premiere.kind.charAt(0)+premiere.kind.slice(1).toLowerCase()} premiere${premiere.country?` (${premiere.country})`:''} on`);
    entry.tags.context=upcomingMovieContext(tmdb,premiere.date);
    entry.tags.main=`${entry.tags.context} · ${dateLabel(premiere.date)}`;
    entry.meta.releaseInfo=`${entry.tags.context} · ${premiere.kind} · ${dateLabel(premiere.date)}`;
    rows.push(entry);
  }
  return uniqueTop(rows,now,maxItems);
}
export function buildUpcomingShows(candidates, now=new Date(), maxItems=50) {
  const rows=[];
  for (const r of candidates||[]) {
    const tmdb=r.tmdb||r.details||r, season=Number(r.season||1);
    const date=validDay(r.date||tmdb.first_air_date);
    if (!isQualityTitle(tmdb,{tv:true}) || !date || date<day(now) || date>futureEnd(now,60) || season<1) continue;
    const imdb=r.imdb || tmdb.external_ids?.imdb_id || tmdb.imdb_id;
    const chip=season===1?'NEW SERIES':`SEASON ${season}`;
    const entry=releaseEntry(tmdb,date,chip,'series',imdb,now,scoreItem(tmdb,{tv:true,season}),season===1?'Series premiere on':`Season ${season} premiere on`);
    // Returning premieres show the season + air date in the same top tab.
    // New series show the date alone: NEW SERIES already appears in the
    // status pill below. This also drives Poster Studio previews.
    entry.tags.main = season > 1 ? `S${season} · ${dateLabel(date)}` : dateLabel(date);
    entry.tags.statusKey = season===1?'newSeries':'returning';
    entry.tags.season = season;
    entry.tags.next = Boolean(r.next);
    entry.tags.compactDate = true;
    if(r.tvmazeUrl)entry.meta.links.push({name:'Schedule on TVmaze',category:'tvmaze',url:r.tvmazeUrl});
    rows.push(entry);
  }
  return uniqueTop(rows,now,maxItems);
}
function uniqueTop(rows, now, maxItems) {
  rows.sort((a,b)=>rank(a,b,now));
  const used=new Set(), unique=[];
  for(const row of rows) {
    // Dedupe by TMDB ID even if one source has IMDb while another does not.
    const id=row.meta.links[0]?.url;
    if(used.has(id)) continue;
    used.add(id); unique.push(row);
    if(unique.length>=maxItems)break;
  }
  return unique;
}
