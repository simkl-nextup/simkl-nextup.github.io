# My Anime Up Next · Simkl

A personal, single-row Stremio/Nuvio addon. It combines anime from your Simkl **Watching** and **Plan to Watch** lists, plus previously **Completed** anime that receive an additional episode, and bumps a title to the top whenever a new episode airs.

Optional **TheTVDB v4 metadata** turns a seasonal Simkl card into a complete series page using TheTVDB's configured season order. The generated page includes every returned season and episode, episode descriptions, air dates, full TheTVDB episode stills, and canonical episode IDs such as `tt7654000:2:3`. When multiple eligible Simkl season entries resolve to the same TVDB series, the row publishes one card. Nuvio can then reconcile its Simkl watched state against ordinary IMDb/TVDB-style season and episode positions instead of a private synthetic ID. Nuvio ultimately controls watched checkmarks, so the addon improves compatibility but cannot force a marker when upstream IDs or season numbering disagree.

Optional TMDB enrichment remains available for poster and backdrop fallback. MDBList is used only as an ID-mapping fallback when Simkl lacks IMDb, TMDB and TVDB identifiers.

Each generated poster includes two large left-edge ribbons. The first identifies the source as green **NEW EPISODE** for Watching, gold **PLAN TO WATCH**, or purple **NEW SEASON** for a revived Completed title. The second shows the relevant episode, such as **EP 5** or **S03 · E06**. Heavy lettering, layered gradients, a gloss streak, highlighted edges, and deep shadows keep the labels readable on Nuvio's compact cards. The ribbons sit together at the top-left so Nuvio's native top-right checkmark remains unobstructed.

For Watching titles, the card still identifies your next unwatched episode. The sorting timestamp comes from the show's latest aired episode, so a title is bumped even when you are several episodes behind. Plan to Watch titles display their latest aired episode and are bumped on every subsequent release. A Completed title re-enters only when the calendar reports an episode number beyond its saved watched count, then disappears after the new episode is recorded. Future-only titles remain excluded until an episode actually airs.

Anime seasons are often separate Simkl titles. If a sequel season has a different Simkl ID, add that sequel itself to Watching or Plan to Watch; the addon intentionally does not infer that every sequel is wanted from a completed prequel.

## What the row includes

- Simkl status is `watching`, with a next unwatched episode already available; or
- Simkl status is `plantowatch`, with at least one aired episode observed by the addon; or
- Simkl status is `completed`, but a newly aired episode number exceeds the saved watched count.
- One card per anime: next unwatched episode for Watching, latest aired episode for Plan to Watch or revived Completed.
- Every new episode bumps its show to the top, regardless of which eligible list it is in.

It does **not** include recommendations, caught-up Completed anime, movies, On Hold, Dropped, or future-only episodes.

## Deployment

### 1. Create the repository

1. Create a new GitHub repository.
2. Upload all files from this project, preserving the folders.
3. A public repository works with GitHub Pages on GitHub Free. The generated catalog is publicly readable; the Simkl access token is not.

### 2. Register a Simkl API application

1. Open [Simkl developer settings](https://simkl.com/settings/developer/).
2. Create an application for personal/non-commercial use.
3. Copy its `client_id`.

### 3. Enable GitHub Pages and deploy the setup page

1. Open **Settings → Pages**.
2. Set **Source** to **GitHub Actions**.
3. Open **Actions → Deploy setup page only**.
4. Select **Run workflow**.

This publishes the included empty catalog and browser-based Simkl authorization page without requiring any secrets.

### 4. Authorize your Simkl account

Use either method:

- Run `npm run authorize -- YOUR_CLIENT_ID` with Node.js 20 or newer.
- Open `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/setup.html`, enter the client ID, approve the PIN at Simkl, and copy the resulting token.

Never commit the access token.

### 5. Add GitHub secrets

Open **Repository → Settings → Secrets and variables → Actions** and create:

| Secret | Value |
|---|---|
| `SIMKL_CLIENT_ID` | The app's Simkl client ID |
| `SIMKL_ACCESS_TOKEN` | The token returned by the PIN authorization |

Recommended unified-season metadata secret:

| Secret | Value |
|---|---|
| `TVDB_API_KEY` | A newly issued TheTVDB v4 project API key. Never commit it or paste it into an issue, screenshot, manifest, or source file. |
| `TVDB_SUBSCRIBER_PIN` | Optional. Add this only when your TVDB key model requires a subscriber PIN. |

A key exposed in a screenshot or chat must be revoked or rotated before deployment. The workflow authenticates through `/login`, keeps the bearer token only in memory during the run, and never publishes the key, PIN, or token.

Recommended artwork secret:

| Secret | Value |
|---|---|
| `TMDB_READ_ACCESS_TOKEN` | The long TMDB API Read Access Token beginning with `eyJ`, not the short API key |

Optional metadata fallback:

| Secret | Value |
|---|---|
| `MDBLIST_API_KEY` | Your MDBList API key; queried only when strong external IDs are missing |

Optional repository variables:

| Variable | Value |
|---|---|
| `PUBLIC_BASE_URL` | Only needed for a custom domain; for example `https://anime.example.com` |
| `TVDB_SEASON_TYPE` | Leave blank to use `default`, normally the series' default/aired order. Advanced users may supply another season type accepted by TheTVDB v4. |
| `TVDB_LANGUAGE` | Leave blank to use English episode metadata (`eng`). |

### 6. Run the personalized deployment

1. Open **Actions → Refresh Simkl catalog and deploy Pages**.
2. Select **Run workflow**.

The workflow runs tests, refreshes Simkl, verifies that no token reached the public files, and deploys the addon. It then refreshes once per hour at minute 23.

The same workflow also updates a harmless `.github/keepalive` marker once per month. That automated commit keeps the public repository active, preventing GitHub's 60-day inactivity rule from disabling the scheduled refresh. You do not need to remember to touch or re-enable it manually.

### 7. Install or import the addon

Your manifest URL will normally be:

```text
https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/manifest.json
```

Recommended for Nuvio:

1. In Xperience, choose **Import from another add-on**.
2. Paste the manifest URL.
3. Keep the single `My Anime Up Next · Simkl` row.
4. Push the profile to Nuvio.
5. Put the row where your broken Trakt `Your Recently Aired` row used to be.

Importing through Xperience gives it the best chance to normalize IMDb, TMDB, TVDB and anime IDs. Direct manifest installation also works best for titles carrying IMDb IDs.

## Refresh behavior

- The first run pulls your Anime library once and locally keeps Watching, Plan to Watch, and Completed so revived titles can be detected.
- Later runs call `/sync/activities` first.
- `/sync/all-items` is called only when Simkl reports changed anime activity.
- Delta changes are merged into a private GitHub Actions cache.
- The Simkl v2 rolling calendar plus the unversioned current/previous-month archives correct rescheduled air times and track the latest aired episode for all eligible statuses.
- TVDB series metadata and episodes are cached in the private sync state for 30 days; failed lookups retry after six hours. Only titles currently eligible for the row are queried.
- TVDB first uses a Simkl-provided TVDB ID; when only IMDb is available, it resolves the matching TVDB series through the remote-ID endpoint.
- TMDB artwork and resolved IDs are cached in the private sync state for 30 days, keeping API usage low.
- TVDB artwork is preferred on unified pages; TMDB and Simkl remain automatic fallbacks.
- The workflow downloads each published poster from an allowlisted HTTPS image host, adds the status and episode badges, and serves the resulting WebP from your own Pages site.
- Poster filenames are deterministic. If an image is unavailable or cannot be processed, that card keeps its original clean poster instead of failing the catalog deployment.
- If a token is revoked, deployment fails and the existing Pages version remains online.

GitHub schedules are best-effort and can occasionally run late. Use **Run workflow** for an immediate manual refresh.

GitHub automatically disables scheduled workflows in a public repository after 60 days without repository activity. This project avoids that condition through its monthly keepalive commit. Keep the default branch unprotected so `github-actions[bot]` can write that marker. If you later add branch protection that blocks automated pushes, explicitly allow GitHub Actions to push or the keepalive will fail. A private repository is not subject to the public-repository inactivity rule, although private Actions usage counts against your plan's included minutes.

## Updating from 1.4.0

Version 1.5.0 fixes the monthly calendar archive URL and normalizes its raw-array response. It also advances the private state format to version 5, so the first workflow run after replacement automatically performs one clean Simkl library pull. Do not delete your GitHub secrets or Actions caches manually.

After deployment, `status.json` reports both tracked and actually published counts for Watching, Plan to Watch, and revived Completed titles. This makes it possible to distinguish a healthy deployment from a row that silently omitted one of its sources.

## Updating to 1.6.4

Version 1.6 adds generated poster labels, 1.6.2 converts them into left-edge ribbons, and 1.6.3 maps Watching to green New Episode and revived Completed titles to purple New Season. Version 1.6.4 makes both ribbons substantially taller and heavier, with layered gradients and gloss for stronger small-card visibility. The poster style version changes so clients receive fresh image URLs instead of reusing cached artwork. Replace the repository files, commit `package-lock.json`, and run the personalized workflow. The workflow runs `npm ci` before testing and generation, so no new GitHub secret is required.

`status.json` reports `posterBadgesGenerated` and `posterBadgeWarnings`. A warning means that title safely retained its original poster. Set the workflow environment variable `POSTER_BADGES` to `false` only if you intentionally want to disable the generated overlays.

## Updating from 1.6.4 to 1.8.0

Version 1.8.0 is rebuilt directly from the original 1.6.4 repository and adds optional TheTVDB support without depending on the earlier synthetic-season implementation. Replace the repository files, add a rotated `TVDB_API_KEY` secret, and run the personalized workflow.

The private state format advances to version 6, so the first run performs a clean Simkl bootstrap and builds fresh TVDB metadata. The first TVDB-enabled run can take longer than later hourly refreshes. After deployment, remove and re-import the addon or clear Nuvio's metadata cache so it stops using the old per-season response.

When TVDB succeeds, `status.json` reports:

- `tvdbMetadataEnabled`
- `tvdbUnifiedTitles`
- `tvdbUnifiedSeasons`
- `tvdbUnifiedEpisodes`
- `tvdbCanonicalTrackingEpisodes`

A nonzero canonical-tracking count means the generated episodes use an IMDb parent ID in `tt…:season:episode` form. It confirms the addon output, not that Nuvio has successfully matched every watched episode.

## Local development

```bash
npm test
npm run build:placeholder
npm run keepalive
SIMKL_CLIENT_ID=... SIMKL_ACCESS_TOKEN=... TVDB_API_KEY=... TMDB_READ_ACCESS_TOKEN=... npm run refresh
npm run verify
```

Node.js 20.9+ is required. Sharp is the only runtime package and performs the poster compositing locally inside GitHub Actions.

## Privacy

- All configured API credentials are read only from GitHub Secrets and are scanned against generated output before deployment.
- Sync state is stored in the GitHub Actions cache, not committed to the repository or published by Pages.
- The final catalog and generated poster images are public to anyone who knows the Pages URL. This is required so Nuvio/Stremio can request them without authentication.

## Simkl attribution and API use

Tracking and schedule data is provided by [Simkl](https://simkl.com). This project uses Simkl's documented two-phase sync model, v2 rolling calendar, and monthly calendar archives. It is intended for personal, non-commercial use.

Unified metadata and episode artwork can be provided by [TheTVDB](https://thetvdb.com). The generated landing page includes a direct TheTVDB attribution link whenever that integration is enabled.

Artwork can also be provided by [TMDB](https://www.themoviedb.org). This product uses the TMDB API but is not endorsed or certified by TMDB.

TOP Posters is intentionally not called directly because its API key would appear inside each poster URL. Version 1.6 creates the badges locally in GitHub Actions instead, without another API or credential.
