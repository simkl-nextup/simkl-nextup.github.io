# Season label correction (2026-10-12)

This patch fixes a stale **S1** on posters for returning shows whose latest aired and next-unwatched episodes belong to **S2**. It does not hard-code any shows, seasons, or calendar dates.

## Changes

- `src/tvdb.mjs`: prefer a matching TVDB air date and episode over a stale Simkl season in position inference; provide `resolveTvdbEpisode` for selecting current episodes; reduce TVDB success cache TTL from 30 to 3 days, and invalidate old TVDB video caches once by bumping the metadata version to 4.
- `src/catalog.mjs`: resolve next and latest independently and stop reusing a stale `matchedVideoId`; keep anime sequel mapping in priority where appropriate; update both modern and classic poster episode labels, catalog episode labels, descriptions, and the default episode on detail pages.
- `.github/workflows/deploy.yml`: push to `main` under source/tests/scripts/workflow now immediately triggers a new build, not only changing poster-style config.
- `tests/catalog.test.mjs` and `tests/tvdb.test.mjs`: regression tests for Adults/MobLand S2 scenarios, genuine S1 scenarios, anime sequel entries, default-video IDs, and date-first mapping.

## Update procedure

1. Unzip this archive locally. Replace the matching source files in the existing repository without deleting repository Settings, Actions secrets, or GitHub Pages configuration.
2. Commit to the `main` branch. The workflow will build and deploy the two addon catalogs. You can also run **Actions → Refresh two Simkl catalogs and deploy Pages → Run workflow**.
3. Check Actions for a successful build and deployment. Wait for the client to refresh its cached catalog/poster; generated poster URLs change when their badge text changes.

**Limitations:** The ZIP contains repository source and the current placeholder public files, not your private Simkl state, access tokens, or a live rebuilt catalog. It cannot verify an individual's live episode list without the private GitHub Actions run. If the source episode dates or TVDB mapping are missing or wrong, badges still cannot be inferred with certainty. `npm ci && npm test` is the complete GitHub Actions validation command.

## Bundled font asset

Keep the existing `assets/fonts/Inter-ExtraBold.otf` from your GitHub repository. The replacement ZIP preserves the folder and font license but does not redistribute that binary font. **Do not delete that existing GitHub font file when applying these changes.**
