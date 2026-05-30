"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdvancedFilters } from "./scryfall";
import type {
  Deck,
  DeckEntry,
  DeckSummary,
  ScryfallCard,
  ScryfallImageUris,
  ScryfallSet,
} from "./types";

const DB_NAME = "magicaldeckgatherer-offline";
const DB_VERSION = 2;
const CARD_STORE = "cards";
const SEARCH_STORE = "cardSearch";
const DECK_STORE = "decks";
const META_STORE = "meta";
const OFFLINE_CACHE = "magicaldeckgatherer-offline-assets-v1";
const SETTINGS_KEY = "mdg.offline.settings";
const ESTIMATED_TOTAL_BYTES = Math.round(1.3 * 1024 * 1024 * 1024);
const CARD_DOWNLOAD_URL =
  "https://data.scryfall.io/default-cards/default-cards-20260518090927.json";
const SETS_URL = "https://api.scryfall.com/sets";
const CATALOG_CONNECT_TIMEOUT_MS = 60_000;
const CATALOG_CHUNK_TIMEOUT_MS = 60_000;
const IMAGE_CONNECT_TIMEOUT_MS = 30_000;
const IMAGE_CACHE_WORKERS = 16;
const DECK_ART_CACHE_WORKERS = 8;
const SPEED_WINDOW_MS = 20_000;

type MetaRecord<T> = {
  key: string;
  value: T;
};

type SearchFields = {
  nameLower: string;
  oracleTextLower: string;
  typeLineLower: string;
  setCollector: string;
  searchTextLower: string;
};

type SearchableCard = ScryfallCard & SearchFields;
type StoredCard = SearchableCard;
type StoredSearchCard = SearchableCard;

export type OfflineSettings = {
  enabled: boolean;
  includeArt: boolean;
  acceptedWarningAt?: number;
  updatedAt: number;
};

export type OfflineCacheStatus = {
  phase:
    | "idle"
    | "cards"
    | "sets"
    | "art"
    | "ready"
    | "error";
  cardCount: number;
  imageCount: number;
  imageDone: number;
  catalogBytesDone: number;
  catalogBytesTotal?: number;
  imageBytesDone: number;
  imageBytesTotalEstimate?: number;
  bytesPerSecond?: number;
  itemsPerSecond?: number;
  etaSeconds?: number;
  storageBytes?: number;
  storageQuotaBytes?: number;
  updatedAt?: number;
  error?: string;
};

export type OfflineDeckSnapshot = {
  summaries: DeckSummary[];
  decks: Deck[];
  activeId: string | null;
  pendingDirtyIds: string[];
  pendingDeletedIds: string[];
};

export type OfflineModeState = {
  settings: OfflineSettings;
  status: OfflineCacheStatus;
  online: boolean;
  offlineActive: boolean;
  cacheReady: boolean;
  installing: boolean;
  syncing: boolean;
  pendingDeckChanges: number;
  estimateLabel: string;
  startDownload: () => Promise<void>;
  disable: () => void;
  clearCache: () => Promise<void>;
  setSyncing: (syncing: boolean) => void;
  refreshPendingDeckChanges: () => Promise<void>;
};

const DEFAULT_SETTINGS: OfflineSettings = {
  enabled: false,
  includeArt: true,
  updatedAt: 0,
};

const DEFAULT_STATUS: OfflineCacheStatus = {
  phase: "idle",
  cardCount: 0,
  imageCount: 0,
  imageDone: 0,
  catalogBytesDone: 0,
  imageBytesDone: 0,
};

let dbPromise: Promise<IDBDatabase> | null = null;
let searchIndexPromise: Promise<StoredSearchCard[]> | null = null;

export function useOfflineMode(): OfflineModeState {
  const [settings, setSettings] = useState<OfflineSettings>(() =>
    typeof window === "undefined" ? DEFAULT_SETTINGS : readSettings()
  );
  const [status, setStatus] = useState<OfflineCacheStatus>(DEFAULT_STATUS);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [syncing, setSyncing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [pendingDeckChanges, setPendingDeckChanges] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void readStatus().then(setStatus).catch(() => undefined);
    void countPendingDeckChanges()
      .then(setPendingDeckChanges)
      .catch(() => undefined);

    function onOnline() {
      setOnline(true);
    }
    function onOffline() {
      setOnline(false);
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!settings.enabled) return;
    void registerOfflineServiceWorker();
  }, [settings.enabled]);

  const refreshPendingDeckChanges = useCallback(async () => {
    setPendingDeckChanges(await countPendingDeckChanges());
  }, []);

  const writeSettings = useCallback((next: OfflineSettings) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    setSettings(next);
  }, []);

  const startDownload = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setInstalling(true);

    const nextSettings: OfflineSettings = {
      enabled: true,
      includeArt: true,
      acceptedWarningAt: Date.now(),
      updatedAt: Date.now(),
    };
    writeSettings(nextSettings);

    try {
      await registerOfflineServiceWorker();
      await navigator.storage?.persist?.();
      await downloadOfflineCatalog({
        includeArt: nextSettings.includeArt,
        signal: ac.signal,
        onStatus: (nextStatus) => {
          setStatus(nextStatus);
          void writeMeta("status", nextStatus);
        },
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      const nextStatus: OfflineCacheStatus = {
        ...DEFAULT_STATUS,
        phase: "error",
        error: (error as Error).message || "Offline download failed.",
        updatedAt: Date.now(),
      };
      setStatus(nextStatus);
      await writeMeta("status", nextStatus);
    } finally {
      if (abortRef.current === ac) {
        abortRef.current = null;
        setInstalling(false);
      }
    }
  }, [writeSettings]);

  const disable = useCallback(() => {
    abortRef.current?.abort();
    setInstalling(false);
    writeSettings({ ...settings, enabled: false, updatedAt: Date.now() });
  }, [settings, writeSettings]);

  const clearCache = useCallback(async () => {
    abortRef.current?.abort();
    setInstalling(false);
    await deleteDatabase();
    await caches.delete(OFFLINE_CACHE);
    const nextStatus = DEFAULT_STATUS;
    setStatus(nextStatus);
    writeSettings({ ...DEFAULT_SETTINGS, updatedAt: Date.now() });
    setPendingDeckChanges(0);
  }, [writeSettings]);

  const cacheReady = status.phase === "ready" && status.cardCount > 0;
  const offlineActive = settings.enabled && !online;

  return useMemo(
    () => ({
      settings,
      status,
      online,
      offlineActive,
      cacheReady,
      installing,
      syncing,
      pendingDeckChanges,
      estimateLabel: formatBytes(ESTIMATED_TOTAL_BYTES),
      startDownload,
      disable,
      clearCache,
      setSyncing,
      refreshPendingDeckChanges,
    }),
    [
      settings,
      status,
      online,
      offlineActive,
      cacheReady,
      installing,
      syncing,
      pendingDeckChanges,
      startDownload,
      disable,
      clearCache,
      refreshPendingDeckChanges,
    ]
  );
}

export async function searchOfflineCards(
  filters: AdvancedFilters,
  opts: { limit?: number; signal?: AbortSignal } = {}
) {
  const limit = opts.limit ?? 75;
  const rows = await getSearchIndex();
  const matchesByOracle = new Map<string, StoredSearchCard>();

  for (const card of rows) {
    if (opts.signal?.aborted) break;
    if (!matchesFilters(card, filters)) continue;
    const oracleId = card.oracle_id ?? card.id;
    const existing = matchesByOracle.get(oracleId);
    if (!existing || isNewerCard(card, existing)) {
      matchesByOracle.set(oracleId, card);
    }
  }

  const total = matchesByOracle.size;
  const matches = Array.from(matchesByOracle.values(), stripSearchFields);
  matches.sort((a, b) => compareCards(a, b, filters.sort ?? "name"));
  return {
    object: "list" as const,
    has_more: total > limit,
    total_cards: total,
    data: matches.slice(0, limit),
  };
}

export async function getOfflineCardById(id: string): Promise<ScryfallCard | null> {
  const db = await openDb();
  const tx = db.transaction(CARD_STORE, "readonly");
  const store = tx.objectStore(CARD_STORE);

  if (id.startsWith("oracle:")) {
    const oracleId = id.slice("oracle:".length);
    const cards = await requestToPromise<StoredCard[]>(
      store.index("oracleId").getAll(oracleId)
    );
    const card = newestCard(cards);
    return card ? stripStoredCard(card) : null;
  }

  const card = await requestToPromise<StoredCard | undefined>(store.get(id));
  return card ? stripStoredCard(card) : null;
}

export async function getOfflineCardsByIdentifiers(
  identifiers: Array<
    | { id: string }
    | { oracle_id: string }
    | { name: string }
    | { name: string; set: string }
    | { collector_number: string; set: string }
  >
): Promise<ScryfallCard[]> {
  const db = await openDb();
  const tx = db.transaction(CARD_STORE, "readonly");
  const store = tx.objectStore(CARD_STORE);
  const out: ScryfallCard[] = [];

  for (const identifier of identifiers) {
    let card: StoredCard | undefined;
    if ("id" in identifier) {
      card = await requestToPromise<StoredCard | undefined>(
        store.get(identifier.id)
      );
    } else if ("oracle_id" in identifier) {
      const cards = await requestToPromise<StoredCard[]>(
        store.index("oracleId").getAll(identifier.oracle_id)
      );
      card = newestCard(cards);
    } else if ("collector_number" in identifier) {
      card = await requestToPromise<StoredCard | undefined>(
        store.index("setCollector").get(
          setCollectorKey(identifier.set, identifier.collector_number)
        )
      );
    } else {
      const nameMatches = await requestToPromise<StoredCard[]>(
        store.index("nameLower").getAll(identifier.name.toLowerCase())
      );
      card = "set" in identifier
        ? nameMatches.find((candidate) => candidate.set === identifier.set)
        : newestCard(nameMatches);
    }
    if (card) out.push(stripStoredCard(card));
  }

  return out;
}

export async function resolveLinesOffline(
  lines: Array<{
    quantity: number;
    name: string;
    set?: string;
    collectorNumber?: string;
    isCommander?: boolean;
    zone?: "main" | "sideboard" | "maybeboard";
  }>
): Promise<{
  entries: DeckEntry[];
  sideboard: DeckEntry[];
  maybeboard: DeckEntry[];
  unresolved: typeof lines;
}> {
  const identifiers = lines.map((line) => {
    if (line.set && line.collectorNumber) {
      return { set: line.set, collector_number: line.collectorNumber };
    }
    if (line.set) return { name: line.name, set: line.set };
    return { name: line.name };
  });
  const cards = await getOfflineCardsByIdentifiers(identifiers);
  const byName = new Map<string, ScryfallCard>();
  for (const card of cards) {
    const full = card.name.toLowerCase();
    byName.set(full, card);
    const front = full.split(" // ")[0];
    if (front && front !== full) byName.set(front, card);
  }

  const entries: DeckEntry[] = [];
  const sideboard: DeckEntry[] = [];
  const maybeboard: DeckEntry[] = [];
  const unresolved: typeof lines = [];
  for (const line of lines) {
    const card = byName.get(line.name.toLowerCase());
    if (!card) {
      unresolved.push(line);
      continue;
    }
    const target =
      line.zone === "sideboard"
        ? sideboard
        : line.zone === "maybeboard"
          ? maybeboard
          : entries;
    const existing = target.find((entry) => entry.cardId === card.id);
    if (existing) {
      existing.quantity += line.quantity;
      if (line.zone === "main") {
        existing.isCommander ||= line.isCommander;
      }
    } else {
      const entry = cardToEntrySnapshot(card, line.quantity);
      if (line.zone === "main" && line.isCommander) {
        entry.isCommander = true;
      }
      target.push(entry);
    }
  }

  return { entries, sideboard, maybeboard, unresolved };
}

export async function loadOfflineDeckSnapshot(): Promise<OfflineDeckSnapshot> {
  const db = await openDb();
  const tx = db.transaction(DECK_STORE, "readonly");
  const decks = (
    await requestToPromise<Deck[]>(
      tx.objectStore(DECK_STORE).getAll()
    )
  ).map(normalizeOfflineDeck);
  const summaries =
    (await readMeta<DeckSummary[]>("deckSummaries")) ??
    decks.map(deckToSummary);
  return {
    summaries: summaries.map(normalizeOfflineSummary),
    decks,
    activeId: (await readMeta<string | null>("activeDeckId")) ?? null,
    pendingDirtyIds:
      (await readMeta<string[]>("pendingDirtyDeckIds")) ?? [],
    pendingDeletedIds:
      (await readMeta<string[]>("pendingDeletedDeckIds")) ?? [],
  };
}

export async function saveOfflineDeckSnapshot(
  summaries: DeckSummary[],
  decks?: Deck | Deck[] | null,
  activeId?: string | null
) {
  const db = await openDb();
  const tx = db.transaction([DECK_STORE, META_STORE], "readwrite");
  tx.objectStore(META_STORE).put({
    key: "deckSummaries",
    value: summaries.map(normalizeOfflineSummary),
  });
  if (activeId !== undefined) {
    tx.objectStore(META_STORE).put({ key: "activeDeckId", value: activeId });
  }
  const deckList = Array.isArray(decks) ? decks : decks ? [decks] : [];
  for (const deck of deckList) {
    tx.objectStore(DECK_STORE).put(normalizeOfflineDeck(deck));
  }
  await txDone(tx);
}

export async function putOfflineDeck(deck: Deck, dirty = true) {
  const snapshot = await loadOfflineDeckSnapshot();
  const summaries = upsertSummary(snapshot.summaries, deckToSummary(deck));
  const dirtyIds = dirty
    ? unique([...snapshot.pendingDirtyIds, deck.id])
    : snapshot.pendingDirtyIds;
  const deletedIds = snapshot.pendingDeletedIds.filter((id) => id !== deck.id);

  const db = await openDb();
  const tx = db.transaction([DECK_STORE, META_STORE], "readwrite");
  tx.objectStore(DECK_STORE).put(normalizeOfflineDeck(deck));
  tx.objectStore(META_STORE).put({ key: "deckSummaries", value: summaries });
  tx.objectStore(META_STORE).put({ key: "pendingDirtyDeckIds", value: dirtyIds });
  tx.objectStore(META_STORE).put({
    key: "pendingDeletedDeckIds",
    value: deletedIds,
  });
  await txDone(tx);
}

export async function deleteOfflineDeck(deckId: string) {
  const snapshot = await loadOfflineDeckSnapshot();
  const db = await openDb();
  const tx = db.transaction([DECK_STORE, META_STORE], "readwrite");
  tx.objectStore(DECK_STORE).delete(deckId);
  tx.objectStore(META_STORE).put({
    key: "deckSummaries",
    value: snapshot.summaries.filter((summary) => summary.id !== deckId),
  });
  tx.objectStore(META_STORE).put({
    key: "pendingDirtyDeckIds",
    value: snapshot.pendingDirtyIds.filter((id) => id !== deckId),
  });
  tx.objectStore(META_STORE).put({
    key: "pendingDeletedDeckIds",
    value: unique([...snapshot.pendingDeletedIds, deckId]),
  });
  await txDone(tx);
}

export async function setOfflineActiveDeck(deckId: string | null) {
  await writeMeta("activeDeckId", deckId);
}

export async function clearSyncedDeckChanges(deckIds: string[], deletedIds: string[]) {
  const snapshot = await loadOfflineDeckSnapshot();
  await writeMeta(
    "pendingDirtyDeckIds",
    snapshot.pendingDirtyIds.filter((id) => !deckIds.includes(id))
  );
  await writeMeta(
    "pendingDeletedDeckIds",
    snapshot.pendingDeletedIds.filter((id) => !deletedIds.includes(id))
  );
}

export async function countPendingDeckChanges() {
  const snapshot = await loadOfflineDeckSnapshot().catch(() => null);
  if (!snapshot) return 0;
  return snapshot.pendingDirtyIds.length + snapshot.pendingDeletedIds.length;
}

export async function readOfflineSets(): Promise<ScryfallSet[]> {
  return (await readMeta<ScryfallSet[]>("sets")) ?? [];
}

export async function cacheNormalArtForDecks(decks: Deck[]) {
  if (decks.length === 0 || typeof caches === "undefined") return;

  const urls = new Set<string>();
  const cardIds = new Set<string>();
  for (const deck of decks) {
    for (const entry of [
      ...deck.entries,
      ...(deck.sideboard ?? []),
      ...(deck.maybeboard ?? []),
    ]) {
      if (entry.imageNormal) urls.add(entry.imageNormal);
      cardIds.add(entry.cardId);
    }
  }

  const cards = await getOfflineCardsByIdentifiers(
    Array.from(cardIds, (id) => ({ id }))
  ).catch(() => []);
  for (const card of cards) collectCardImageUrls(card, "normal", urls);

  await cacheImages(
    Array.from(urls),
    new AbortController().signal,
    () => undefined,
    { checkExisting: true, workerCount: DECK_ART_CACHE_WORKERS }
  );
}

export function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

async function downloadOfflineCatalog({
  includeArt,
  signal,
  onStatus,
}: {
  includeArt: boolean;
  signal: AbortSignal;
  onStatus: (status: OfflineCacheStatus) => void;
}) {
  let lastStorageCheck = 0;
  const storageBaselineBytes = (await currentStorageUsage()) ?? 0;
  const catalogStartedAt = Date.now();
  const estimateCatalogBytes = createByteProgressEstimator(catalogStartedAt);
  let status: OfflineCacheStatus = {
    ...DEFAULT_STATUS,
    phase: "cards",
    updatedAt: catalogStartedAt,
  };

  async function emitStatus(forceStorage = false) {
    const now = Date.now();
    if (forceStorage || now - lastStorageCheck > 1000) {
      lastStorageCheck = now;
      status = await withStorageEstimate(status, storageBaselineBytes);
    }
    onStatus(status);
  }

  await emitStatus(true);

  const { cardCount, imageUrls } = await streamCardsToDb(
    CARD_DOWNLOAD_URL,
    signal,
    async (progress) => {
      const nextCatalogBytes =
        progress.catalogBytesDone ?? status.catalogBytesDone;
      const nextCatalogTotal =
        progress.catalogBytesTotal ?? status.catalogBytesTotal;
      status = {
        ...status,
        ...progress,
        ...estimateCatalogBytes(nextCatalogBytes, nextCatalogTotal),
        updatedAt: Date.now(),
      };
      await emitStatus();
    }
  );

  status = {
    ...status,
    phase: "sets",
    cardCount,
    etaSeconds: undefined,
    bytesPerSecond: undefined,
    itemsPerSecond: undefined,
  };
  await emitStatus(true);
  const setsRes = await fetch(SETS_URL, { signal });
  const setsBody = (await setsRes.json()) as { data?: ScryfallSet[] };
  await writeMeta("sets", setsBody.data ?? []);

  if (includeArt) {
    const artStartedAt = Date.now();
    const estimateArtBytes = createByteProgressEstimator(artStartedAt);
    const estimateArtItems = createItemProgressEstimator(artStartedAt);
    status = {
      ...status,
      phase: "art",
      imageCount: imageUrls.length,
      imageDone: 0,
      imageBytesDone: 0,
      imageBytesTotalEstimate: undefined,
      etaSeconds: undefined,
      bytesPerSecond: undefined,
      itemsPerSecond: undefined,
    };
    await emitStatus(true);
    await cacheImages(
      imageUrls,
      signal,
      async (imageDone, imageBytesDone) => {
        const imageBytesTotalEstimate =
          imageDone > 0 && imageBytesDone > 0
            ? Math.round((imageBytesDone / imageDone) * imageUrls.length)
            : undefined;
        status = {
          ...status,
          imageDone,
          imageBytesDone,
          imageBytesTotalEstimate,
          ...(imageBytesTotalEstimate
            ? estimateArtBytes(imageBytesDone, imageBytesTotalEstimate)
            : estimateArtItems(imageDone, imageUrls.length)),
          updatedAt: Date.now(),
        };
        await emitStatus();
      },
      { checkExisting: false, workerCount: IMAGE_CACHE_WORKERS }
    );
  }

  status = {
    ...status,
    phase: "ready",
    etaSeconds: 0,
    bytesPerSecond: undefined,
    itemsPerSecond: undefined,
    updatedAt: Date.now(),
  };
  await emitStatus(true);
}

async function streamCardsToDb(
  url: string,
  signal: AbortSignal,
  onProgress: (progress: {
    cardCount?: number;
    catalogBytesDone?: number;
    catalogBytesTotal?: number;
  }) => void | Promise<void>
): Promise<{ cardCount: number; imageUrls: string[] }> {
  const db = await openDb();
  const imageUrls = new Set<string>();
  let chunk: Array<{ card: StoredCard; search: StoredSearchCard }> = [];
  let written = 0;
  let catalogBytesDone = 0;
  let catalogBytesTotal: number | undefined;
  let lastByteProgressAt = 0;
  const chunkSize = 500;

  searchIndexPromise = null;

  const clearTx = db.transaction([CARD_STORE, SEARCH_STORE], "readwrite");
  clearTx.objectStore(CARD_STORE).clear();
  clearTx.objectStore(SEARCH_STORE).clear();
  await txDone(clearTx);

  async function flushChunk() {
    if (chunk.length === 0) return;
    const pending = chunk;
    chunk = [];
    const tx = db.transaction([CARD_STORE, SEARCH_STORE], "readwrite");
    const cards = tx.objectStore(CARD_STORE);
    const search = tx.objectStore(SEARCH_STORE);
    for (const item of pending) {
      cards.put(item.card);
      search.put(item.search);
    }
    await txDone(tx);
    written += pending.length;
    await onProgress({ cardCount: written, catalogBytesDone, catalogBytesTotal });
    await yieldToBrowser();
  }

  await streamJsonObjects<ScryfallCard>(
    url,
    signal,
    async (card) => {
      chunk.push({ card: toStoredCard(card), search: toSearchCard(card) });
      collectCardImageUrls(card, "small", imageUrls);
      if (chunk.length >= chunkSize) await flushChunk();
    },
    async (bytesDone, bytesTotal) => {
      catalogBytesDone = bytesDone;
      catalogBytesTotal = bytesTotal;
      const now = Date.now();
      if (now - lastByteProgressAt < 500) return;
      lastByteProgressAt = now;
      await onProgress({ catalogBytesDone, catalogBytesTotal });
    }
  );

  await flushChunk();
  searchIndexPromise = null;
  return { cardCount: written, imageUrls: Array.from(imageUrls) };
}

async function cacheImages(
  urls: string[],
  signal: AbortSignal,
  onProgress: (done: number, bytesDone: number) => void | Promise<void>,
  options: { checkExisting?: boolean; workerCount?: number } = {}
) {
  const cache = await caches.open(OFFLINE_CACHE);
  let index = 0;
  let done = 0;
  let bytesDone = 0;
  const checkExisting = options.checkExisting === true;
  const workerCount = options.workerCount ?? IMAGE_CACHE_WORKERS;

  async function worker() {
    while (index < urls.length) {
      const url = urls[index++];
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const cached = checkExisting ? await cache.match(url) : undefined;
        if (!cached) {
          const res = await fetchWithTimeout(
            url,
            signal,
            IMAGE_CONNECT_TIMEOUT_MS,
            "Timed out downloading card art from Scryfall."
          );
          if (res.ok || res.type === "opaque") {
            bytesDone += await putResponseInCache(cache, url, res);
          }
        }
      } catch {
        // Keep the bulk download resilient; individual card images can retry
        // on the next offline-cache refresh.
      } finally {
        done += 1;
        if (done % 25 === 0 || done === urls.length) {
          await onProgress(done, bytesDone);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
}

async function streamJsonObjects<T>(
  url: string,
  signal: AbortSignal,
  onObject: (value: T, seen: number) => void | Promise<void>,
  onBytes?: (
    bytesDone: number,
    bytesTotal: number | undefined
  ) => void | Promise<void>
) {
  const res = await fetchWithTimeout(
    url,
    signal,
    CATALOG_CONNECT_TIMEOUT_MS,
    "Timed out connecting to Scryfall's bulk card file."
  );
  if (!res.ok) throw new Error(`Could not download card catalog (${res.status}).`);
  if (!res.body) {
    throw new Error("This browser does not support streaming offline downloads.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const bytesTotal = responseContentLength(res) || undefined;
  let bytesDone = 0;
  let buffer = "";
  let seen = 0;

  while (true) {
    const { value, done } = await readChunkWithTimeout(reader, signal);
    if (done) {
      buffer += decoder.decode();
      await parseBufferedObjects();
      break;
    }
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");

    bytesDone += value.byteLength;
    await onBytes?.(bytesDone, bytesTotal);
    buffer += decoder.decode(value, { stream: true });
    await parseBufferedObjects();
  }

  async function parseBufferedObjects() {
    while (true) {
      const objectStart = buffer.indexOf("{");
      if (objectStart < 0) {
        buffer = "";
        return;
      }

      const objectEnd = findCompleteObjectEnd(buffer, objectStart);
      if (objectEnd < 0) {
        if (objectStart > 0) buffer = buffer.slice(objectStart);
        return;
      }

      seen += 1;
      await onObject(
        JSON.parse(buffer.slice(objectStart, objectEnd + 1)) as T,
        seen
      );
      buffer = buffer.slice(objectEnd + 1);
    }
  }
}

function collectCardImageUrls(
  card: ScryfallCard,
  size: keyof ScryfallImageUris,
  urls: Set<string>
) {
  addCardImageUrl(card.image_uris, size, urls);
  for (const face of card.card_faces ?? []) {
    addCardImageUrl(face.image_uris, size, urls);
  }
}

function addCardImageUrl(
  images: ScryfallImageUris | undefined,
  size: keyof ScryfallImageUris,
  urls: Set<string>
) {
  if (!images) return;
  const value = images[size] ?? images.normal ?? images.large ?? images.small;
  if (value) urls.add(value);
}

async function yieldToBrowser() {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

async function currentStorageUsage() {
  const estimate = await navigator.storage?.estimate?.();
  return estimate?.usage;
}

async function withStorageEstimate(
  status: OfflineCacheStatus,
  baselineBytes: number
) {
  const estimate = await navigator.storage?.estimate?.();
  if (!estimate) return status;
  return {
    ...status,
    storageBytes:
      typeof estimate.usage === "number"
        ? Math.max(0, estimate.usage - baselineBytes)
        : undefined,
    storageQuotaBytes: estimate.quota,
  };
}

function createByteProgressEstimator(startedAt: number) {
  const estimate = createRateEstimator(startedAt);
  return (
    done: number,
    total: number | undefined
  ): Pick<OfflineCacheStatus, "bytesPerSecond" | "etaSeconds"> => {
    const bytesPerSecond = estimate(done);
    const hasRate =
      typeof bytesPerSecond === "number" && bytesPerSecond > 0;
    return {
      bytesPerSecond,
      etaSeconds:
        total && total > done && hasRate
          ? Math.ceil((total - done) / bytesPerSecond)
          : total && total <= done
            ? 0
            : undefined,
    };
  };
}

function createItemProgressEstimator(startedAt: number) {
  const estimate = createRateEstimator(startedAt);
  return (
    done: number,
    total: number
  ): Pick<OfflineCacheStatus, "itemsPerSecond" | "etaSeconds"> => {
    const itemsPerSecond = estimate(done);
    const hasRate =
      typeof itemsPerSecond === "number" && itemsPerSecond > 0;
    return {
      itemsPerSecond,
      etaSeconds:
        total > done && hasRate
          ? Math.ceil((total - done) / itemsPerSecond)
          : total <= done
            ? 0
            : undefined,
    };
  };
}

function createRateEstimator(startedAt: number) {
  const samples: Array<{ at: number; done: number }> = [
    { at: startedAt, done: 0 },
  ];

  return (done: number) => {
    const now = Date.now();
    samples.push({ at: now, done });
    while (
      samples.length > 2 &&
      now - samples[0].at > SPEED_WINDOW_MS
    ) {
      samples.shift();
    }

    const first = samples[0];
    const elapsedSeconds = (now - first.at) / 1000;
    const delta = done - first.done;
    if (elapsedSeconds <= 0 || delta <= 0) return undefined;
    return delta / elapsedSeconds;
  };
}

async function putResponseInCache(
  cache: Cache,
  url: string,
  response: Response
) {
  if (response.type === "opaque") {
    await cache.put(url, response);
    return responseContentLength(response);
  }

  const blob = await response.blob();
  const cachedResponse = new Response(blob, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
  await cache.put(url, cachedResponse);
  return blob.size || responseContentLength(response);
}

async function fetchWithTimeout(
  url: string,
  signal: AbortSignal,
  timeoutMs: number,
  timeoutMessage: string
) {
  const ac = new AbortController();
  const abort = () => ac.abort(signal.reason);
  const timeout = window.setTimeout(() => ac.abort(), timeoutMs);
  signal.addEventListener("abort", abort, { once: true });

  try {
    return await fetch(url, { signal: ac.signal });
  } catch (error) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (ac.signal.aborted) throw new Error(timeoutMessage);
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

async function readChunkWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal
) {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
        timeout = window.setTimeout(() => {
          reject(new Error("Timed out downloading Scryfall's bulk card file."));
        }, CATALOG_CHUNK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  }
}

function responseContentLength(response: Response) {
  const raw = response.headers.get("content-length");
  if (!raw) return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function findCompleteObjectEnd(buffer: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < buffer.length; i++) {
    const char = buffer[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function isNewerCard(a: ScryfallCard, b: ScryfallCard) {
  const dateCompare = (a.released_at ?? "").localeCompare(b.released_at ?? "");
  if (dateCompare !== 0) return dateCompare > 0;
  return a.name.localeCompare(b.name) < 0;
}

function newestCard<T extends ScryfallCard>(cards: T[]) {
  let newest: T | undefined;
  for (const card of cards) {
    if (!newest || isNewerCard(card, newest)) newest = card;
  }
  return newest;
}

async function registerOfflineServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  await navigator.serviceWorker.register("/offline-sw.js");
}

function readSettings(): OfflineSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as OfflineSettings) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function readStatus() {
  const stored = await readMeta<Partial<OfflineCacheStatus>>("status");
  const status: OfflineCacheStatus = { ...DEFAULT_STATUS, ...stored };
  if (!isRunningPhase(status.phase)) return status;
  return {
    ...status,
    phase: "error" as const,
    error: "The previous offline download was interrupted. Refresh the offline cache to retry.",
    updatedAt: Date.now(),
  };
}

function isRunningPhase(phase: OfflineCacheStatus["phase"]) {
  return (
    phase === "cards" ||
    phase === "sets" ||
    phase === "art"
  );
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CARD_STORE)) {
        const cards = db.createObjectStore(CARD_STORE, { keyPath: "id" });
        cards.createIndex("nameLower", "nameLower", { unique: false });
        cards.createIndex("oracleId", "oracle_id", { unique: false });
        cards.createIndex("setCollector", "setCollector", { unique: false });
      }
      if (!db.objectStoreNames.contains(SEARCH_STORE)) {
        const search = db.createObjectStore(SEARCH_STORE, { keyPath: "id" });
        search.createIndex("nameLower", "nameLower", { unique: false });
        search.createIndex("oracleId", "oracle_id", { unique: false });
        search.createIndex("setCollector", "setCollector", { unique: false });
      }
      if (!db.objectStoreNames.contains(DECK_STORE)) {
        db.createObjectStore(DECK_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };
  });
  return dbPromise;
}

async function deleteDatabase() {
  dbPromise = null;
  searchIndexPromise = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
    req.onblocked = () => resolve();
  });
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function iterateCursor<T>(
  store: IDBObjectStore,
  each: (value: T) => boolean
) {
  await new Promise<void>((resolve, reject) => {
    const req = store.openCursor();
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      if (each(cursor.value as T) === false) {
        resolve();
        return;
      }
      cursor.continue();
    };
  });
}

async function readMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const tx = db.transaction(META_STORE, "readonly");
  return await readMetaWithTx<T>(tx, key);
}

async function readMetaWithTx<T>(
  tx: IDBTransaction,
  key: string
): Promise<T | undefined> {
  const record = await requestToPromise<MetaRecord<T> | undefined>(
    tx.objectStore(META_STORE).get(key)
  );
  return record?.value;
}

async function writeMeta<T>(key: string, value: T) {
  const db = await openDb();
  const tx = db.transaction(META_STORE, "readwrite");
  tx.objectStore(META_STORE).put({ key, value });
  await txDone(tx);
}

async function getSearchIndex() {
  if (!searchIndexPromise) searchIndexPromise = loadSearchIndex();
  return searchIndexPromise;
}

async function loadSearchIndex() {
  const db = await openDb();
  let rows = await readSearchRows(db);
  if (rows.length > 0) return rows;

  await rebuildSearchStore(db);
  rows = await readSearchRows(db);
  return rows;
}

async function readSearchRows(db: IDBDatabase) {
  const tx = db.transaction(SEARCH_STORE, "readonly");
  return await requestToPromise<StoredSearchCard[]>(
    tx.objectStore(SEARCH_STORE).getAll()
  );
}

async function rebuildSearchStore(db: IDBDatabase) {
  const rows: StoredSearchCard[] = [];
  const readTx = db.transaction(CARD_STORE, "readonly");
  await iterateCursor<StoredCard>(readTx.objectStore(CARD_STORE), (card) => {
    rows.push(toSearchCard(card));
    return true;
  });
  if (rows.length === 0) return;

  const chunkSize = 1000;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const tx = db.transaction(SEARCH_STORE, "readwrite");
    const store = tx.objectStore(SEARCH_STORE);
    for (const row of rows.slice(i, i + chunkSize)) store.put(row);
    await txDone(tx);
  }
}

function toStoredCard(card: ScryfallCard): StoredCard {
  return {
    ...card,
    ...searchFields(card),
  };
}

function stripStoredCard(card: StoredCard): ScryfallCard {
  return stripSearchFields(card);
}

function toSearchCard(card: ScryfallCard): StoredSearchCard {
  const compact = compactCard(card);
  return {
    ...compact,
    ...searchFields(compact),
  };
}

function stripSearchFields(card: SearchableCard): ScryfallCard {
  const {
    nameLower,
    oracleTextLower,
    typeLineLower,
    setCollector,
    searchTextLower,
    ...rest
  } = card;
  void nameLower;
  void oracleTextLower;
  void typeLineLower;
  void setCollector;
  void searchTextLower;
  return rest;
}

function searchFields(card: ScryfallCard): SearchFields {
  const nameLower = card.name.toLowerCase();
  const oracleTextLower = oracleText(card).toLowerCase();
  const typeLineLower = (card.type_line ?? card.card_faces?.[0]?.type_line ?? "")
    .toLowerCase();
  return {
    nameLower,
    oracleTextLower,
    typeLineLower,
    setCollector: setCollectorKey(card.set, card.collector_number),
    searchTextLower: `${nameLower} ${typeLineLower} ${oracleTextLower}`,
  };
}

function compactCard(card: ScryfallCard): ScryfallCard {
  return {
    id: card.id,
    oracle_id: card.oracle_id,
    name: card.name,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    colors: card.colors,
    color_identity: card.color_identity,
    rarity: card.rarity,
    set: card.set,
    set_name: card.set_name,
    released_at: card.released_at,
    collector_number: card.collector_number,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
    layout: card.layout,
    image_uris: compactImages(card.image_uris),
    card_faces: card.card_faces?.map((face) => ({
      name: face.name,
      mana_cost: face.mana_cost,
      type_line: face.type_line,
      oracle_text: face.oracle_text,
      power: face.power,
      toughness: face.toughness,
      image_uris: compactImages(face.image_uris),
    })),
    scryfall_uri: card.scryfall_uri,
    legalities: card.legalities,
    prices: card.prices ? { usd: card.prices.usd } : undefined,
    edhrec_rank: card.edhrec_rank,
  };
}

function compactImages(
  images: ScryfallImageUris | undefined
): ScryfallImageUris | undefined {
  if (!images) return undefined;
  return {
    small: images.small,
    normal: images.normal,
  };
}

function setCollectorKey(set?: string, collectorNumber?: string) {
  return `${set?.toLowerCase() ?? ""}:${collectorNumber ?? ""}`;
}

function oracleText(card: ScryfallCard) {
  if (card.oracle_text) return card.oracle_text;
  return (
    card.card_faces
      ?.map((face) => face.oracle_text)
      .filter(Boolean)
      .join("\n") ?? ""
  );
}

function matchesFilters(card: SearchableCard, filters: AdvancedFilters) {
  const text = filters.text?.trim().toLowerCase();
  if (text && !searchText(card).includes(text)) return false;
  const name = filters.name?.trim().toLowerCase();
  if (name && !card.nameLower.includes(name)) return false;
  const oracle = filters.oracle?.trim().toLowerCase();
  if (oracle && !card.oracleTextLower.includes(oracle)) return false;
  const excludeTerms = (filters.excludeOracle ?? "")
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  if (excludeTerms.some((term) => card.oracleTextLower.includes(term))) {
    return false;
  }
  const type = filters.type?.trim().toLowerCase();
  if (type && !card.typeLineLower.includes(type)) return false;
  if (filters.colors?.length && !matchesColors(card, filters)) return false;
  if (filters.rarity?.length && !filters.rarity.includes(card.rarity ?? "")) {
    return false;
  }
  if (filters.set?.trim() && card.set !== filters.set.trim().toLowerCase()) {
    return false;
  }
  if (typeof filters.cmcMin === "number" && (card.cmc ?? 0) < filters.cmcMin) {
    return false;
  }
  if (typeof filters.cmcMax === "number" && (card.cmc ?? 0) > filters.cmcMax) {
    return false;
  }
  if (filters.power?.trim() && !matchesStat(card.power, filters.power)) {
    return false;
  }
  if (filters.toughness?.trim() && !matchesStat(card.toughness, filters.toughness)) {
    return false;
  }
  if (
    filters.format?.trim() &&
    card.legalities?.[filters.format.trim()]?.toLowerCase() !== "legal"
  ) {
    return false;
  }
  const usd = Number(card.prices?.usd ?? NaN);
  if (typeof filters.usdMin === "number" && !(usd >= filters.usdMin)) return false;
  if (typeof filters.usdMax === "number" && !(usd <= filters.usdMax)) return false;
  return true;
}

function searchText(card: SearchableCard) {
  return card.searchTextLower;
}

function matchesColors(card: ScryfallCard, filters: AdvancedFilters) {
  const selected = new Set(filters.colors ?? []);
  const values =
    filters.colorMode === "identity"
      ? card.color_identity ?? []
      : card.colors ?? card.color_identity ?? [];
  const cardSet = new Set(values);

  if (filters.colorMode === "exact") {
    return selected.size === cardSet.size && [...selected].every((c) => cardSet.has(c));
  }
  if (filters.colorMode === "including") {
    return [...selected].every((c) => cardSet.has(c));
  }
  return [...cardSet].every((c) => selected.has(c));
}

function matchesStat(value: string | undefined, raw: string) {
  const stat = Number(value);
  if (!Number.isFinite(stat)) return false;
  const match = /^(<=|>=|<|>|=)?\s*(-?\d+(?:\.\d+)?)$/.exec(raw.trim());
  if (!match) return false;
  const op = match[1] ?? "=";
  const target = Number(match[2]);
  if (op === "<=") return stat <= target;
  if (op === ">=") return stat >= target;
  if (op === "<") return stat < target;
  if (op === ">") return stat > target;
  return stat === target;
}

function compareCards(
  a: ScryfallCard,
  b: ScryfallCard,
  sort: NonNullable<AdvancedFilters["sort"]>
) {
  if (sort === "cmc") {
    const byCmc = (a.cmc ?? 0) - (b.cmc ?? 0);
    if (byCmc !== 0) return byCmc;
  } else if (sort === "color") {
    const byColor = colorKey(a).localeCompare(colorKey(b));
    if (byColor !== 0) return byColor;
  } else if (sort === "rarity") {
    const byRarity = rarityRank(b.rarity) - rarityRank(a.rarity);
    if (byRarity !== 0) return byRarity;
  } else if (sort === "released") {
    const byDate = (b.released_at ?? "").localeCompare(a.released_at ?? "");
    if (byDate !== 0) return byDate;
  } else if (sort === "usd") {
    const byPrice = Number(b.prices?.usd ?? 0) - Number(a.prices?.usd ?? 0);
    if (byPrice !== 0) return byPrice;
  } else if (sort === "edhrec") {
    const byRank = (a.edhrec_rank ?? Number.MAX_SAFE_INTEGER) -
      (b.edhrec_rank ?? Number.MAX_SAFE_INTEGER);
    if (byRank !== 0) return byRank;
  }
  return a.name.localeCompare(b.name);
}

function colorKey(card: ScryfallCard) {
  return (card.color_identity ?? card.colors ?? []).join("");
}

function rarityRank(rarity?: string) {
  if (rarity === "mythic") return 4;
  if (rarity === "rare") return 3;
  if (rarity === "uncommon") return 2;
  if (rarity === "common") return 1;
  return 0;
}

function cardToEntrySnapshot(card: ScryfallCard, quantity: number): DeckEntry {
  const usd = card.prices?.usd;
  const priceUsd = usd != null && usd !== "" ? Number(usd) : undefined;
  return {
    cardId: card.id,
    name: card.name,
    quantity,
    imageSmall: card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small,
    imageNormal:
      card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal,
    manaCost: card.mana_cost || card.card_faces?.[0]?.mana_cost || undefined,
    cmc: card.cmc,
    typeLine: card.type_line || card.card_faces?.[0]?.type_line,
    colors: card.colors,
    rarity: card.rarity,
    set: card.set,
    collectorNumber: card.collector_number,
    priceUsd: Number.isFinite(priceUsd) ? priceUsd : undefined,
    legalities: card.legalities,
  };
}

function deckToSummary(deck: Deck): DeckSummary {
  const normalized = normalizeOfflineDeck(deck);
  return {
    id: normalized.id,
    publicId: normalized.publicId,
    isPublic: normalized.isPublic,
    name: normalized.name,
    format: normalized.format,
    cardCount: countDeckEntries(normalized.entries),
    sideboardCount: countDeckEntries(normalized.sideboard),
    maybeboardCount: countDeckEntries(normalized.maybeboard),
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
  };
}

function normalizeOfflineDeck(deck: Deck): Deck {
  const sideboard = deck.sideboard ?? [];
  const entries = deck.entries ?? [];
  const maybeboard = deck.maybeboard ?? [];
  return {
    ...deck,
    isPublic: deck.isPublic ?? false,
    entries,
    sideboard,
    maybeboard,
    cardCount: countDeckEntries(entries),
    sideboardCount: countDeckEntries(sideboard),
    maybeboardCount: countDeckEntries(maybeboard),
  };
}

function normalizeOfflineSummary(summary: DeckSummary): DeckSummary {
  return {
    ...summary,
    isPublic: summary.isPublic ?? false,
    sideboardCount: summary.sideboardCount ?? 0,
    maybeboardCount: summary.maybeboardCount ?? 0,
  };
}

function countDeckEntries(entries: DeckEntry[] | undefined) {
  return (entries ?? []).reduce((total, entry) => total + entry.quantity, 0);
}

function upsertSummary(summaries: DeckSummary[], summary: DeckSummary) {
  const existing = summaries.some((item) => item.id === summary.id);
  const next = existing
    ? summaries.map((item) => (item.id === summary.id ? summary : item))
    : [...summaries, summary];
  return next.sort((a, b) => a.createdAt - b.createdAt);
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
