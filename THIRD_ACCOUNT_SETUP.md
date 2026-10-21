# Set up account 3 (anime only)

Account 3 is a second **anime-only** slot. It runs exactly the same anime pipeline as the root account (Watching, Plan to Watch, revived Completed, dub tags, MAL scores, poster badges), but for a different Simkl account. It publishes under `/account-3` with its own addon ID, so it installs alongside the root and account-2 addons.

## URLs

- Addon: `https://simkl-nextup.github.io/account-3/manifest.json`
- Authorization page: `https://simkl-nextup.github.io/account-3/setup.html`
- Health report: `https://simkl-nextup.github.io/account-3/status.json`

| | Root | Account 2 | **Account 3** |
|---|---|---|---|
| Media | anime | TV + movies | **anime** |
| Addon ID | `community.simkl.new-anime-episodes` | `community.simkl.new-tv-episodes.account2` | `community.simkl.new-anime-episodes.account3` |
| Catalog ID | `simkl-new-anime-episodes` | `simkl-new-tv-episodes-account2` | `simkl-new-anime-episodes-account3` |
| Token secret | `SIMKL_ACCESS_TOKEN` | `SIMKL_ACCESS_TOKEN_2` | `SIMKL_ACCESS_TOKEN_3` |
| State cache | `simkl-state-` | `simkl-account-2-tv-state-` | `simkl-account-3-anime-state-` |

## 1. Commit this version and run the workflow once

`Actions → Refresh Simkl and global upcoming releases → Run workflow`

With no `SIMKL_ACCESS_TOKEN_3`, the root and account-2 addons refresh normally, and `/account-3` is published as an empty placeholder containing the authorization page.

## 2. Authorize the third Simkl account

1. Open a **private/incognito** window and sign in to the account-3 Simkl account only.
2. Open `https://simkl-nextup.github.io/account-3/setup.html`.
3. Enter a Simkl client ID. The one already saved as `SIMKL_CLIENT_ID` works.
4. Select **Request PIN**, open the Simkl link shown, and approve it **as account 3**.
5. Copy the access token the page shows.

## 3. Add the GitHub secret

`Settings → Secrets and variables → Actions → New repository secret`

| Name | Value | Required |
|---|---|---|
| `SIMKL_ACCESS_TOKEN_3` | Token from step 2 | Yes |
| `SIMKL_CLIENT_ID_3` | Only if you used a *different* Simkl app's client ID in step 2 | No |

The TMDB, MDBList, TVDB and AnimeSchedule secrets are shared automatically. Don't change any existing secrets.

## 4. Run the workflow again, then install

After the run, `https://simkl-nextup.github.io/account-3/status.json` should show `"account": "Simkl Account 3"` and `"mediaType": "anime"`. Then install `https://simkl-nextup.github.io/account-3/manifest.json` in Nuvio/Stremio for that profile.

## Failure protection

- No `SIMKL_ACCESS_TOKEN_3` → account 3 stays a placeholder; nothing else is affected.
- If account 3 is enabled but its refresh or verification fails, the workflow stops **before** deploying, so the current live site (all accounts) stays online.
- Account 3 has its own output folder, state file, cache prefix, addon ID and catalog ID, so it can't overwrite the root or account-2 rows.
- Poster styling for account 3 follows the **anime** row settings in `config/poster-style.json` / Poster Studio, same as the root addon.
