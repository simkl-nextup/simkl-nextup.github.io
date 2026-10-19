# Smart Shuffle deployment verification fix (October 19, 2026)

## Issue

GitHub Actions succeeded at `npm run refresh:smart` and reported
`Smart Shuffle added 31 movies, 5 featured, 26 randomized.` It then failed
in `npm run verify` with `Fifth independent Smart Shuffle row missing or invalid.`

The verifier was accidentally left on the old pagination contract: it
required a manifest `extra` declaration for `skip` and expected the default
catalog to contain only the first page. The new generator deliberately
**removes** that manifest extra for Nuvio compatibility and publishes the
**entire** Plan to Watch list at the normal catalog URL.

## Correction

`verify-output.mjs` now checks the *actual current contract*:

- Exactly five Account 2 catalogs, with Smart Shuffle fifth, type `movie`,
  and **no `skip` declaration**.
- Base catalog contains all `status.smartShuffle.published` movies with
  unique valid IDs, HTTPS posters, and valid movie metadata files.
- Status counts are consistent (`featured + random = published`).
- Optional 50-item `skip=N.json` files match the corresponding slices of
  the base catalog, with an empty terminal page.

Other catalog generators, poster designs, watchlist filtering, Studio
settings and API integrations are unchanged. Added regression tests include
the exact 31-item case that failed on GitHub, a 107-item case, an empty
watchlist, a malformed page and an incompatible manifest declaration.

## Deployment

Replace repository files with the full replacement ZIP, keep your existing
Git history and GitHub Actions secrets, then run **Actions → Refresh Simkl
and global upcoming releases → Run workflow**. The existing Account 2
manifest URL remains unchanged. The font is intentionally not bundled; the
existing workflow restores it from repository history.
