# Upcoming poster rebuild + Smart Shuffle visibility compatibility

The existing Account 2 manifest URL remains unchanged:
`https://simkl-nextup.github.io/account-2/manifest.json`

## Upcoming posters
- Both Upcoming catalogs are independent of Simkl for **discovery**.
- Upcoming Movie statuses: THEATRICAL, STREAMING, LIMITED, PREMIERE; labels are drawn as the Up Next-style **bottom pills**, with a compact date tab at the top.
- Upcoming TV statuses: NEW SERIES, RETURNING; the top tab shows season/date for returning series and genre/date for new series. If a returning series is personally tracked, a verified next-to-watch episode may be added inline, never as a separate chip. This additional personal badge does not filter the global catalog.
- Both use TMDB poster artwork, textless assets/title logos when available, the same Up Next poster renderer, adaptive date tabs, optional star ratings and user-editable per-status colors in `studio.html`. They no longer fetch BetterPosters.
- Existing anime, TV, Home Releases and Smart Shuffle poster recipes are preserved.

## Smart Shuffle and Nuvio
A client-compatibility risk was found: Smart Shuffle was the only Account 2 catalog advertising an optional `skip` extra. Some static catalog clients may not show such catalogs. It is now advertised as a plain movie catalog, containing the **full** list at `catalog/movie/simkl-movies-smart-shuffle-account2.json`, without mandatory pagination. The optional static skip files remain for other clients. Account 2's manifest is versioned `1.15.0` to help clients pick up changes.

This is a preventive compatibility fix, **not proof** that the live Nuvio problem was caused by `skip`; live GitHub Pages responses were not accessible from the test environment. After deployment check the manifest has 5 catalogs and `status.json` has `smartShuffle.published > 0`. If the row is still absent despite a nonempty JSON catalog, remove and re-add the *same* Account 2 addon link to refresh Nuvio's cached manifest.

## Deployment and checks
1. Extract the replacement ZIP on top of your existing repository and commit to `main`, preserving history for the required Inter ExtraBold font. The font itself is deliberately not bundled in this ZIP.
2. Run GitHub Actions workflow `Refresh Simkl and global upcoming releases`.
3. Verify `/account-2/manifest.json` includes five catalog IDs and `/account-2/status.json` has `movieRow`, `discovery`, and `smartShuffle` data.
4. Verify `/account-2/catalog/movie/simkl-movies-smart-shuffle-account2.json` contains nonempty `metas` whenever the Simkl movie Plan to Watch list is nonempty and the items have IDs.
5. Open `/studio.html` to edit Upcoming Movies and Upcoming TV independently. Changes affect only their own generated artwork.

Tests run with `npm ci && npm test` when the build font is available.

## Returning-season top tab correction (Oct 19, 2026)

Upcoming TV posters and Poster Studio now show `S3 · OCT 23` (or another verified
season/date) for returning-season premieres; new series show a TMDB genre and date (`DRAMA · OCT 23`) where known,
otherwise just the date, with their `NEW SERIES` status pill. Only `src/discovery.mjs` and its
corresponding regression tests were updated. Home Releases, Smart Shuffle,
Upcoming Movies, and the existing Up Next rows are unchanged.

### Returning shows tracked in Account 2

The `NEXT` indicator now belongs to the **single top tab**, just like the TV
Up Next row, rather than a redundant side chip. The top tab shows the season,
premiere date and, where Simkl exposes it, the actual next unwatched episode:
`S3 · NOV 2 · Next E1` or `S3 · NOV 2 · Next S1E4`. If Simkl supplies no next-episode number, the build checks TVDB
absolute episode numbering and the existing Account 2 TV Up Next default-video
ID. If no trustworthy next position exists, it omits `NEXT` rather than
printing an unhelpful placeholder or guessing the premiere is next. The dedicated Upcoming TV Studio toggle controls this inline cue.

## Upcoming TV genre and verified NEXT fallback (Oct 19, 2026)

- **New series**: top tab now contains the first verified TMDB genre followed by
  the date (`DRAMA · OCT 30`, `SCI-FI · OCT 31`). Date-only when genre unknown.
  Bottom `NEW SERIES` status pill stays unchanged.
- **Returning series**: `S3 · NOV 2` and `RETURNING` stay unchanged. For tracked
  shows, add `Next E2` or `Next S1E4` only when the next position is proven by
  Simkl, TVDB watched-count/absolute episode mapping, or the existing TV Up Next
  catalog's canonical `defaultVideoId`.
- Never use a generic `NEXT` word when episode information is unavailable.
- Live Studio Upcoming TV previews and rendered posters follow the same rules.
- No changes to catalog membership, TV/Anime Up Next, Upcoming Movies, Home
  Releases, Smart Shuffle, or unrelated Studio settings.
