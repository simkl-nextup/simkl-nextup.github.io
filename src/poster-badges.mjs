import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const POSTER_WIDTH = 500;
const POSTER_HEIGHT = 750;
const POSTER_BADGE_STYLE_VERSION = 11;
const MAX_POSTER_BYTES = 12 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const ALLOWED_POSTER_HOSTS = new Set([
  "image.tmdb.org",
  "artworks.thetvdb.com",
  "simkl.in",
  "wsrv.nl",
]);

// Layout from the TV-readable branch, visual language from v1.8.2:
// centred status ribbon, bottom episode panel, and a protected logo/title zone.
const BADGE_LAYOUT = {
  margin: 14,
  statusY: 14,
  statusHeight: 68,
  statusRadius: 12,
  detailY: 654,
  detailWidth: 472,
  detailHeight: 82,
  detailRadius: 12,
  logoMaxWidth: 410,
  logoMaxHeight: 132,
  logoBottomGap: 20,
};

// Exact v1.8.2 status palettes.
const STATUS_STYLES = {
  watching: {
    label: "NEW EPISODE",
    start: "#12D98A",
    middle: "#0FAE73",
    end: "#087A56",
  },
  plantowatch: {
    label: "PLAN TO WATCH",
    start: "#FFC247",
    middle: "#ED970A",
    end: "#B85C00",
  },
  completed: {
    label: "NEW SEASON",
    start: "#9B8CFF",
    middle: "#765BFF",
    end: "#5136D5",
  },
};

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function compactEpisodeLabel(value) {
  const label = String(value ?? "").trim();
  const seasonEpisode = label.match(/^S0*(\d+)E0*(\d+)$/i)
    || label.match(/^S0*(\d+)\s*[·-]\s*E0*(\d+)$/i);
  if (seasonEpisode) return `S${seasonEpisode[1]} E${seasonEpisode[2]}`;
  const episode = label.match(/^(?:Ep\.?|EP)\s*(\d+)$/i);
  if (episode) return `EP ${episode[1]}`;
  return label.toUpperCase().slice(0, 16);
}

function statusPanelWidth(label) {
  const estimated = Math.ceil(label.length * 23 + 58);
  return Math.max(292, Math.min(406, estimated));
}

function statusFontSize(label) {
  return label.length > 12 ? 37 : 40;
}

function episodeFontSize(label, cellCount) {
  const cellWidth = BADGE_LAYOUT.detailWidth / cellCount;
  const maxSize = cellCount === 1 ? 43 : 39;
  const minSize = cellCount === 1 ? 32 : 29;
  const availableWidth = cellWidth - 26;
  const estimated = Math.floor(availableWidth / (Math.max(1, label.length) * 0.59));
  return Math.max(minSize, Math.min(maxSize, estimated));
}

function infoRows({ status, episode, latestEpisode, nextEpisode }) {
  const fallback = compactEpisodeLabel(episode);
  const latest = compactEpisodeLabel(latestEpisode || episode);
  const next = compactEpisodeLabel(nextEpisode || episode);

  if (status === "watching") {
    // When the latest release is also the user's next unwatched episode, a
    // duplicated NEW/NEXT number looks broken from TV distance. Use one clear
    // NEXT cell; split the panel only when the user is genuinely behind.
    if (latest && next && latest === next) {
      return [{
        cue: "NEXT",
        episode: next,
        gradient: "nextInfoGradient",
        accent: "#63C7FF",
      }];
    }
    return [
      {
        cue: "NEW",
        episode: latest || fallback,
        gradient: "newInfoGradient",
        accent: "#65FFD0",
      },
      {
        cue: "NEXT",
        episode: next || fallback,
        gradient: "nextInfoGradient",
        accent: "#63C7FF",
      },
    ];
  }

  if (status === "completed" && nextEpisode) {
    if (latest && next && latest === next) {
      return [{
        cue: "START",
        episode: next,
        gradient: "seasonInfoGradient",
        accent: "#C8BEFF",
      }];
    }
    return [
      {
        cue: "NEW",
        episode: latest || fallback,
        gradient: "seasonInfoGradient",
        accent: "#C8BEFF",
      },
      {
        cue: "START",
        episode: next || fallback,
        gradient: "startInfoGradient",
        accent: "#8FCBFF",
      },
    ];
  }

  return [{
    cue: status === "plantowatch" ? "LATEST" : "NEW",
    episode: latest || fallback,
    gradient: status === "completed" ? "seasonInfoGradient" : "episodeGradient",
    accent: status === "plantowatch" ? "#FFD66B" : "#B6A8FF",
  }];
}

function detailPanelSvg(rows) {
  const {
    margin,
    detailY,
    detailWidth,
    detailHeight,
    detailRadius,
  } = BADGE_LAYOUT;
  const cellWidth = detailWidth / rows.length;
  const cueY = detailY + 27;
  const episodeY = detailY + 65;

  const cellClips = rows.map((_, index) => {
    const x = margin + cellWidth * index;
    const leftRadius = index === 0 ? detailRadius : 0;
    const rightRadius = index === rows.length - 1 ? detailRadius : 0;
    // Each cell is clipped by the full rounded outer panel; this keeps the
    // two v1.8.2 gradients clean while preserving rounded outer corners.
    return `<clipPath id="detailCellClip${index}"><rect x="${x}" y="${detailY}" width="${cellWidth}" height="${detailHeight}" rx="${Math.max(leftRadius, rightRadius)}"/></clipPath>`;
  }).join("");

  const cells = rows.map((row, index) => {
    const x = margin + cellWidth * index;
    const centerX = x + cellWidth / 2;
    const fontSize = episodeFontSize(row.episode, rows.length);
    return `
      <rect x="${x}" y="${detailY}" width="${cellWidth}" height="${detailHeight}" fill="url(#${row.gradient})" clip-path="url(#detailClip)"/>
      <rect x="${x}" y="${detailY}" width="${cellWidth}" height="5" fill="${row.accent}" clip-path="url(#detailClip)"/>
      <rect x="${x + 1}" y="${detailY + 2}" width="${Math.max(0, cellWidth - 2)}" height="3" fill="#FFFFFF" fill-opacity="0.28" clip-path="url(#detailClip)"/>
      <text x="${centerX}" y="${cueY}" class="infoCue" text-anchor="middle" fill="${row.accent}">${escapeXml(row.cue)}</text>
      <text x="${centerX}" y="${episodeY}" class="infoEpisode" text-anchor="middle" font-size="${fontSize}px">${escapeXml(row.episode)}</text>`;
  }).join("");

  const dividers = rows.slice(1).map((_, index) => {
    const x = margin + cellWidth * (index + 1);
    return `<path d="M${x} ${detailY + 12} V${detailY + detailHeight - 10}" stroke="#FFFFFF" stroke-opacity="0.46" stroke-width="2"/>`;
  }).join("");

  return `
    ${cellClips}
    <rect id="bottomEpisodePanel" x="${margin}" y="${detailY}" width="${detailWidth}" height="${detailHeight}" rx="${detailRadius}" fill="#030407" fill-opacity="0.98" stroke="#FFFFFF" stroke-opacity="0.46" stroke-width="2"/>
    ${cells}
    <path d="M${margin + 2} ${detailY + 2} H${margin + detailWidth - 2}" stroke="#FFFFFF" stroke-opacity="0.54" stroke-width="2" clip-path="url(#detailClip)"/>
    <path d="M${margin + 2} ${detailY + detailHeight - 2} H${margin + detailWidth - 2}" stroke="#000000" stroke-opacity="0.58" stroke-width="3" clip-path="url(#detailClip)"/>
    ${dividers}`;
}

export function buildPosterBadgeSvg({ status, episode, latestEpisode, nextEpisode }) {
  const style = STATUS_STYLES[status];
  if (!style) throw new Error(`Unsupported poster badge status: ${status}`);
  const rows = infoRows({ status, episode, latestEpisode, nextEpisode });
  if (!rows.every((row) => row.episode)) throw new Error("Poster badge episode label is required.");

  const statusWidth = statusPanelWidth(style.label);
  const statusX = (POSTER_WIDTH - statusWidth) / 2;
  const statusTextY = BADGE_LAYOUT.statusY + 46;

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}" viewBox="0 0 ${POSTER_WIDTH} ${POSTER_HEIGHT}">
  <defs>
    <linearGradient id="statusGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${style.start}"/>
      <stop offset="52%" stop-color="${style.middle}"/>
      <stop offset="100%" stop-color="${style.end}"/>
    </linearGradient>
    <linearGradient id="newInfoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#11694F"/>
      <stop offset="56%" stop-color="#083F34"/>
      <stop offset="100%" stop-color="#021A17"/>
    </linearGradient>
    <linearGradient id="nextInfoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#183C5F"/>
      <stop offset="56%" stop-color="#10243A"/>
      <stop offset="100%" stop-color="#050A12"/>
    </linearGradient>
    <linearGradient id="episodeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#303641"/>
      <stop offset="52%" stop-color="#151922"/>
      <stop offset="100%" stop-color="#030407"/>
    </linearGradient>
    <linearGradient id="seasonInfoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#44358B"/>
      <stop offset="54%" stop-color="#251B55"/>
      <stop offset="100%" stop-color="#090613"/>
    </linearGradient>
    <linearGradient id="startInfoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#254D78"/>
      <stop offset="54%" stop-color="#162D4A"/>
      <stop offset="100%" stop-color="#060A12"/>
    </linearGradient>
    <linearGradient id="glossGradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0"/>
      <stop offset="50%" stop-color="#FFFFFF" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="statusClip">
      <rect x="${statusX}" y="${BADGE_LAYOUT.statusY}" width="${statusWidth}" height="${BADGE_LAYOUT.statusHeight}" rx="${BADGE_LAYOUT.statusRadius}"/>
    </clipPath>
    <clipPath id="detailClip">
      <rect x="${BADGE_LAYOUT.margin}" y="${BADGE_LAYOUT.detailY}" width="${BADGE_LAYOUT.detailWidth}" height="${BADGE_LAYOUT.detailHeight}" rx="${BADGE_LAYOUT.detailRadius}"/>
    </clipPath>
    <filter id="panelShadow" x="-30%" y="-35%" width="175%" height="200%">
      <feDropShadow dx="0" dy="7" stdDeviation="7" flood-color="#000000" flood-opacity="0.78"/>
    </filter>
    <filter id="textShadow" x="-30%" y="-40%" width="170%" height="200%">
      <feDropShadow dx="0" dy="2" stdDeviation="1.8" flood-color="#000000" flood-opacity="1"/>
    </filter>
    <style>
      .statusText,.infoCue,.infoEpisode{font-family:Arial,Helvetica,sans-serif;font-weight:900;fill:#FFFFFF;stroke:#000000;stroke-opacity:.96;paint-order:stroke fill;filter:url(#textShadow)}
      .statusText{font-size:${statusFontSize(style.label)}px;stroke-width:3.4px;letter-spacing:.1px}
      .infoCue{font-size:${rows.length === 1 ? 22 : 21}px;stroke-width:2.5px;letter-spacing:.7px}
      .infoEpisode{stroke-width:2.8px;letter-spacing:.2px}
    </style>
  </defs>
  <g filter="url(#panelShadow)">
    <rect id="topStatusPanel" x="${statusX}" y="${BADGE_LAYOUT.statusY}" width="${statusWidth}" height="${BADGE_LAYOUT.statusHeight}" rx="${BADGE_LAYOUT.statusRadius}" fill="url(#statusGradient)" stroke="#FFFFFF" stroke-opacity="0.42" stroke-width="2"/>
    <path d="M${statusX + Math.round(statusWidth * 0.12)} ${BADGE_LAYOUT.statusY - 16} L${statusX + Math.round(statusWidth * 0.48)} ${BADGE_LAYOUT.statusY - 16} L${statusX + Math.round(statusWidth * 0.29)} ${BADGE_LAYOUT.statusY + BADGE_LAYOUT.statusHeight + 16} L${statusX - Math.round(statusWidth * 0.07)} ${BADGE_LAYOUT.statusY + BADGE_LAYOUT.statusHeight + 16} Z" fill="url(#glossGradient)" opacity="0.58" clip-path="url(#statusClip)"/>
    <path d="M${statusX + 2} ${BADGE_LAYOUT.statusY + 2} H${statusX + statusWidth - 2}" fill="none" stroke="#FFFFFF" stroke-opacity="0.72" stroke-width="3" clip-path="url(#statusClip)"/>
    <path d="M${statusX + 2} ${BADGE_LAYOUT.statusY + BADGE_LAYOUT.statusHeight - 2} H${statusX + statusWidth - 2}" fill="none" stroke="#000000" stroke-opacity="0.46" stroke-width="3" clip-path="url(#statusClip)"/>
    <text x="${POSTER_WIDTH / 2}" y="${statusTextY}" class="statusText" text-anchor="middle">${escapeXml(style.label)}</text>
    ${detailPanelSvg(rows)}
  </g>
</svg>`);
}

function buildLowerVignetteSvg() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}" viewBox="0 0 ${POSTER_WIDTH} ${POSTER_HEIGHT}">
    <defs>
      <linearGradient id="lowerVignette" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="46%" stop-color="#000000" stop-opacity="0.08"/>
        <stop offset="76%" stop-color="#000000" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.76"/>
      </linearGradient>
    </defs>
    <rect x="0" y="420" width="${POSTER_WIDTH}" height="330" fill="url(#lowerVignette)"/>
  </svg>`);
}

function splitTitle(value) {
  const words = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return ["Untitled"];
  if (words.join(" ").length <= 22) return [words.join(" ")];

  const lines = ["", ""];
  for (const word of words) {
    const target = lines[0].length <= lines[1].length ? 0 : 1;
    lines[target] = `${lines[target]} ${word}`.trim();
  }
  return lines.filter(Boolean).slice(0, 2);
}

function buildFallbackTitleSvg(name) {
  const lines = splitTitle(name);
  const longest = Math.max(...lines.map((line) => line.length));
  const fontSize = Math.max(30, Math.min(lines.length === 1 ? 50 : 42, Math.floor(620 / Math.max(1, longest))));
  const lineHeight = Math.round(fontSize * 1.02);
  const bottom = BADGE_LAYOUT.detailY - BADGE_LAYOUT.logoBottomGap;
  const firstY = bottom - (lines.length - 1) * lineHeight;
  const tspans = lines.map((line, index) => `<tspan x="250" y="${firstY + index * lineHeight}">${escapeXml(line.toUpperCase())}</tspan>`).join("");
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}" viewBox="0 0 ${POSTER_WIDTH} ${POSTER_HEIGHT}">
    <defs>
      <filter id="titleShadow" x="-30%" y="-40%" width="170%" height="200%">
        <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000000" flood-opacity="1"/>
      </filter>
      <style>.fallbackTitle{font-family:Arial Black,Arial,Helvetica,sans-serif;font-size:${fontSize}px;font-weight:900;fill:#FFFFFF;stroke:#000000;stroke-width:4px;paint-order:stroke fill;filter:url(#titleShadow);letter-spacing:.2px}</style>
    </defs>
    <text class="fallbackTitle" text-anchor="middle">${tspans}</text>
  </svg>`);
}

function validatePosterUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Poster URL must use HTTPS.");
  const hostname = url.hostname.toLowerCase();
  const allowed = ALLOWED_POSTER_HOSTS.has(hostname) || hostname.endsWith(".simkl.in");
  if (!allowed) throw new Error(`Poster host is not allowed: ${hostname}`);
  return url;
}

async function downloadImage(url, fetchImpl) {
  validatePosterUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/svg+xml,*/*" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Image download returned HTTP ${response.status}.`);
    if (response.url) validatePosterUrl(response.url);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.toLowerCase().startsWith("image/")) {
      throw new Error(`Image download returned ${contentType} instead of an image.`);
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_POSTER_BYTES) throw new Error("Image download is larger than 12 MB.");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error("Image download was empty.");
    if (buffer.length > MAX_POSTER_BYTES) throw new Error("Image download is larger than 12 MB.");
    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

async function prepareTitleLogo(buffer) {
  const logo = sharp(buffer, { failOn: "error" })
    .ensureAlpha()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({
      width: BADGE_LAYOUT.logoMaxWidth,
      height: BADGE_LAYOUT.logoMaxHeight,
      fit: "inside",
      withoutEnlargement: false,
    });
  const output = await logo.png().toBuffer({ resolveWithObject: true });
  return {
    input: output.data,
    left: Math.round((POSTER_WIDTH - output.info.width) / 2),
    top: Math.max(452, Math.round(BADGE_LAYOUT.detailY - BADGE_LAYOUT.logoBottomGap - output.info.height)),
  };
}

function posterFileName(meta, badge) {
  const signature = JSON.stringify({
    version: POSTER_BADGE_STYLE_VERSION,
    id: meta.id,
    poster: meta.poster,
    name: badge.name || meta.name,
    logo: badge.logo || null,
    status: badge.status,
    episode: compactEpisodeLabel(badge.episode),
    latestEpisode: compactEpisodeLabel(badge.latestEpisode),
    nextEpisode: compactEpisodeLabel(badge.nextEpisode),
  });
  return `${createHash("sha256").update(signature).digest("hex").slice(0, 24)}.webp`;
}

export async function decorateCatalogPosters(catalog, badges, {
  outputDirectory,
  baseUrl,
  enabled = true,
  fetchImpl = fetch,
  concurrency = 4,
} = {}) {
  const next = structuredClone(catalog ?? { metas: [] });
  const warnings = [];
  if (!enabled || !baseUrl || !next.metas.length) {
    return { catalog: next, generated: 0, warnings };
  }

  const badgeById = new Map((badges ?? []).map((badge) => [badge.id, badge]));
  const posterDirectory = path.join(outputDirectory, "posters");
  await mkdir(posterDirectory, { recursive: true });
  let cursor = 0;
  let generated = 0;

  async function worker() {
    while (cursor < next.metas.length) {
      const index = cursor;
      cursor += 1;
      const meta = next.metas[index];
      const badge = badgeById.get(meta.id);
      if (!badge || !meta.poster) continue;

      try {
        const originalPoster = await downloadImage(meta.poster, fetchImpl);
        let titleComposite = { input: buildFallbackTitleSvg(badge.name || meta.name) };
        if (badge.logo) {
          try {
            const logo = await downloadImage(badge.logo, fetchImpl);
            titleComposite = await prepareTitleLogo(logo);
          } catch {
            // A missing logo must not block poster generation. The show name is
            // rendered as high-contrast text in the same reserved logo area.
          }
        }

        const filename = posterFileName(meta, badge);
        await sharp(originalPoster, { failOn: "error" })
          .resize(POSTER_WIDTH, POSTER_HEIGHT, { fit: "cover", position: "centre" })
          .composite([
            { input: buildLowerVignetteSvg(), gravity: "northwest" },
            titleComposite,
            { input: buildPosterBadgeSvg(badge), gravity: "northwest" },
          ])
          .webp({ quality: 90, effort: 5 })
          .toFile(path.join(posterDirectory, filename));
        meta.poster = `${baseUrl.replace(/\/$/, "")}/posters/${filename}`;
        generated += 1;
      } catch (error) {
        warnings.push({
          id: meta.id,
          name: meta.name,
          message: error.name === "AbortError" ? "Poster download timed out." : error.message,
        });
      }
    }
  }

  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, next.metas.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { catalog: next, generated, warnings };
}
