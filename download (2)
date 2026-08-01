export function createEmptyState() {
  return {
    version: 1,
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

export function normalizeState(input) {
  const base = createEmptyState();
  if (!input || typeof input !== "object") return base;
  return {
    ...base,
    ...input,
    items: input.items && typeof input.items === "object" ? input.items : {},
  };
}

export function replaceWithInitialWatching(state, payload) {
  const next = { ...normalizeState(state), items: {} };
  for (const item of payload?.anime ?? []) {
    const id = simklIdFor(item);
    if (id !== null && item.status === "watching") next.items[String(id)] = item;
  }
  return next;
}

export function mergeAnimeDelta(state, payload) {
  const next = normalizeState(structuredClone(state));
  for (const item of payload?.anime ?? []) {
    const id = simklIdFor(item);
    if (id === null) continue;
    const key = String(id);
    if (item.status === "watching") next.items[key] = item;
    else delete next.items[key];
  }
  return next;
}

export function pruneRemovedItems(state, snapshotPayload) {
  const next = normalizeState(structuredClone(state));
  const currentIds = new Set(
    (snapshotPayload?.anime ?? [])
      .map(simklIdFor)
      .filter((id) => id !== null)
      .map(String),
  );
  for (const id of Object.keys(next.items)) {
    if (!currentIds.has(id)) delete next.items[id];
  }
  return next;
}
