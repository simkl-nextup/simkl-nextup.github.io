import {
  APP_NAME,
  APP_VERSION,
  SIMKL_API_BASE,
  SIMKL_CALENDAR_URL,
} from "./constants.mjs";

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

function calendarUrl(clientId) {
  const url = new URL(SIMKL_CALENDAR_URL);
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

export function createSimklClient({ clientId, accessToken, fetchImpl = fetch }) {
  if (!clientId) throw new Error("SIMKL_CLIENT_ID is required.");
  if (!accessToken) throw new Error("SIMKL_ACCESS_TOKEN is required.");

  return {
    getActivities() {
      return getJson(fetchImpl, apiUrl("/sync/activities", clientId), accessToken);
    },

    getInitialWatchingAnime() {
      return getJson(
        fetchImpl,
        apiUrl("/sync/all-items/anime/watching", clientId, {
          next_watch_info: "yes",
          language: "en",
        }),
        accessToken,
      );
    },

    getAnimeDelta(dateFrom) {
      if (!dateFrom) throw new Error("A saved date_from value is required for a delta sync.");
      return getJson(
        fetchImpl,
        apiUrl("/sync/all-items/anime", clientId, {
          date_from: dateFrom,
          next_watch_info: "yes",
          language: "en",
        }),
        accessToken,
      );
    },

    getAnimeIdSnapshot() {
      return getJson(
        fetchImpl,
        apiUrl("/sync/all-items/anime", clientId, {
          extended: "simkl_ids_only",
        }),
        accessToken,
      );
    },

    getAnimeDetails(simklId) {
      return getJson(fetchImpl, apiUrl(`/anime/${simklId}`, clientId), null);
    },

    getAnimeCalendar() {
      return getJson(fetchImpl, calendarUrl(clientId), null);
    },
  };
}

