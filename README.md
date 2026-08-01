# Simkl New Anime Episodes

A personal, single-row Stremio/Nuvio addon. It shows only anime on your Simkl **Watching** list whose next unwatched episode has already aired.

When Xperience records an episode in Simkl, the next refresh removes the caught-up show or advances it to its next aired episode. When a future episode reaches its air time, the show automatically enters the row.

## What the row includes

- Simkl status is `watching`.
- `next_to_watch_info.date` is at or before the current time.
- One card per anime, displaying the next unwatched episode number.
- Most recently aired episodes first.

It does **not** include recommendations, Plan to Watch titles, completed anime, movies, or future-only episodes.

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

Optional repository variable:

| Variable | Value |
|---|---|
| `PUBLIC_BASE_URL` | Only needed for a custom domain; for example `https://anime.example.com` |

### 6. Run the personalized deployment

1. Open **Actions → Refresh Simkl catalog and deploy Pages**.
2. Select **Run workflow**.

The workflow runs tests, refreshes Simkl, verifies that no token reached the public files, and deploys the addon. It then refreshes at minute 7 and 37 of every hour.

The same workflow also updates a harmless `.github/keepalive` marker once per month. That automated commit keeps the public repository active, preventing GitHub's 60-day inactivity rule from disabling the scheduled refresh. You do not need to remember to touch or re-enable it manually.

### 7. Install or import the addon

Your manifest URL will normally be:

```text
https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/manifest.json
```

Recommended for Nuvio:

1. In Xperience, choose **Import from another add-on**.
2. Paste the manifest URL.
3. Keep the single `New Episodes From Your Anime · Simkl` row.
4. Push the profile to Nuvio.
5. Put the row where your broken Trakt `Your Recently Aired` row used to be.

Importing through Xperience gives it the best chance to normalize IMDb, TMDB, TVDB and anime IDs. Direct manifest installation also works best for titles carrying IMDb IDs.

## Refresh behavior

- The first run pulls only your full Anime/Watching list.
- Later runs call `/sync/activities` first.
- `/sync/all-items` is called only when Simkl reports changed anime activity.
- Delta changes are merged into a private GitHub Actions cache.
- The public Simkl v2 anime calendar corrects rescheduled air times.
- If a token is revoked, deployment fails and the existing Pages version remains online.

GitHub schedules are best-effort and can occasionally run late. Use **Run workflow** for an immediate manual refresh.

GitHub automatically disables scheduled workflows in a public repository after 60 days without repository activity. This project avoids that condition through its monthly keepalive commit. Keep the default branch unprotected so `github-actions[bot]` can write that marker. If you later add branch protection that blocks automated pushes, explicitly allow GitHub Actions to push or the keepalive will fail. A private repository is not subject to the public-repository inactivity rule, although private Actions usage counts against your plan's included minutes.

## Local development

```bash
npm test
npm run build:placeholder
npm run keepalive
SIMKL_CLIENT_ID=... SIMKL_ACCESS_TOKEN=... npm run refresh
npm run verify
```

Node.js 20+ is required. There are no third-party runtime packages.

## Privacy

- The token is read only from GitHub Secrets and is scanned against generated output before deployment.
- Sync state is stored in the GitHub Actions cache, not committed to the repository or published by Pages.
- The final catalog itself is public to anyone who knows the Pages URL. This is required so Nuvio/Stremio can request it without authentication.

## Simkl attribution and API use

Tracking and schedule data is provided by [Simkl](https://simkl.com). This project uses Simkl's documented two-phase sync model and v2 calendar CDN. It is intended for personal, non-commercial use.
