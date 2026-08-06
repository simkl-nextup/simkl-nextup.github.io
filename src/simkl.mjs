import {
  APP_NAME,
  APP_VERSION,
  SIMKL_API_BASE,
  SIMKL_CALENDAR_BASE,
} from "./constants.mjs";

const MEDIA_CONFIG = {
  anime: {
    syncType: "anime",
    detailPath: "anime",
    activityKey: "anime",
    payloadKey: "anime",
    calendarNames: ["anime"],
  },
  tv: {
    syncType: "shows",
    detailPath: "tv",
    activityKey: "tv_shows",
    payloadKey: "shows",
    // Simkl has used more than one public CDN name for TV calendars. Try the
    // canonical show name first and retain safe fallbacks for older mirrors.
    calendarNames: ["tv-shows", "shows", "tv"],
  },
};

export function normalizeMediaType(value = "anime") {
  const mediaType = String(value || "anime").trim().toLowerCase();
  if (mediaType === "shows" || mediaType === "show" || mediaType === "series") return "tv";
  if (mediaType !== "anime" && mediaType !== "tv") {
    throw new Error(`Unsupported MEDIA_TYPE: ${value}. Use anime or tv.`);
  }
  return mediaType;
}

export function mediaConfigFor(value = "anime") {
  return MEDIA_CONFIG[normalizeMediaType(value)];
}

export class SimklApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "SimklApiError";
    this.status = status;
    this.body = body;
  }
}

function apiUrl(path, clientId, params = {}) {
  const url = new URL(path, SIMKL_API_BASE);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("app-name", APP_NAME);
  url.searchParams.set("app-version", APP_VERSION);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function calendarUrl(clientId, name, year, month) {
  const pathname = year && month
    ? `${SIMKL_CALENDAR_BASE}/${year}/${Number(month)}/${name}.json`
    : `${SIMKL_CALENDAR_BASE}/v2/${name}.json`;
  const url = new URL(pathname);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("app-name", APP_NAME);
  url.searchParams.set("app-version", APP_VERSION);
  return url;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new SimklApiError(
      `Simkl returned non-JSON data (${response.status}).`,
      response.status,
      text.slice(0, 500),
    );
  }
}

async function getJson(fetchImpl, url, accessToken) {
  const headers = {
    Accept: "application/json",
    "User-Agent": `${APP_NAME}/${APP_VERSION}`,
    "simkl-api-key": url.searchParams.get("client_id") || "",
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetchImpl(url, { headers });
  const body = await readJson(response);
  if (!response.ok) {
    const reason = body?.error_description || body?.message || body?.error || response.statusText;
    throw new SimklApiError(`Simkl request failed: ${reason}`, response.status, body);
  }
  return body;
}

async function getFirstAvailableJson(fetchImpl, urls, accessToken) {
  let lastError;
  for (const url of urls) {
    try {
      return await getJson(fetchImpl, url, accessToken);
    } catch (error) {
      lastError = error;
      if (!(error instanceof SimklApiError) || error.status !== 404) throw error;
    }
  }
  throw lastError ?? new Error("No Simkl calendar endpoint was available.");
}

export function createSimklClient({ clientId, accessToken, mediaType = "anime", fetchImpl = fetch }) {
  if (!clientId) throw new Error("SIMKL_CLIENT_ID is required.");
  if (!accessToken) throw new Error("SIMKL_ACCESS_TOKEN is required.");
  const normalizedMediaType = normalizeMediaType(mediaType);
  const config = MEDIA_CONFIG[normalizedMediaType];

  const getInitialLibrary = () => getJson(
    fetchImpl,
    apiUrl(`/sync/all-items/${config.syncType}`, clientId, {
      next_watch_info: "yes",
      language: "en",
    }),
    accessToken,
  );

  const getDelta = (dateFrom) => {
    if (!dateFrom) throw new Error("A saved date_from value is required for a delta sync.");
    return getJson(
      fetchImpl,
      apiUrl(`/sync/all-items/${config.syncType}`, clientId, {
        date_from: dateFrom,
        next_watch_info: "yes",
        language: "en",
      }),
      accessToken,
    );
  };

  const getIdSnapshot = () => getJson(
    fetchImpl,
    apiUrl(`/sync/all-items/${config.syncType}`, clientId, {
      extended: "simkl_ids_only",
    }),
    accessToken,
  );

  const getDetails = (simklId) => getJson(
    fetchImpl,
    apiUrl(`/${config.detailPath}/${simklId}`, clientId),
    null,
  );

  const getCalendar = () => getFirstAvailableJson(
    fetchImpl,
    config.calendarNames.map((name) => calendarUrl(clientId, name)),
    null,
  );

  const getCalendarMonth = (year, month) => getFirstAvailableJson(
    fetchImpl,
    config.calendarNames.map((name) => calendarUrl(clientId, name, year, month)),
    null,
  );

  return {
    mediaType: normalizedMediaType,
    activityKey: config.activityKey,
    payloadKey: config.payloadKey,

    getActivities() {
      return getJson(fetchImpl, apiUrl("/sync/activities", clientId), accessToken);
    },

    getInitialLibrary,
    getDelta,
    getIdSnapshot,
    getDetails,
    getCalendar,
    getCalendarMonth,

    // Compatibility aliases keep the original root anime implementation and
    // its existing tests/API surface intact.
    getInitialAnimeLibrary: getInitialLibrary,
    getAnimeDelta: getDelta,
    getAnimeIdSnapshot: getIdSnapshot,
    getAnimeDetails: getDetails,
    getAnimeCalendar: getCalendar,
    getAnimeCalendarMonth: getCalendarMonth,
  };
}
