# Poster Studio — Home Releases + Global Discovery

Open `https://simkl-nextup.github.io/studio.html` after deploying and running the refresh workflow.

## New tabs

- **Home Releases** — controls its adaptive date / Coming Soon top tab and independently controls the anime-dub-style digital/physical side chip.
- **Upcoming Movies** — controls its premiere date top tab and independently controls the THEATRICAL/STREAMING side chip.
- **Upcoming TV Shows** — controls the top tab containing `NEW SERIES · NOV 7` or `S3 · NOV 11`. The duplicated grey NEW SERIES/SEASON X side chip is **removed**.

The original **Anime** and **TV** Studio controls still work. **Smart Shuffle** has no separate tag renderer: it reuses finished tagged Home Releases posters and plain BetterPosters for other titles.

### Controls

Each extra row gets its own top-tag **size, contrast, white/dark text outline, outline thickness, and coloured shadow** options. Rows with side chips also get separate **size, white text outline, outline thickness, and shadow** options.

The `look`, `topTab` presets, and rating shadow switches are not shown for these three rows because those options do not affect a BetterPosters base image with a single top tab. This prevents settings that appear editable but do nothing. Existing custom source configurations continue to parse.

### Preview and deploy

Each refresh publishes up to six untagged *local* BetterPosters/TMDB preview images under `account-2/studio/base/` plus their public color samples (`homeReleases.json`, `upcomingMovies.json`, `upcomingTV.json`). Studio previews the proposed overlays without posting access tokens or the Simkl watchlist. Saving commits only `config/poster-style.json` and starts the existing GitHub workflow. It uses the same manifest URL and requires no additional API service.

On first deployment, settings for the three new tabs initialize from the **previous TV top** and **Anime side** styles. Thereafter they are saved independently. This change does not modify the original row generation or sorting. The existing GitHub workflow restores Inter ExtraBold from earlier repository history; do not delete that history.
