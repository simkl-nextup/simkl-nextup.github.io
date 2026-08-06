# Second Simkl account setup

This repository keeps the original account at the root and adds account 2 under `/account-2/`.

## 1. Replace the repository files

Upload the contents of this ZIP to the same GitHub repository and overwrite the old files. Keep the existing repository secrets unchanged.

## 2. Publish the setup pages

In GitHub:

1. Open **Actions**.
2. Open **Deploy setup page only**.
3. Select **Run workflow**.

After deployment, the second authorization page is:

```text
https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/account-2/setup.html
```

## 3. Authorize the second Simkl account

1. Open the account-2 setup page in a private/incognito browser window.
2. Make sure the browser is logged into the second Simkl account, not the original account.
3. Enter the same Simkl client ID already stored as `SIMKL_CLIENT_ID`.
4. Approve the PIN.
5. Copy the returned token.

## 4. Add the new secret

Open:

**Repository → Settings → Secrets and variables → Actions → New repository secret**

Create exactly:

```text
Name: SIMKL_ACCESS_TOKEN_2
Secret: the token returned for the second Simkl account
```

Do not rename or replace the existing `SIMKL_ACCESS_TOKEN` secret. That secret remains connected to account 1.

`SIMKL_CLIENT_ID_2` is optional. Leave it absent when both accounts use the same Simkl developer app.

## 5. Deploy both accounts

In **Actions**, run:

```text
Refresh Simkl catalogs and deploy Pages
```

The workflow will:

- refresh and verify account 1 at the root;
- refresh account 2 in a temporary isolated folder;
- verify account 2 before publishing it;
- preserve the last good account-2 output if account 2 temporarily fails;
- continue deploying account 1 even when account 2 has a bad or expired token.

## 6. Install the manifests

Account 1 remains unchanged:

```text
https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/manifest.json
```

Account 2:

```text
https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/account-2/manifest.json
```

Import the account-2 manifest into the second Nuvio/Xperience profile.

## Troubleshooting

### The workflow is green but account 2 is empty

`SIMKL_ACCESS_TOKEN_2` is missing. Add it and run the refresh workflow again.

### Account 2 shows the same list as account 1

The token was authorized while the browser was still logged into account 1. Generate a new token in an incognito window while logged into account 2, then replace `SIMKL_ACCESS_TOKEN_2`.

### Account 2 has a yellow warning in Actions

Open the **Refresh account 2 in an isolated build folder** step. Account 1 will still deploy. Replace the second token if the log reports a 401 authorization error.

### Account 1 fails

Account 1 is intentionally deployment-blocking because it is the existing live addon. Open the failed primary refresh or verification step and fix the original secret/API issue before rerunning.
