import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickMoviePremiere, isTvmazePremiere, tvmazePremieres,
  isQualityTitle, buildUpcomingMovies, buildUpcomingShows,
  dateLabel, tier,
} from '../src/discovery.mjs';
const now=new Date('2026-10-19T12:00:00Z');
const event=(type, date)=>({type,release_date:`${date}T00:00:00.000Z`});
const release=(country,values)=>({iso_3166_1:country,release_dates:values});
const poster='/poster.jpg', overview='A richly imagined series full of tense character drama and twists.';
const film=(id,date,more={})=>({id,title:`Movie ${id}`,poster_path:poster,overview,popularity:20,release_dates:{results:[release('US',[event(3,date)])]},...more});
const show=(id,name='Example Show')=>({id,name,poster_path:poster,overview,popularity:30,genre_ids:[18],first_air_date:'2026-11-19'});
const ep=(season,number,airdate,showOverride={})=>({season,number,airdate,show:{id:99,name:'Excellent Drama',type:'Scripted',genres:['Drama'],...showOverride}});

test('movie upcoming considers only commercial premieres; festival dates are not home releases',()=>{
  const result=pickMoviePremiere({release_dates:{results:[
    release('GB',[event(1,'2026-06-01'),event(3,'2026-11-05')]),
    release('US',[event(3,'2026-11-19')]),
  ]}},now);
  assert.equal(result.date,'2026-11-19'); assert.equal(result.kind,'THEATRICAL'); assert.equal(result.firstWorldwide,'2026-11-05');
});
test('international-only dates are included and non-US premiere is selected',()=>{
  const result=pickMoviePremiere({release_dates:{results:[release('JP',[event(3,'2026-11-18')])]}},now);
  assert.equal(result.country,'JP');
});
test('films already commercially premiered cannot re-enter on delayed digital dates',()=>{
  const result=pickMoviePremiere({release_dates:{results:[release('US',[event(3,'2026-07-01'),event(4,'2026-11-01')])]}},now);
  assert.equal(result,null);
});
test('physical reissues cannot count as new premieres',()=>{
  const result=pickMoviePremiere({release_dates:{results:[release('US',[event(3,'2025-07-01'),event(5,'2026-10-26')])]}},now);
  assert.equal(result,null);
});
test('a streaming-original digital launch without theatrical dates is eligible',()=>{
  const result=pickMoviePremiere({release_dates:{results:[release('KR',[event(4,'2026-11-14')])]}},now);
  assert.equal(result.kind,'STREAMING');
});
test('movies outside 90 days, missing dates, and movies starting yesterday are excluded',()=>{
  assert.equal(pickMoviePremiere(film(1,'2027-02-01'),now),null);
  assert.equal(pickMoviePremiere(film(1,'2026-10-18'),now),null);
  assert.equal(pickMoviePremiere({release_dates:{results:[]}},now),null);
});
test('TVmaze includes season premieres, not weekly episodes or specials',()=>{
  assert.equal(isTvmazePremiere(ep(1,1,'2026-11-03'),now),true);
  assert.equal(isTvmazePremiere(ep(3,1,'2026-11-03'),now),true);
  assert.equal(isTvmazePremiere(ep(3,2,'2026-11-10'),now),false);
  assert.equal(isTvmazePremiere(ep(0,1,'2026-11-03'),now),false);
  assert.equal(isTvmazePremiere(ep(3,1,'2027-04-02'),now),false);
});
test('TVmaze rejects reality, talk, game, and news but keeps global drama',()=>{
  assert.equal(isTvmazePremiere(ep(2,1,'2026-11-04',{type:'Reality'}),now),false);
  assert.equal(isTvmazePremiere(ep(2,1,'2026-11-04',{genres:['Talk']}),now),false);
  assert.equal(isTvmazePremiere(ep(2,1,'2026-11-04',{name:'Evening News'}),now),false);
  assert.equal(isTvmazePremiere(ep(2,1,'2026-11-04',{name:'한국 드라마',type:'Scripted'}),now),true);
});
test('TVmaze deduplicates upcoming season premiere per show',()=>{
  const entries=tvmazePremieres([ep(2,1,'2026-11-10'),ep(3,1,'2026-12-01'),ep(2,2,'2026-11-17')],now);
  assert.equal(entries.length,1);assert.equal(entries[0].date,'2026-11-10');
});
test('empty artwork or overview cannot dominate discovery',()=>{
  assert.equal(isQualityTitle({...show(1),poster_path:null},{tv:true}),false);
  assert.equal(isQualityTitle({...show(1),overview:'?'},{tv:true}),false);
  assert.equal(isQualityTitle({...show(1),genre_ids:[10764]},{tv:true}),false);
});
test('movies sort by near-term window and then anticipation, duplicates removed',()=>{
  const candidates=[
    film(2,'2026-11-03',{popularity:100}),
    film(1,'2026-10-23',{popularity:3}),
    film(3,'2026-10-23',{popularity:70}),
    film(2,'2026-11-03',{popularity:100}),
  ];
  const entries=buildUpcomingMovies(candidates,now);
  assert.deepEqual(entries.map(x=>x.meta.id),['tmdb:3','tmdb:1','tmdb:2']);
  assert.equal(entries[0].tags.main,'OCT 23');
  assert.equal(entries[0].tags.statusKey,'theatrical');
});
test('series and returning seasons expose stable metadata and correct tags',()=>{
  const entries=buildUpcomingShows([
    {tmdb:show(1),season:1,date:'2026-11-19'},
    {tmdb:show(2,'Second Season'),season:2,date:'2026-11-20',imdb:'tt1234567'},
    {tmdb:show(3,'Weekly Episode'),season:2,date:'2026-10-11'},
  ],now);
  assert.equal(entries.length,2);
  const bySeason = Object.fromEntries(entries.map(x => [x.tags.statusKey, x.tags]));
  assert.equal(bySeason.newSeries.main,'NOV 19');
  assert.equal(bySeason.newSeries.season,1);
  assert.equal(bySeason.returning.main,'NOV 20');
  assert.equal(bySeason.returning.season,2);
  assert.ok(entries.some(x=>x.meta.id==='tt1234567' && x.meta.type==='series'));
  assert.ok(entries.every(x=>x.meta.poster.startsWith('https://')));
});
test('dates are labeled in UTC and near-term tier boundaries are stable',()=>{
  assert.equal(dateLabel('2026-11-05'),'NOV 5');
  assert.equal(tier('2026-10-26',now),0);
  assert.equal(tier('2026-10-27',now),1);
  assert.equal(tier('2026-11-19',now),2);
});

test('recent overseas theatrical opening does not hide a confirmed upcoming US debut',()=>{
  const releaseDates={release_dates:{results:[
    release('FR',[event(3,'2026-10-01')]),release('US',[event(3,'2026-11-10')]),
  ]}};
  const candidate=pickMoviePremiere(releaseDates,now);
  assert.equal(candidate.country,'US');
  assert.equal(candidate.date,'2026-11-10');
});

test('movie statuses distinguish limited, streaming and festival-only premieres',()=>{
  const entries=buildUpcomingMovies([
    film(11,'2026-11-07',{release_dates:{results:[release('US',[event(2,'2026-11-07')])]}}),
    film(12,'2026-11-08',{release_dates:{results:[release('US',[event(4,'2026-11-08')])]}}),
    film(13,'2026-11-09',{release_dates:{results:[release('US',[event(1,'2026-11-09')])]}}),
  ],now);
  assert.deepEqual(new Set(entries.map(e=>e.tags.statusKey)),new Set(['limited','streaming','premiere']));
  assert.ok(entries.every(e=>e.meta.poster.startsWith('https://image.tmdb.org/')));
});
