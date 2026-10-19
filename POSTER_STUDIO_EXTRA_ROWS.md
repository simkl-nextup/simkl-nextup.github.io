# Poster Studio — Home Releases + Global Discovery

Open `https://simkl-nextup.github.io/studio.html` after deploying and running the refresh workflow.

## Editable tabs

- **Home Releases** — unchanged BetterPosters base image, with the independently editable date tab and digital/physical side chip.
- **Upcoming Movies** — full **Up Next-style** local TMDB poster, textless artwork + title logo when available, rounded date tab, bottom status pill. Editable status colours: THEATRICAL, STREAMING, LIMITED, PREMIERE. Editable top size/contrast/outline/shadow, and toggle for star ratings.
- **Upcoming TV Shows** — full **Up Next-style** local TMDB poster, top air date, bottom NEW SERIES or RETURNING status. Editable colours, date tab, rating switch and NEXT toggle. NEXT only applies to *returning series* present in Account 2's Simkl Watching/Plan to Watch states. No independent side/status chip duplicates.

The original **Anime** and **TV** Studio controls are unchanged. **Smart Shuffle** has no custom Studio tab: tagged titles reuse the finished Home Releases posters, and all other movies retain their unmodified BetterPosters artwork.

### Controls

All three additional tabs retain separate top size, contrast, text outline, outline thickness and shadow controls. Upcoming tabs now also provide individual colour pickers for bottom status badges and the relevant NEXT/ratings controls. Values are saved in `config/poster-style.json` with the previous anime/TV options preserved. Upcoming source images are from TMDB only (no BetterPosters requests). Home Releases still uses BetterPosters and its original side-chip settings.

### Preview and deploy

Each refresh publishes up to six *local* untagged TMDB/BetterPosters base images (depending on row) under `account-2/studio/base/` plus their public color samples (`homeReleases.json`, `upcomingMovies.json`, `upcomingTV.json`). Studio previews the proposed overlays without posting access tokens or the Simkl watchlist. Saving commits only `config/poster-style.json` and starts the existing GitHub workflow. It uses the same manifest URL and requires no additional API service.

On first deployment, settings for the three new tabs initialize from the **previous TV top** and **Anime side** styles. Thereafter they are saved independently. This change does not modify the original row generation or sorting. The existing GitHub workflow restores Inter ExtraBold from earlier repository history; do not delete that history.
