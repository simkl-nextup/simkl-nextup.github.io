const STATE_VERSION = 7;
const INCLUDED_STATUSES = new Set(["watching", "plantowatch", "completed"]);

function normalizedMediaType(value = "anime") {
  const mediaType = String(value || "anime").trim().toLowerCase();
  if (["tv", "show", "shows", "series"].includes(mediaType)) return "tv";
  return "anime";
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

function caughtUpSnapshot(item) {
  const watchedCount = Number(item?.watched_episodes_count);
  if (!Number.isFinite(watchedCount)) return null;
  const totalCount = Number(item?.total_episodes_count);
  return { watchedCount, totalCount: Number.isFinite(totalCount) ? totalCount : null };
}

// Simkl auto-moves a title out of Completed and back into Watching the
// moment a new season is confirmed on TVDB/AniDB, before the user has
// watched anything from it. That means `item.status` alone cannot tell a
// just-revived title apart from one the user is genuinely partway through.
// Carry forward the watched-episode count from the last time the item was
// truly completed, so later syncs can compare against it.
function withCaughtUpTracking(item, previousItem) {
  const next = { ...item };
  const carried = previousItem?._addonCaughtUpAt;
  if (carried) next._addonCaughtUpAt = carried;
  if (item.status === "completed") {
    const snapshot = caughtUpSnapshot(item);
    if (snapshot) next._addonCaughtUpAt = snapshot;
  }
  return next;
}

function isRevivedUnwatched(item) {
  const snapshot = item?._addonCaughtUpAt;
  if (!snapshot || item?.status !== "watching") return false;
  const watched = Number(item.watched_episodes_count);
  const total = Number(item.total_episodes_count);
  if (!Number.isFinite(watched) || !Number.isFinite(snapshot.watchedCount)) return false;
  // They've watched something beyond where they stood when last caught up:
  // this is genuinely "watching", not a silent revival.
  if (watched > snapshot.watchedCount) return false;
  // Nothing new was actually added since they were last caught up.
  if (Number.isFinite(total) && Number.isFinite(snapshot.totalCount) && total <= snapshot.totalCount) return false;
  return true;
}

// The status the catalog/poster badge should treat this item as, which can
// differ from Simkl's own `item.status` for a just-revived, not-yet-started
// title (see isRevivedUnwatched above).
export function effectiveStatus(item) {
  return isRevivedUnwatched(item) ? "completed" : item?.status;
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
    if (id !== null && INCLUDED_STATUSES.has(item.status)) {
      next.items[String(id)] = withCaughtUpTracking(item, null);
    }
  }
  return next;
}

export function mergeItemsDelta(state, payload, mediaType = "anime") {
  const next = normalizeState(structuredClone(state), mediaType);
  for (const item of payloadItems(payload, mediaType)) {
    const id = simklIdFor(item);
    if (id === null) continue;
    const key = String(id);
    if (INCLUDED_STATUSES.has(item.status)) next.items[key] = withCaughtUpTracking(item, next.items[key]);
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
