# Repair: missing poster font on GitHub Actions

The previous replacement archive excluded `assets/fonts/Inter-ExtraBold.otf`.
That omission caused the test suite to fail with ENOENT when `src/site.mjs`
tried to copy the font into the generated Pages site.

The workflow now restores that *existing repository asset* from commit
`de46231` if the current checkout lacks it, before `npm test` or `npm run refresh`.
Full repository history is checked out to make that historical object available.
The fallback is limited to the original `simkl-nextup` repository history.

No private tokens, fonts, or generated runtime state are included in this ZIP.
All 108 tests pass when the original font is restored locally.

For long-term self-contained repository maintenance, restore the font to
`assets/fonts/Inter-ExtraBold.otf` in `main` in a separate commit.
