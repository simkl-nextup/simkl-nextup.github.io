# My Anime Up Next · Simkl

A personal Stremio/Nuvio project that publishes two isolated rows from the same GitHub repository: the existing root addon reads **anime** from account 1, while `/account-2/` reads normal **TV shows** from account 2. Each row combines its Simkl **Watching** and **Plan to Watch** lists, plus previously **Completed** titles that receive an additional episode, and bumps a title whenever a new episode airs.

Optional TMDB enrichment replaces Simkl's smaller artwork with clean `w500` posters and `w1280` backdrops. MDBList is used only as an ID-mapping fallback when Simkl lacks IMDb, TMDB and TVDB identifiers.

Optional TheTVDB enrichment adds English series/episode metadata, high-resolution episode stills, aired-order seasons, and cross-record grouping. When TheTVDB stores anime sequels as separate series, the addon can merge matching records into one Nuvio detail page while retaining each source episode ID so watched-state sync continues to work.

Each generated poster uses large left-edge ribbons. Watching cards now show three clearly labelled rows: green **NEW EPISODE**, a dark-green **NEW · EP 11** row for the latest aired release, and a blue **NEXT · EP 5** row for your next unwatched episode. Plan to Watch and revived Completed cards use one labelled detail row beneath their gold or purple status ribbon. Thick black text outlines plus a compact drop shadow improve legibility on television screens without covering Nuvio's native top-right checkmark.

For Watching titles, the poster therefore distinguishes the latest available episode from the episode you should play next. The sorting timestamp comes from the show's latest aired episode, so a title is bumped even when you are several episodes behind. Plan to Watch titles display their latest aired episode and are bumped on every subsequent release. A Completed title re-enters only when the calendar reports an episode number beyond its saved watched count, then disappears after the new episode is recorded. Future-only titles remain excluded until an episode actually airs.

Anime seasons are often separate Simkl titles. TheTVDB mode now also scans completed sibling entries in your Simkl library, allowing an active sequel card to expose earlier seasons. The catalog still only surfaces titles that meet the Up Next rules; completed siblings are used as metadata sources rather than added as extra cards.

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

Recommended artwork secret:

| Secret | Value |
|---|---|
| `TMDB_READ_ACCESS_TOKEN` | The long TMDB API Read Access Token beginning with `eyJ`, not the short API key |

Optional metadata fallback:

| Secret | Value |
|---|---|
| `MDBLIST_API_KEY` | Your MDBList API key; queried only when strong external IDs are missing |

Optional TheTVDB metadata and season grouping:

| Secret | Value |
|---|---|
| `TVDB_API_KEY` | Your TheTVDB v4 project API key |
| `TVDB_SUBSCRIBER_PIN` | Leave absent unless your specific TVDB key requires a subscriber PIN |

Optional TheTVDB repository variables:

| Variable | Value |
|---|---|
| `TVDB_LANGUAGE` | Leave blank for English (`eng`) |
| `TVDB_SEASON_TYPE` | Leave blank for the series default order |

Optional repository variable:

| Variable | Value |
|---|---|
| `PUBLIC_BASE_URL` | Only needed for a custom domain; for example `https://anime.example.com` |

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

## Second Simkl account for normal TV shows

Version 1.8.9 keeps the existing root anime addon unchanged and publishes account 2 as a fully isolated normal-TV addon:

```text
Primary:  https://simkl-nextup.github.io/manifest.json
Account 2: https://simkl-nextup.github.io/account-2/manifest.json
```

Account 2 reads Simkl's `shows` library and `tv_shows` activity timestamps, not the anime library. It uses `SIMKL_ACCESS_TOKEN_2`, an optional `SIMKL_CLIENT_ID_2`, a unique TV addon/catalog identity, its own output folder, and a fresh TV-specific Actions cache. The existing root account retains its current URL, anime IDs, secret names, and cache path. See [`SECOND_ACCOUNT_SETUP.md`](SECOND_ACCOUNT_SETUP.md) for the upload and deployment steps.

## Refresh behavior

- The first run pulls your Anime library once and locally keeps Watching, Plan to Watch, and Completed so revived titles can be detected.
- Later runs call `/sync/activities` first.
- `/sync/all-items` is called only when Simkl reports changed anime activity.
- Delta changes are merged into a private GitHub Actions cache.
- The Simkl v2 rolling calendar plus the unversioned current/previous-month archives correct rescheduled air times and track the latest aired episode for all eligible statuses.
- TMDB artwork and resolved IDs are cached in the private sync state for 30 days, keeping API usage low.
- TheTVDB series translations, episodes, and grouping decisions are cached in the same private state. English is fetched through the explicit series translation endpoint rather than trusting the record's original-language name.
- Watching, Plan to Watch, and Completed library entries are metadata-enriched so an active sequel can be joined to older completed seasons without publishing those older entries as separate cards.
- If multiple TVDB records map to the same TMDB television show, they are merged using that shared show ID. Without TMDB, a conservative English-title/season-marker fallback can merge obvious sequel records.
- Merged detail pages use a private parent ID but preserve the original IMDb/TVDB episode IDs. This is intentional: changing those episode IDs would break Nuvio watched markers.
- For broader desktop-client compatibility, the manifest declares `meta` through the classic top-level resource list and publishes the supported ID prefixes at the manifest root. Unified episode lists and the default episode are also embedded in each catalog preview, in addition to the dedicated `/meta/series/{id}.json` response.
- Simkl artwork remains the automatic fallback when TMDB has no match or no TMDB token is configured.
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

## Updating from 1.8.0 to 1.8.1

Version 1.8.1 fixes two problems in the first TVDB build:

- series names now prefer the requested English TVDB translation instead of the original Japanese record name;
- separate TVDB sequel records can be merged into one parent page, while every episode keeps its original IMDb/TVDB tracking ID.

The private state version advances to 7, so the first deployment after replacing the files performs a clean Simkl/metadata rebuild. That first run can take longer because completed sibling entries are enriched once for grouping. Keep `TVDB_LANGUAGE` blank or set it to `eng`, run the refresh workflow, and then clear Nuvio's metadata cache or remove/re-add the addon.

## Updating from 1.8.1 to 1.8.2

Version 1.8.2 targets Nuvio Desktop's less complete custom-metadata path and improves television readability:

- the manifest now uses the classic top-level `catalog` and `meta` resource declaration with root-level ID prefixes;
- a unified card carries its complete season/episode list and default episode directly in the catalog preview as a fallback, while the normal dedicated metadata file remains available;
- Watching posters separately label the latest aired release as **NEW** and your next unwatched episode as **NEXT**;
- all status and episode lettering has a thicker black outline and stronger shadow for TV displays.

After replacing the repository files, run the refresh workflow, then fully remove and re-add the addon or clear metadata/image caches on Nuvio Desktop. The poster style version changed, so the generated image URLs will also change automatically. If grouping still works on Android but not Desktop after a clean re-import, the remaining issue is in the Desktop client's handling of custom parent metadata rather than the TVDB mapping generated by this addon.

## Updating to 1.8.4 — TV logo layout

Version 1.8.4 replaces the oversized stacked top ribbons with a television-first composition inspired by BetterPosters:

- one compact status pill is centred at the very top;
- episode numbers are anchored in a separate high-contrast panel at the bottom edge;
- TMDB image metadata is requested with `images` appended so the generator can prefer a textless poster and place the English title logo in the reserved lower area;
- when no TMDB logo is available, the show name is rendered as a high-contrast fallback in the same space;
- the lower vignette keeps the logo readable without covering the artwork, and the poster style signature advances so clients receive fresh URLs.

No new secret is required beyond the existing `TMDB_READ_ACCESS_TOKEN`. After replacing the files, run the refresh workflow and clear Nuvio's image cache or remove and re-add the addon if the previous posters remain.

## Local development

```bash
npm test
npm run build:placeholder
npm run keepalive
SIMKL_CLIENT_ID=... SIMKL_ACCESS_TOKEN=... TMDB_READ_ACCESS_TOKEN=... npm run refresh
npm run verify
```

Node.js 20.9+ is required. Sharp is the only runtime package and performs the poster compositing locally inside GitHub Actions.

## Privacy

- All configured API credentials are read only from GitHub Secrets and are scanned against generated output before deployment.
- Sync state is stored in the GitHub Actions cache, not committed to the repository or published by Pages.
- The final catalog and generated poster images are public to anyone who knows the Pages URL. This is required so Nuvio/Stremio can request them without authentication.

## Simkl attribution and API use

Tracking and schedule data is provided by [Simkl](https://simkl.com). This project uses Simkl's documented two-phase sync model, v2 rolling calendar, and monthly calendar archives. It is intended for personal, non-commercial use.

Artwork can be provided by [TMDB](https://www.themoviedb.org). This product uses the TMDB API but is not endorsed or certified by TMDB.

TOP Posters is intentionally not called directly because its API key would appear inside each poster URL. Version 1.6 creates the badges locally in GitHub Actions instead, without another API or credential.

## v1.8.6 badge styling

The TV-readable top/bottom composition now uses the exact v1.8.2 badge palette and treatment: green/gold/purple status gradients, green/blue/dark episode gradients, white highlights, dark lower edges, heavy Arial text, black text outlines, gloss, and the original shadow strength. The logo-safe lower composition remains unchanged.

## Updating to 1.8.7 — two isolated Simkl accounts

Version 1.8.7 added an optional second generation pass under `public/account-2`. The root addon keeps its original manifest URL, addon ID, catalog ID, Simkl secrets, state path, and cache prefix. Account 2 is enabled only when `SIMKL_ACCESS_TOKEN_2` exists. Both outputs are verified before the combined GitHub Pages artifact is deployed.

## Updating to 1.8.8 — account 2 reads normal TV shows

Version 1.8.8 fixes the empty account-2 catalog by making media type configurable per generation pass. The root remains `MEDIA_TYPE=anime`; account 2 now uses `MEDIA_TYPE=tv`, `/sync/all-items/shows`, `/tv/{id}`, and `tv_shows` activity timestamps. Its addon ID is `community.simkl.new-tv-episodes.account2` and its catalog ID is `simkl-new-tv-episodes-account2`. A new `simkl-account-2-tv-state-` cache prefix forces a clean TV bootstrap without clearing or rebuilding the root anime cache.


## Updating to 1.9.1 — direct season-premiere detection, no history required

1.9.0's revival fix relied on having seen a title while it was still genuinely Completed, so it could remember a watched-count snapshot to compare against later. That means any title Simkl had *already* silently auto-promoted to Watching before 1.9.0 was deployed never got a snapshot, and stayed on the green badge.

1.9.1 adds a second, primary check that needs no history at all: if the very next unwatched episode is literally episode 1 of a season after the first, and it aired less than 365 days ago, the title is treated as a revived Completed title — purple badge — regardless of what Simkl's own status field says or whether the addon ever saw it as Completed. The moment that episode is watched, the badge reverts to normal Watching behavior. The 365-day rolling window (measured from the episode's actual air date, not the calendar year) means a revival that airs in November doesn't silently flip to green on January 1st just because the year changed.

The 1.9.0 watched-count snapshot method is kept as a fallback for the rare title Simkl hasn't matched to TVDB and that also has no season number on its next-to-watch info.

## Updating to 1.9.0 — revived-title badge fix and a reliable deploy queue

Version 1.9.0 fixes two problems found in production on a two-account deployment:

- **Wrong badge on a just-revived title.** Simkl moves a title from Completed back into Watching itself the moment a new season is confirmed on TVDB/AniDB — before any episode is watched. Previously the addon trusted Simkl's `status` field directly, so a title like this rendered the green "NEW EPISODE" badge instead of purple "NEW SEASON", and revived Completed titles essentially never published (0 of 91 tracked Completed anime were making it into one real deployment's catalog). The addon now remembers the watched-episode count from the last time a title was genuinely completed and compares against it, so the purple "NEW SEASON" badge stays in place until watched progress actually moves — regardless of which list Simkl has silently filed the title under.
- **Deployment stuck looping on `deployment_queued`.** The 1.8.9 workflow cancelled in-progress runs (`cancel-in-progress: true`) across both the build *and* deploy jobs. Cancelling a job after it has already registered a deployment with GitHub Pages doesn't retract that deployment — it orphans it, and the next run's deploy step then polls a queue that never clears. Concurrency is now split per job: the build job can still cancel a stale run freely, but the deploy job uses a fixed `pages` group with `cancel-in-progress: false`, matching GitHub's own Pages deployment template, so deployments queue instead of colliding.

No new secret is required. After replacing the repository files, run the refresh workflow; titles whose badge status changes will automatically get a fresh poster URL.

## Updating to 1.8.9 — reliable two-account Pages deployment

Version 1.8.9 keeps account 1 as anime and account 2 as normal TV. It splits generation and deployment into separate jobs, cancels stale overlapping refreshes, extends the GitHub Pages deployment wait from 10 to 30 minutes, and explicitly asserts that account 2 generated `mediaType: tv` with the TV addon and catalog IDs before any deployment is attempted. Uploading this release creates a fresh commit/build version, which avoids re-running the already-canceled Pages deployment attached to the previous commit.
