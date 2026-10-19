# Worldwide Upcoming Movies + TV Shows (Account 2)

This implementation adds two public discovery rows to the **existing Account 2 manifest**:

- `Upcoming Movies` — `catalog/movie/global-upcoming-movies.json`
- `Upcoming TV Shows` — `catalog/series/global-upcoming-tv.json`

The installed manifest remains **`https://simkl-nextup.github.io/account-2/manifest.json`**. The original Account 2 TV row and personal Home Releases row are preserved. No Simkl list is read to build either discovery row. Anime Account 1 remains unchanged.

## What appears

**Movies:** Future commercial theatrical premieres and streaming-original first releases up to 90 calendar days ahead, across regions. US dates are preferred. A film that premiered overseas within 90 days can still appear for its upcoming US theatrical opening. Older films entering digital/home video are deliberately excluded (the separate personal Home Releases row handles those). Movie premieres with no reliable release details are omitted.

**TV:** Brand-new series (S1E1) and returning season premieres (S2E1, S3E1, etc.) up to 60 days ahead. Regular weekly episodes, specials, unscheduled seasons, talk shows, news, reality and game shows are excluded. Anime, Korean dramas and international scripted shows are eligible. TVmaze's global future schedule supplements TMDB's new-series discovery. A missing TVmaze schedule does not stop TMDB new-series discovery; see warnings in status.

**Curation:** The result is a high-signal, Netflix-style preview rather than a comprehensive TV calendar. Requires usable artwork, a meaningful description, a valid date and stable metadata ID. Shows are ranked first by proximity (within 7 days, 8–30 days, then later) and then by TMDB popularity/metadata quality. Up to 50 of each type are published. There may be fewer than 50 entries, which is preferable to padding with low-quality titles.

**Posters:** Both Upcoming rows now use the **exact Up Next poster engine**: TMDB textless artwork when available, an optional TMDB title logo, local fallback title, adaptive rounded date tab, color-coded bottom status pill, and an optional star rating. BetterPosters is **never called for Upcoming Movies or Upcoming TV**. Movie statuses are THEATRICAL (red), STREAMING (blue), LIMITED (amber), and PREMIERE (teal). TV statuses are NEW SERIES (gold) and RETURNING (purple). For an upcoming *returning* series in the Account 2 Watching/Plan to Watch list, verified next-to-watch episode information appears inline in the top tag. New series display TMDB genre + date in their top tag where available. No `null` or generic `NEXT` chip appears. Every control is independent in Poster Studio. Home Releases and Smart Shuffle continue using their original BetterPosters poster logic.

## Data and attribution

- TMDB: worldwide upcoming movie/TV discovery, dates, popularity, IDs, and posters. Existing `TMDB_READ_ACCESS_TOKEN` secret is required; no new secret is needed.
- TVmaze: future first-episode/returning-season schedules. Their public `/schedule/full` endpoint can be large and is cached upstream for 24 hours. TVmaze data is CC BY-SA; credit appears on the Account 2 page and individual TVmaze-derived catalog entries link back to source listings.
- Upcoming posters do not depend on BetterPosters. Home Releases/Smart Shuffle retain their existing separate BetterPosters handling.

External providers cannot guarantee a complete premiere calendar; missing or altered release dates may omit or reorder titles. TVmaze's primary airing date might not exactly match local streaming release time in every region. The refresh's `status.json` contains publication counts and warnings.

## Deployment

1. Replace files in your **existing** GitHub repository without deleting commit history. The existing workflow restores the original poster font from repository history.
2. Keep `SIMKL_CLIENT_ID`, `SIMKL_ACCESS_TOKEN`, `SIMKL_ACCESS_TOKEN_2`, and `TMDB_READ_ACCESS_TOKEN` configured as before.
3. Run Actions -> **Refresh Simkl and global upcoming releases**, or push to `main`.
4. Open `https://simkl-nextup.github.io/account-2/manifest.json` and confirm it declares **five catalogs**: TV Up Next, Home Releases, Upcoming Movies, Upcoming TV Shows, Smart Shuffle.
5. Open `https://simkl-nextup.github.io/account-2/status.json` and check `discovery.upcomingMovies`, `discovery.upcomingTV`, `discovery.dataFetchedAt`, and `discovery.warnings`.
6. Restart/refresh Nuvio or Stremio. If it still shows only two rows, remove and reinstall the **same Account 2 manifest** to refresh its cached catalog declarations.

## Refreshing and caching

GitHub Actions still refreshes the personal rows hourly. The discovery build runs after them (they regenerate the output directory), so it cannot erase their rows. A private Actions cache stores **public discovery API responses** for ~22 hours and avoids refetching TMDB and the large TVmaze schedule every hour. Published poster assets are recreated during each Pages build. Private account information and API keys are never published. The state cache file is under `state/account-2/discovery-state.json`; it is **not** part of the public website or replacement ZIP.

## Tests

`npm ci && npm test` (requires original poster font to be present/restored from history) checks existing behavior plus release classification, upcoming-season-only logic, international and US priority, curation, full addon manifest integration, local poster rendering, image fallback, private API cache reuse, metadata collision protection, and TVmaze outages.

### Upcoming Movies — contextual date tab (October 2026)

The existing top date tab now includes **one** contextual cue, then the confirmed
premiere date, e.g. `SEQUEL · OCT 23`, `HORROR · OCT 23`, or `2026 · OCT 23`.
The priority is **confirmed sequel → first available TMDB genre → release year**.
For a collection movie, the build queries the TMDB collection once per daily
snapshot and only calls the movie a sequel when another installment has an
earlier release date. Recognizable numerical sequel titles also qualify. Mere
franchise membership is not evidence of a sequel; ambiguous movies remain
classified by genre/year. The bottom THEATRICAL/STREAMING/LIMITED/PREMIERE pill
and the Upcoming TV top tab are unchanged. The first refresh after this change
invalidates the old discovery snapshot so context data can be populated.
