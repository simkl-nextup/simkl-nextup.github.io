# Account 2: Movie Home Releases

## Install/update

1. Replace your repository files with this ZIP's contents, preserving paths. Do not delete GitHub Actions secrets or the repository's existing Git history.
2. Confirm these Secrets: `SIMKL_CLIENT_ID` (or `SIMKL_CLIENT_ID_2`), `SIMKL_ACCESS_TOKEN_2`, and `TMDB_READ_ACCESS_TOKEN`.
3. Set GitHub Pages deployment to **GitHub Actions**.
4. Run **Actions → Refresh Simkl anime, TV and home-release movies → Run workflow** (or push to `main`).
5. Check `https://simkl-nextup.github.io/account-2/manifest.json` for **two** catalogs: existing `series` TV and new `movie` home releases.
6. Check `/account-2/status.json` → `movieRow` for counts and warnings. An empty movie row can be correct if no movie has qualifying release dates.
7. Refresh/reload your existing Account 2 addon in Stremio/Nuvio if the new movie catalog is not yet visible. You do not need to add another addon URL.

## Release rules (last 6 calendar months + 30-day Coming Soon)

- **Source:** only movies in Account 2's Simkl `plantowatch` list.
- **Theatrical releases:** ignored. TMDB release types `1` (premiere), `2` (limited theatrical), `3` (theatrical), and `6` (TV) cannot qualify a movie.
- **Home release:** TMDB type `4` is Digital; type `5` is Physical.
- **Anywhere, US priority:** any country can qualify. If already available somewhere, label it Released even when a later US release is announced. For a format with a past US release date, prefer the US date; otherwise use its worldwide date. For future releases within 30 days, prefer known US dates inside the window, then the earliest worldwide date.
- **Coming Soon:** only when the movie has never had a known home release and its first confirmed type-4 or type-5 date is within the next 30 calendar days. No known home date means the movie stays hidden, even if it opened in theaters yesterday.
- **Released:** when today reaches a known type-4 or type-5 event anywhere, provided its **first known home release worldwide** happened during the last **six calendar months**. Label Digital, Physical, or Both as applicable.
- **Sort:** available movies first, newest actual home-release event first; then Coming Soon, nearest date first. An old movie added to your list does not become #1 simply because it was added today. A later physical release can bump an already-digital title.
- **Lifetime:** exits automatically once the first known worldwide home-release date becomes older than six calendar months, or earlier if it leaves Simkl Plan to Watch. A later disc reissue cannot resurrect a title originally available years earlier. The six months are *calendar months*, not an approximation of 180 days.

## Posters

1. Base artwork: `https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg?tag=none`.
2. Locally generated **TV-row top tab** (your selected Poster Studio design): **OCT 19** for released movies, **COMING SOON · NOV 7** for future home releases. It shares the TV row’s font, adaptive background, contrast, outline and shadow settings.
3. Locally generated **anime-dub-style left chip**, using the *same rendering functions* and live anime settings: **DIGITAL**, **PHYSICAL**, or **DIGITAL + PHYSICAL**. Released format chips use the dub-ready blue; Coming Soon uses the dub-behind gray.
4. No extra **PLAN TO WATCH** lower tag. BetterPosters retains its base design, including its lower genre/rating details; the release tags are applied by the existing local poster renderer.
5. TMDB artwork is the fallback if the BetterPosters image fails or an IMDb ID isn't available, still with locally rendered release tags.

Posters are generated on GitHub Actions and hosted under `/account-2/posters/movie-releases/`. The manifest and movie metadata point at the locally tagged poster URLs. Artwork fetch or overlay failure stops the new deployment rather than publishing incorrect untagged posters.

## Repo changes

- `src/movie-releases.mjs`: home-release selection, US/worldwide fallback, date window, output shape and sorting.
- `src/movie-posters.mjs`: BetterPosters image download, then shared TV/anime renderer for the top tab and side chip.
- `scripts/refresh-movies.mjs`: Simkl Plan to Watch movies sync, TMDB release-date enrichment, private cache and append to the existing Account 2 manifest.
- `.github/workflows/deploy.yml`: the movie build, state cache, and checks after Account 2 TV generation.
- `scripts/verify-output.mjs`: verifies the existing TV row plus the new movie row before deploying.
- `tests/movie-releases.test.mjs`, `tests/movie-refresh.test.mjs`, and `tests/movie-poster-style.test.mjs`: date cutoffs, live-style poster rendering and mock end-to-end publishing tests.

## Known boundaries

- Movie dates depend on TMDB community data. An absent/inaccurate type-4 or type-5 record may hide a movie or show a wrong date; we do not guess from theatrical dates or assume streaming availability from movie `watch/providers` metadata.
- The private movie data cache is in GitHub Actions cache (`state/account-2/movie-release-state.json`) and never included in Pages. Unreleased and recent titles get TMDB date refresh checks about every three hours; old releases about every 72 hours. Scheduled workflows run hourly but GitHub can delay a schedule.
- This version intentionally uses the **same existing addon** for TV and movies. It cannot be tested against the private live Simkl/TMDB accounts without their credentials; the included tests exercise mocked API responses.
- This ZIP matches the uploaded source's existing font packaging: its existing workflow restores the poster font from historical Git commit `de46231` if absent. Do not replace your repo by creating an entirely new repository with no history unless you restore the required font independently. No fonts are included in the ZIP.
