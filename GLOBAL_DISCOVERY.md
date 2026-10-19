# Worldwide Upcoming Movies + TV Shows (Account 2)

This implementation adds two public discovery rows to the **existing Account 2 manifest**:

- `Upcoming Movies` — `catalog/movie/global-upcoming-movies.json`
- `Upcoming TV Shows` — `catalog/series/global-upcoming-tv.json`

The installed manifest remains **`https://simkl-nextup.github.io/account-2/manifest.json`**. The original Account 2 TV row and personal Home Releases row are preserved. No Simkl list is read to build either discovery row. Anime Account 1 remains unchanged.

## What appears

**Movies:** Future commercial theatrical premieres and streaming-original first releases up to 90 calendar days ahead, across regions. US dates are preferred. A film that premiered overseas within 90 days can still appear for its upcoming US theatrical opening. Older films entering digital/home video are deliberately excluded (the separate personal Home Releases row handles those). Movie premieres with no reliable release details are omitted.

**TV:** Brand-new series (S1E1) and returning season premieres (S2E1, S3E1, etc.) up to 60 days ahead. Regular weekly episodes, specials, unscheduled seasons, talk shows, news, reality and game shows are excluded. Anime, Korean dramas and international scripted shows are eligible. TVmaze's global future schedule supplements TMDB's new-series discovery. A missing TVmaze schedule does not stop TMDB new-series discovery; see warnings in status.

**Curation:** The result is a high-signal, Netflix-style preview rather than a comprehensive TV calendar. Requires usable artwork, a meaningful description, a valid date and stable metadata ID. Shows are ranked first by proximity (within 7 days, 8–30 days, then later) and then by TMDB popularity/metadata quality. Up to 50 of each type are published. There may be fewer than 50 entries, which is preferable to padding with low-quality titles.

**Posters:** BetterPosters is used solely for the base artwork when an IMDb ID exists (`?tag=none`). The existing local renderer injects the adaptive-color **date tab** and an anime dub-style **left chip** for movies (`THEATRICAL` or `STREAMING`). Upcoming TV has **no redundant grey side chip**: the top tag reads `NEW SERIES · NOV 7` or `S3 · NOV 11`. Poster Studio now has separately editable Upcoming Movies and Upcoming TV tabs; they preserve the selected look on initial migration without changing Anime or TV. TMDB artwork is the fallback. No extra watchlist/status badge is added at the bottom.

## Data and attribution

- TMDB: worldwide upcoming movie/TV discovery, dates, popularity, IDs, and posters. Existing `TMDB_READ_ACCESS_TOKEN` secret is required; no new secret is needed.
- TVmaze: future first-episode/returning-season schedules. Their public `/schedule/full` endpoint can be large and is cached upstream for 24 hours. TVmaze data is CC BY-SA; credit appears on the Account 2 page and individual TVmaze-derived catalog entries link back to source listings.
- BetterPosters: optional poster base service. If it fails, TMDB artwork is used and **local top and side tags still render**.

External providers cannot guarantee a complete premiere calendar; missing or altered release dates may omit or reorder titles. TVmaze's primary airing date might not exactly match local streaming release time in every region. The refresh's `status.json` contains publication counts and warnings.

## Deployment

1. Replace files in your **existing** GitHub repository without deleting commit history. The existing workflow restores the original poster font from repository history.
2. Keep `SIMKL_CLIENT_ID`, `SIMKL_ACCESS_TOKEN`, `SIMKL_ACCESS_TOKEN_2`, and `TMDB_READ_ACCESS_TOKEN` configured as before.
3. Run Actions -> **Refresh Simkl and global upcoming releases**, or push to `main`.
4. Open `https://simkl-nextup.github.io/account-2/manifest.json` and confirm it declares **four catalogs**: TV Up Next, Home Releases, Upcoming Movies, Upcoming TV Shows.
5. Open `https://simkl-nextup.github.io/account-2/status.json` and check `discovery.upcomingMovies`, `discovery.upcomingTV`, `discovery.dataFetchedAt`, and `discovery.warnings`.
6. Restart/refresh Nuvio or Stremio. If it still shows only two rows, remove and reinstall the **same Account 2 manifest** to refresh its cached catalog declarations.

## Refreshing and caching

GitHub Actions still refreshes the personal rows hourly. The discovery build runs after them (they regenerate the output directory), so it cannot erase their rows. A private Actions cache stores **public discovery API responses** for ~22 hours and avoids refetching TMDB and the large TVmaze schedule every hour. Published poster assets are recreated during each Pages build. Private account information and API keys are never published. The state cache file is under `state/account-2/discovery-state.json`; it is **not** part of the public website or replacement ZIP.

## Tests

`npm ci && npm test` (requires original poster font to be present/restored from history) checks existing behavior plus release classification, upcoming-season-only logic, international and US priority, curation, full addon manifest integration, local poster rendering, image fallback, private API cache reuse, metadata collision protection, and TVmaze outages.
