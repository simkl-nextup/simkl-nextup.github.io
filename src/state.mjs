const STATE_VERSION = 7;
const INCLUDED_STATUSES = new Set(["watching", "plantowatch", "completed"]);

function normalizedMediaType(value = "anime") {
  const mediaType = String(value || "anime").trim().toLowerCase();
  if (["tv", "show", "shows", "series"].includes(mediaType)) return "tv";
  return "anime";
}


function preservedAddonFields(item) {
  if (!item || typeof item !== "object") return {};
  return Object.fromEntries(
    Object.entries(item).filter(([key]) => key.startsWith("_addon")),
  );
}

function mergeFreshTrackedItem(existing, fresh) {
  if (!existing) return fresh;
  const next = { ...fresh, ...preservedAddonFields(existing) };
  const mediaKey = fresh?.show ? "show" : fresh?.anime ? "anime" : null;
  if (mediaKey) {
    const oldMedia = existing?.[mediaKey] ?? {};
    const newMedia = fresh?.[mediaKey] ?? {};
    next[mediaKey] = {
      ...oldMedia,
      ...newMedia,
      ids: { ...(oldMedia.ids ?? {}), ...(newMedia.ids ?? {}) },
    };
  }
  return next;
}

function payloadItems(payload, mediaType = "anime") {
  const type = normalizedMediaType(mediaType);
  if (type === "tv") return payload?.shows ?? payload?.tv ?? [];
  return payload?.anime ?? [];
}

export function createEmptyState(mediaType = "anime") {
  const type = normalizedMediaType(mediaType);
  return {
    version: STATE_VERSION,
    mediaType: type,
    lastActivity: null,
    // Retained for compatibility with existing root-account cache files.
    lastAnimeActivity: null,
    lastRemovedFromList: null,
    lastSuccessfulRefresh: null,
    items: {},
  };
}

export function mediaFor(item) {
  return item?.anime || item?.show || null;
}

export function simklIdFor(item) {
  const media = mediaFor(item);
  return media?.ids?.simkl ?? media?.ids?.simkl_id ?? null;
}

export function normalizeState(input, mediaType = "anime") {
  const targetType = normalizedMediaType(mediaType);
  const base = createEmptyState(targetType);
  if (!input || typeof input !== "object") return base;
  // Version 7 forces one clean rebuild so cached TVDB records created before
  // English translations and cross-record season grouping cannot survive.
  if (input.version !== STATE_VERSION) return base;

  // Old v1.8.7 state files did not store a media type and were anime-only.
  // Treat them as anime so the existing root cache remains valid, while a TV
  // account cleanly discards the old empty anime cache on its first run.
  const storedType = normalizedMediaType(input.mediaType ?? "anime");
  if (storedType !== targetType) return base;

  const lastActivity = input.lastActivity ?? input.lastAnimeActivity ?? null;
  return {
    ...base,
    ...input,
    mediaType: targetType,
    lastActivity,
    lastAnimeActivity: targetType === "anime" ? lastActivity : null,
    items: input.items && typeof input.items === "object" ? input.items : {},
  };
}

export function replaceWithInitialEligibleItems(state, payload, mediaType = "anime") {
  const next = { ...normalizeState(state, mediaType), items: {} };
  for (const item of payloadItems(payload, mediaType)) {
    const id = simklIdFor(item);
    if (id !== null && INCLUDED_STATUSES.has(item.status)) next.items[String(id)] = item;
  }
  return next;
}

export function replaceWithCurrentEligibleItems(state, payload, mediaType = "anime") {
  const previous = normalizeState(structuredClone(state), mediaType);
  const next = { ...previous, items: {} };
  for (const item of payloadItems(payload, mediaType)) {
    const id = simklIdFor(item);
    if (id === null || !INCLUDED_STATUSES.has(item.status)) continue;
    const key = String(id);
    next.items[key] = mergeFreshTrackedItem(previous.items[key], item);
  }
  return next;
}

export function mergeItemsDelta(state, payload, mediaType = "anime") {
  const next = normalizeState(structuredClone(state), mediaType);
  for (const item of payloadItems(payload, mediaType)) {
    const id = simklIdFor(item);
    if (id === null) continue;
    const key = String(id);
    if (INCLUDED_STATUSES.has(item.status)) next.items[key] = item;
    else delete next.items[key];
  }
  return next;
}

export function pruneRemovedItems(state, snapshotPayload, mediaType = "anime") {
  const next = normalizeState(structuredClone(state), mediaType);
  const currentIds = new Set(
    payloadItems(snapshotPayload, mediaType)
      .map(simklIdFor)
      .filter((id) => id !== null)
      .map(String),
  );
  for (const id of Object.keys(next.items)) {
    if (!currentIds.has(id)) delete next.items[id];
  }
  return next;
}

// Original anime-specific names remain available for the root account and for
// downstream code that imported v1.8.7 directly.
export function replaceWithInitialEligibleAnime(state, payload) {
  return replaceWithInitialEligibleItems(state, payload, "anime");
}

export function mergeAnimeDelta(state, payload) {
  return mergeItemsDelta(state, payload, "anime");
}
