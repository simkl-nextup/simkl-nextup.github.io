import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { APP_VERSION, CATALOG_ID } from "./constants.mjs";
import { buildManifest } from "./catalog.mjs";
import { decorateCatalogPosters } from "./poster-badges.mjs";

const TMDB_LOGO = "https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function indexHtml({ baseUrl, count, updatedAt, skippedCount, usesTmdb }) {
  const manifestUrl = baseUrl ? `${baseUrl.replace(/\/$/, "")}/manifest.json` : "./manifest.json";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>My Anime Up Next · Simkl</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#08090b;color:#f7f7f8}
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}
    main{width:min(680px,100%);background:#13151a;border:1px solid #292d36;border-radius:24px;padding:32px;box-shadow:0 24px 80px #0008}
    .eyebrow{color:#8ea1ff;font-weight:750;letter-spacing:.08em;text-transform:uppercase;font-size:.78rem}
    h1{font-size:clamp(2rem,6vw,3.5rem);line-height:1.02;margin:.6rem 0 1rem}
    p{color:#b9bec9;line-height:1.65}.stats{display:flex;gap:12px;flex-wrap:wrap;margin:24px 0}
    .pill{background:#1d2027;border:1px solid #303541;border-radius:999px;padding:8px 12px;color:#dfe3ec}
    a.button{display:inline-block;background:#f4f5f7;color:#090a0d;text-decoration:none;font-weight:800;padding:13px 18px;border-radius:12px}
    code{display:block;margin-top:16px;padding:14px;background:#090a0d;border-radius:10px;overflow-wrap:anywhere;color:#bfc8ff}
    footer{margin-top:28px;font-size:.9rem;color:#808694}footer a{color:#aebcff}.tmdb{display:flex;align-items:center;gap:12px;margin-top:16px}.tmdb img{width:72px;height:auto}.tmdb span{font-size:.78rem;line-height:1.35}
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">Personal Nuvio / Stremio catalog</div>
    <h1>My Anime Up Next</h1>
    <p>A focused mix of <strong>Watching</strong>, <strong>Plan to Watch</strong>, and previously completed anime that receive a new episode. Every new release bumps its show to the top.</p>
    <div class="stats">
      <span class="pill">${count} title${count === 1 ? "" : "s"} ready</span>
      <span class="pill">Updated ${escapeHtml(updatedAt)}</span>
      ${skippedCount ? `<span class="pill">${skippedCount} mapping warning${skippedCount === 1 ? "" : "s"}</span>` : ""}
    </div>
    <a class="button" href="${escapeHtml(manifestUrl)}">Open manifest</a>
    <code>${escapeHtml(manifestUrl)}</code>
    <footer>
      <div>Anime tracking and schedule data from <a href="https://simkl.com">Simkl</a>.</div>
      ${usesTmdb ? `<div class="tmdb"><a href="https://www.themoviedb.org"><img src="${TMDB_LOGO}" alt="TMDB"></a><span>This product uses the TMDB API but is not endorsed or certified by TMDB.</span></div>` : ""}
    </footer>
  </main>
</body>
</html>`;
}

function setupHtml() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize Simkl</title><style>
:root{color-scheme:dark;font-family:system-ui;background:#0b0c0f;color:#fff}body{max-width:680px;margin:48px auto;padding:0 20px}input,button{font:inherit;padding:12px;border-radius:10px;border:1px solid #3b4150}input{width:100%;box-sizing:border-box;background:#151820;color:#fff}button{margin-top:12px;background:#fff;color:#08090b;font-weight:800;cursor:pointer}.box{margin-top:20px;padding:18px;background:#151820;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere}.warn{color:#ffcb6b}</style></head>
<body><h1>Authorize this personal addon</h1><p>Enter the client ID from your Simkl developer app. Your browser will request a PIN directly from Simkl; nothing is sent to this GitHub Pages site.</p>
<label>Simkl client ID<input id="client" autocomplete="off"></label><button id="start">Request PIN</button><div id="out" class="box">Waiting.</div>
<p class="warn">Treat the final access token like a password. Save it only as the GitHub repository secret <strong>SIMKL_ACCESS_TOKEN</strong>.</p>
<script type="module">
const out=document.querySelector('#out');const button=document.querySelector('#start');
const params=(id)=>new URLSearchParams({client_id:id,'app-name':'simkl-new-episodes-addon','app-version':'${APP_VERSION}'});
const get=async url=>{const response=await fetch(url);const body=await response.json();if(!response.ok||body.error)throw new Error(body.message||body.error||('Simkl returned HTTP '+response.status));return body};
button.onclick=async()=>{button.disabled=true;try{const id=document.querySelector('#client').value.trim();if(!id)throw new Error('Enter a client ID.');
const pin=await get('https://api.simkl.com/oauth/pin?'+params(id));if(!pin.user_code||!pin.verification_uri)throw new Error('Simkl did not return a usable PIN.');
out.textContent='Open '+pin.verification_uri+' and enter PIN: '+pin.user_code+'\\n\\nWaiting for approval…';const deadline=Date.now()+pin.expires_in*1000;
while(Date.now()<deadline){await new Promise(r=>setTimeout(r,pin.interval*1000));const result=await get('https://api.simkl.com/oauth/pin/'+encodeURIComponent(pin.user_code)+'?'+params(id));
if(result.access_token){out.textContent='SIMKL_ACCESS_TOKEN\\n\\n'+result.access_token+'\\n\\nCopy it now and add it as a GitHub repository secret. Do not commit it.';return}if(result.result==='KO'&&!/pending/i.test(result.message||''))throw new Error(result.message||'Simkl declined the PIN authorization.');}
throw new Error('The PIN expired. Start again.')}catch(error){out.textContent='Error: '+error.message}finally{button.disabled=false}};
</script></body></html>`;
}

export function deriveBaseUrl({ explicitBaseUrl, githubRepository }) {
  if (explicitBaseUrl) return explicitBaseUrl.replace(/\/$/, "");
  if (!githubRepository?.includes("/")) return "";
  const [owner, repo] = githubRepository.split("/");
  const host = `https://${owner}.github.io`;
  return repo.toLowerCase() === `${owner.toLowerCase()}.github.io` ? host : `${host}/${repo}`;
}

export async function writeSite({
  outputDir,
  catalog,
  items,
  updatedAt,
  skipped = [],
  sourceCounts = { watching: 0, planToWatch: 0, completed: 0 },
  baseUrl = "",
  usesTmdb = false,
  posterBadges = [],
  posterBadgesEnabled = false,
  fetchImpl = fetch,
}) {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(path.join(outputDir, "catalog", "series"), { recursive: true });
  await mkdir(path.join(outputDir, "meta", "series"), { recursive: true });

  const posterResult = await decorateCatalogPosters(catalog, posterBadges, {
    outputDirectory: outputDir,
    baseUrl,
    enabled: posterBadgesEnabled,
    fetchImpl,
  });
  const publishedCatalog = posterResult.catalog;

  const manifest = buildManifest();
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path.join(outputDir, "manifest.json"), json(manifest));
  await writeFile(path.join(outputDir, "catalog", "series", `${CATALOG_ID}.json`), json(publishedCatalog));

  for (const meta of publishedCatalog.metas) {
    if (meta.id.startsWith("tt")) continue;
    await writeFile(path.join(outputDir, "meta", "series", `${meta.id}.json`), json({ meta }));
  }

  await writeFile(path.join(outputDir, "index.html"), indexHtml({
    baseUrl,
    count: publishedCatalog.metas.length,
    updatedAt,
    skippedCount: skipped.length,
    usesTmdb,
  }));
  await writeFile(path.join(outputDir, "setup.html"), setupHtml());
  await writeFile(path.join(outputDir, ".nojekyll"), "");
  await writeFile(path.join(outputDir, "status.json"), json({
    updatedAt,
    catalogItems: publishedCatalog.metas.length,
    publishedWatchingItems: sourceCounts.watching,
    publishedPlanToWatchItems: sourceCounts.planToWatch,
    publishedCompletedItems: sourceCounts.completed,
    trackedWatchingItems: Object.values(items ?? {}).filter((item) => item.status === "watching").length,
    trackedPlanToWatchItems: Object.values(items ?? {}).filter((item) => item.status === "plantowatch").length,
    trackedCompletedItems: Object.values(items ?? {}).filter((item) => item.status === "completed").length,
    tmdbArtworkEnabled: usesTmdb,
    posterBadgesEnabled,
    posterBadgesGenerated: posterResult.generated,
    posterBadgeWarnings: posterResult.warnings,
    skipped,
  }));

  return {
    catalog: publishedCatalog,
    posterBadgesGenerated: posterResult.generated,
    posterBadgeWarnings: posterResult.warnings,
  };
}
