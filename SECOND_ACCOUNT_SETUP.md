# Set up the second Simkl account

This repository keeps the existing addon at the root and publishes the second account in an isolated subfolder.

## Final URLs

- Existing account: `https://simkl-nextup.github.io/manifest.json`
- Second account: `https://simkl-nextup.github.io/account-2/manifest.json`
- Second-account authorization page: `https://simkl-nextup.github.io/account-2/setup.html`
- Second-account health report: `https://simkl-nextup.github.io/account-2/status.json`

The two addons have different addon IDs and catalog IDs, so Nuvio/Stremio can keep both installed at the same time.

## 1. Upload this repository version

Replace the repository files with the contents of this ZIP and commit them to the default branch. Do not delete or rename any existing GitHub Secrets.

The current root addon keeps all of these unchanged:

- Manifest path: `/manifest.json`
- Addon ID: `community.simkl.new-anime-episodes`
- Catalog ID: `simkl-new-anime-episodes`
- State cache path and cache prefix

## 2. Run the workflow once before adding account 2

Open:

`GitHub repository → Actions → Refresh two Simkl catalogs and deploy Pages → Run workflow`

When `SIMKL_ACCESS_TOKEN_2` is absent, the workflow:

1. Refreshes and verifies the existing root account normally.
2. Publishes an empty account-2 placeholder and authorization page.
3. Deploys both folders together.

This makes the account-2 setup page available without requiring its token first.

## 3. Authorize the second Simkl account

1. Open a private/incognito browser window.
2. Sign in to the **second** Simkl account. Make sure the first account is not the active Simkl session.
3. Open `https://simkl-nextup.github.io/account-2/setup.html`.
4. Enter a Simkl client ID.
5. Select **Request PIN**.
6. Open the Simkl verification address shown on the page and approve the PIN using the second account.
7. Copy the resulting access token immediately.

### Which client ID should you enter?

You may use the same client ID already stored as `SIMKL_CLIENT_ID`. The workflow automatically falls back to it for account 2.

A separate Simkl developer application is also supported. In that case, create a second client ID and later save it as `SIMKL_CLIENT_ID_2`.

Never put either access token in a repository file, issue, commit, or screenshot.

## 4. Add the second GitHub Secret

Open:

`Repository → Settings → Secrets and variables → Actions → New repository secret`

Add:

| Name | Value | Required |
|---|---|---|
| `SIMKL_ACCESS_TOKEN_2` | Token obtained while signed into the second Simkl account | Yes |
| `SIMKL_CLIENT_ID_2` | A different client ID, only when using a separate Simkl developer app | No |

Do not change these existing secrets:

- `SIMKL_CLIENT_ID`
- `SIMKL_ACCESS_TOKEN`
- `TMDB_READ_ACCESS_TOKEN`
- `MDBLIST_API_KEY`
- `TVDB_API_KEY`
- `TVDB_SUBSCRIBER_PIN`

TMDB, MDBList, and TVDB credentials are shared safely by both generation runs. The two Simkl access tokens are never shared.

## 5. Generate and deploy both accounts

Run **Refresh two Simkl catalogs and deploy Pages** again.

The workflow now performs this sequence:

1. Restore the primary state from `state/simkl-state.json`.
2. Restore account 2 from `state/account-2/simkl-state.json`.
3. Run all tests.
4. Generate and verify the root addon.
5. Generate and verify account 2 under `public/account-2`.
6. Save separate private state caches.
7. Upload one combined Pages artifact.
8. Deploy only after both enabled accounts pass verification.

## 6. Confirm the deployment

Open these addresses:

- `https://simkl-nextup.github.io/status.json`
- `https://simkl-nextup.github.io/account-2/status.json`

The second report should show:

- `"account": "Simkl Account 2"`
- `"addonId": "community.simkl.new-anime-episodes.account2"`
- `"catalogId": "simkl-new-anime-episodes-account2"`
- A non-zero tracked or catalog count when that Simkl account has eligible anime

Then install or import:

`https://simkl-nextup.github.io/account-2/manifest.json`

The existing installation continues using:

`https://simkl-nextup.github.io/manifest.json`

## Failure protection

- With no `SIMKL_ACCESS_TOKEN_2`, account 2 remains an empty setup placeholder and the root addon continues normally.
- If account 2 is enabled but its token or generation fails, the workflow stops before the Pages deployment step. The already-live Pages deployment remains online.
- Account 2 cannot overwrite the root catalog because it has a separate output directory, catalog filename, addon ID, poster directory, state file, and cache prefix.
- The root addon's URL and identity remain unchanged.
