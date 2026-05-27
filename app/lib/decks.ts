"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type {
  Deck,
  DeckEntry,
  DeckSummary,
  DeckZone,
  PublicDeck,
  ScryfallCard,
} from "./types";
import { getCardImage, getCardsByIdentifiers } from "./scryfall";
import {
  cacheNormalArtForDecks,
  clearSyncedDeckChanges,
  deleteOfflineDeck,
  loadOfflineDeckSnapshot,
  putOfflineDeck,
  saveOfflineDeckSnapshot,
  setOfflineActiveDeck,
  type OfflineDeckSnapshot,
} from "./offline";

type Snapshot = { deck: Deck; activeId: string };
const CARD_QUANTITY_LIMIT = 255;
const MAX_HISTORY = 100;
const EMPTY_DECK_SUMMARIES: DeckSummary[] = [];
const EMPTY_DECK_IDS: string[] = [];
const EMPTY_OFFLINE_SNAPSHOT: OfflineDeckSnapshot = {
  summaries: [],
  decks: [],
  activeId: null,
  pendingDirtyIds: [],
  pendingDeletedIds: [],
};
const DECK_SETTINGS_KEY = "mdg.deck.settings";
const ANONYMOUS_DECK_ID = "anonymous-local-deck";
const ANONYMOUS_DECK_NAME = "Untitled Deck";

type UseDecksOptions = {
  offlineEnabled?: boolean;
  offlineActive?: boolean;
  online?: boolean;
  temporaryPublicDeckId?: string | null;
  onOfflineSyncingChange?: (syncing: boolean) => void;
  onPendingDeckChangesChange?: () => void;
};

function uid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  );
}

function readDefaultDeckPublic() {
  if (typeof window === "undefined") return true;

  try {
    const raw = window.localStorage.getItem(DECK_SETTINGS_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as { defaultPublic?: unknown };
    return typeof parsed.defaultPublic === "boolean"
      ? parsed.defaultPublic
      : true;
  } catch {
    return true;
  }
}

function writeDefaultDeckPublic(defaultPublic: boolean) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      DECK_SETTINGS_KEY,
      JSON.stringify({ defaultPublic, updatedAt: Date.now() })
    );
  } catch {
    // Storage can be disabled by browser privacy settings.
  }
}

function createEmptyDeck(
  deckId: string,
  name = "Untitled Deck",
  isPublic = false
): Deck {
  const now = Date.now();
  return {
    id: deckId,
    isPublic,
    name,
    format: "commander",
    cardCount: 0,
    sideboardCount: 0,
    maybeboardCount: 0,
    createdAt: now,
    updatedAt: now,
    entries: [],
    sideboard: [],
    maybeboard: [],
  };
}

function deckToSummary(deck: Deck): DeckSummary {
  const counted = withDeckCounts(deck);
  return {
    id: counted.id,
    publicId: counted.publicId,
    isPublic: counted.isPublic,
    name: counted.name,
    format: counted.format,
    cardCount: counted.cardCount,
    sideboardCount: counted.sideboardCount,
    maybeboardCount: counted.maybeboardCount,
    createdAt: counted.createdAt,
    updatedAt: counted.updatedAt,
  };
}

function cloneDeck(deck: Deck): Deck {
  return withDeckCounts({
    ...deck,
    entries: cloneEntries(deck.entries),
    sideboard: cloneEntries(deck.sideboard),
    maybeboard: cloneEntries(deck.maybeboard),
  });
}

function cloneEntries(entries: DeckEntry[] | undefined): DeckEntry[] {
  return (entries ?? []).map((entry) => ({ ...entry }));
}

function countEntries(entries: DeckEntry[] | undefined) {
  return (entries ?? []).reduce((total, entry) => total + entry.quantity, 0);
}

function withDeckCounts(deck: Deck): Deck {
  const entries = cloneEntries(deck.entries);
  const sideboard = cloneEntries(deck.sideboard);
  const maybeboard = cloneEntries(deck.maybeboard);
  return {
    ...deck,
    isPublic: deck.isPublic ?? false,
    entries,
    sideboard,
    maybeboard,
    cardCount: countEntries(entries),
    sideboardCount: countEntries(sideboard),
    maybeboardCount: countEntries(maybeboard),
  };
}

export function cardToEntry(card: ScryfallCard, quantity = 1): DeckEntry {
  const usd = card.prices?.usd;
  const priceUsd = usd != null && usd !== "" ? Number(usd) : undefined;
  return {
    cardId: card.id,
    name: card.name,
    quantity,
    imageSmall: getCardImage(card, "small"),
    imageNormal: getCardImage(card, "normal"),
    imageArtCrop: getCardImage(card, "art_crop"),
    manaCost: card.mana_cost || card.card_faces?.[0]?.mana_cost || undefined,
    cmc: card.cmc,
    typeLine: card.type_line || card.card_faces?.[0]?.type_line,
    colors: card.colors,
    rarity: card.rarity,
    set: card.set,
    collectorNumber: card.collector_number,
    priceUsd: Number.isFinite(priceUsd) ? priceUsd : undefined,
  };
}

export function useDecks(options: UseDecksOptions = {}) {
  const auth = useConvexAuth();
  const offlineEnabled = options.offlineEnabled === true;
  const offlineActive = options.offlineActive === true;
  const anonymousDecksActive = !auth.isLoading && !auth.isAuthenticated;
  const localDecksActive = offlineActive || anonymousDecksActive;
  const deckCacheEnabled =
    offlineEnabled || localDecksActive || auth.isAuthenticated;
  const online = options.online !== false;
  const temporaryPublicDeckId = options.temporaryPublicDeckId ?? null;
  const viewingTemporaryDeck = temporaryPublicDeckId !== null;
  const onOfflineSyncingChange = options.onOfflineSyncingChange;
  const onPendingDeckChangesChange = options.onPendingDeckChangesChange;
  const [offlineSnapshot, setOfflineSnapshot] =
    useState<OfflineDeckSnapshot | null>(null);
  const [onlineDeckSummariesSnapshot, setOnlineDeckSummariesSnapshot] =
    useState<DeckSummary[]>(EMPTY_DECK_SUMMARIES);
  const [onlineDecksSnapshot, setOnlineDecksSnapshot] = useState<Deck[]>([]);
  const [selectedActiveId, setSelectedActiveId] = useState<string | null>(null);
  const [defaultDeckPublic, setDefaultDeckPublicState] = useState(() =>
    readDefaultDeckPublic()
  );
  const anonymousStarterDeck = useMemo(
    () => createEmptyDeck(ANONYMOUS_DECK_ID, ANONYMOUS_DECK_NAME),
    []
  );
  const anonymousStarterSummary = useMemo(
    () => deckToSummary(anonymousStarterDeck),
    [anonymousStarterDeck]
  );
  const deckSummariesResult = useQuery(
    api.decks.listDecks,
    auth.isAuthenticated && !localDecksActive ? {} : "skip"
  );
  const fullDecksResult = useQuery(
    api.decks.listDecksFull,
    auth.isAuthenticated && offlineEnabled && !localDecksActive ? {} : "skip"
  );
  const temporaryDeckResult = useQuery(
    api.decks.getPublicDeck,
    temporaryPublicDeckId ? { publicId: temporaryPublicDeckId } : "skip"
  );
  const offlineDecksLoaded = !deckCacheEnabled || offlineSnapshot !== null;
  const mergeOnlineDecksIntoLocal = offlineActive && auth.isAuthenticated;
  const pendingDeletedDeckIds = useMemo(
    () => offlineSnapshot?.pendingDeletedIds ?? EMPTY_DECK_IDS,
    [offlineSnapshot?.pendingDeletedIds]
  );
  const offlineDeckSummaries = useMemo(
    () =>
      filterDeletedSummaries(
        mergeDeckSummaries(
          mergeOnlineDecksIntoLocal
            ? onlineDeckSummariesSnapshot
            : EMPTY_DECK_SUMMARIES,
          offlineSnapshot?.summaries ?? EMPTY_DECK_SUMMARIES
        ),
        pendingDeletedDeckIds
      ),
    [
      mergeOnlineDecksIntoLocal,
      offlineSnapshot?.summaries,
      onlineDeckSummariesSnapshot,
      pendingDeletedDeckIds,
    ]
  );
  const offlineDecks = useMemo(
    () =>
      filterDeletedDecks(
        mergeDeckLists(
          mergeOnlineDecksIntoLocal ? onlineDecksSnapshot : [],
          offlineSnapshot?.decks ?? []
        ),
        pendingDeletedDeckIds
      ),
    [
      mergeOnlineDecksIntoLocal,
      offlineSnapshot?.decks,
      onlineDecksSnapshot,
      pendingDeletedDeckIds,
    ]
  );
  const onlineDeckSummaries =
    deckSummariesResult ?? onlineDeckSummariesSnapshot;
  const visibleOfflineDeckSummaries = useMemo(() => {
    if (!anonymousDecksActive) return offlineDeckSummaries;
    const preferredId = offlineSnapshot?.activeId;
    const selectedSummary =
      (preferredId
        ? offlineDeckSummaries.find((deck) => deck.id === preferredId)
        : undefined) ??
      offlineDeckSummaries[0] ??
      anonymousStarterSummary;
    return [selectedSummary];
  }, [
    anonymousDecksActive,
    anonymousStarterSummary,
    offlineDeckSummaries,
    offlineSnapshot?.activeId,
  ]);
  const deckSummaries = localDecksActive
    ? visibleOfflineDeckSummaries
    : onlineDeckSummaries;
  const deckSummariesLoaded =
    localDecksActive
      ? offlineDecksLoaded
      : !auth.isAuthenticated || deckSummariesResult !== undefined;
  const savedActiveId = useMemo(
    () =>
      validActiveId(
        deckSummaries,
        selectedActiveId ??
          (localDecksActive ? offlineSnapshot?.activeId ?? null : null)
      ),
    [deckSummaries, localDecksActive, offlineSnapshot?.activeId, selectedActiveId]
  );
  const activeDeckResult = useQuery(
    api.decks.get,
    auth.isAuthenticated && savedActiveId && !localDecksActive
      ? { deckId: savedActiveId }
      : "skip"
  );
  const visibleOfflineDecks = useMemo(() => {
    if (!anonymousDecksActive) return offlineDecks;
    const selectedDeck =
      (savedActiveId
        ? offlineDecks.find((deck) => deck.id === savedActiveId)
        : undefined) ??
      offlineDecks[0] ??
      anonymousStarterDeck;
    return [selectedDeck];
  }, [savedActiveId, anonymousDecksActive, anonymousStarterDeck, offlineDecks]);
  const activeDeckRef = useRef<Deck | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const temporaryDeck = temporaryDeckResult
    ? withDeckCounts(temporaryDeckResult as PublicDeck)
    : null;
  const temporaryDeckOwnedDeckId =
    temporaryDeckResult?.ownedDeckId ??
    (temporaryPublicDeckId
      ? deckSummaries.find(
          (summary) => summary.publicId === temporaryPublicDeckId
        )?.id
      : null) ??
    null;
  const savedActiveDeck = localDecksActive
    ? visibleOfflineDecks.find((deck) => deck.id === savedActiveId) ?? null
    : activeDeckResult;
  const activeDeck = viewingTemporaryDeck ? temporaryDeck : savedActiveDeck;
  const activeId = viewingTemporaryDeck
    ? temporaryDeck?.id ??
      (temporaryPublicDeckId ? `public:${temporaryPublicDeckId}` : null)
    : savedActiveId;
  const allKnownOnlineDecks = useMemo(
    () =>
      mergeDeckLists(
        onlineDecksSnapshot,
        fullDecksResult ?? [],
        activeDeckResult ? [activeDeckResult] : []
      ),
    [activeDeckResult, fullDecksResult, onlineDecksSnapshot]
  );

  const createMutation = useMutation(api.decks.create);
  const renameMutation = useMutation(api.decks.rename);
  const setFormatMutation = useMutation(api.decks.setFormat);
  const deleteMutation = useMutation(api.decks.deleteDeck);
  const setPublicMutation = useMutation(api.decks.setPublic);
  const addCardMutation = useMutation(api.decks.addCard);
  const setQuantityMutation = useMutation(api.decks.setQuantity);
  const moveCardMutation = useMutation(api.decks.moveCard);
  const setCommanderMutation = useMutation(api.decks.setCommander);
  const clearMutation = useMutation(api.decks.clear);
  const importEntriesMutation = useMutation(api.decks.importEntries);
  const replaceDeckMutation = useMutation(api.decks.replaceDeck);
  const patchCardDataMutation = useMutation(api.decks.patchCardData);
  const recordPublicDeckViewMutation = useMutation(
    api.decks.recordPublicDeckView
  );

  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const viewedPublicDeckIdsRef = useRef<Set<string>>(new Set());

  const setDefaultDeckPublic = useCallback((isPublic: boolean) => {
    setDefaultDeckPublicState(isPublic);
    writeDefaultDeckPublic(isPublic);
  }, []);

  useEffect(() => {
    if (!deckCacheEnabled) {
      return;
    }
    let alive = true;
    loadOfflineDeckSnapshot()
      .then((snapshot) => {
        if (alive) setOfflineSnapshot(snapshot);
      })
      .catch(() => {
        if (alive) setOfflineSnapshot(EMPTY_OFFLINE_SNAPSHOT);
      });
    return () => {
      alive = false;
    };
  }, [deckCacheEnabled]);

  useEffect(() => {
    activeDeckRef.current = activeDeck ?? null;
    activeIdRef.current = activeId;
  }, [activeDeck, activeId]);

  useEffect(() => {
    if (!temporaryPublicDeckId || temporaryDeckResult === undefined) return;
    if (temporaryDeckResult === null) return;
    if (viewedPublicDeckIdsRef.current.has(temporaryPublicDeckId)) return;

    viewedPublicDeckIdsRef.current.add(temporaryPublicDeckId);
    void recordPublicDeckViewMutation({ publicId: temporaryPublicDeckId }).catch(
      () => undefined
    );
  }, [
    recordPublicDeckViewMutation,
    temporaryDeckResult,
    temporaryPublicDeckId,
  ]);

  useEffect(() => {
    if (localDecksActive || deckSummariesResult === undefined) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setOnlineDeckSummariesSnapshot(deckSummariesResult);
    });
    return () => {
      cancelled = true;
    };
  }, [deckSummariesResult, localDecksActive]);

  useEffect(() => {
    if (localDecksActive || fullDecksResult === undefined) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setOnlineDecksSnapshot(fullDecksResult);
    });
    return () => {
      cancelled = true;
    };
  }, [fullDecksResult, localDecksActive]);

  useEffect(() => {
    if (localDecksActive || !activeDeckResult) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setOnlineDecksSnapshot((current) =>
          mergeDeckLists(current, [activeDeckResult])
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeDeckResult, localDecksActive]);

  useEffect(() => {
    if (!offlineEnabled || localDecksActive || !deckSummariesLoaded) return;
    let cancelled = false;
    async function saveSnapshot() {
      await saveOfflineDeckSnapshot(
        deckSummaries,
        allKnownOnlineDecks,
        savedActiveId
      );
      const snapshot = await loadOfflineDeckSnapshot();
      if (!cancelled) setOfflineSnapshot(snapshot);
    }
    void saveSnapshot();
    return () => {
      cancelled = true;
    };
  }, [
    allKnownOnlineDecks,
    deckSummaries,
    deckSummariesLoaded,
    offlineEnabled,
    localDecksActive,
    savedActiveId,
  ]);

  useEffect(() => {
    if (!deckCacheEnabled || !localDecksActive) return;
    let cancelled = false;
    loadOfflineDeckSnapshot()
      .then((snapshot) => {
        if (!cancelled) setOfflineSnapshot(snapshot);
      })
      .catch(() => {
        if (!cancelled) setOfflineSnapshot(EMPTY_OFFLINE_SNAPSHOT);
      });
    return () => {
      cancelled = true;
    };
  }, [deckCacheEnabled, localDecksActive]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const temporaryDeckLoaded =
    !viewingTemporaryDeck || temporaryDeckResult !== undefined;
  const hydrated =
    (localDecksActive
      ? offlineDecksLoaded
      : !auth.isLoading &&
        (!auth.isAuthenticated ||
          (deckSummariesLoaded &&
            (!savedActiveId || savedActiveDeck !== undefined)))) &&
    temporaryDeckLoaded;

  const decks = useMemo(
    () =>
      deckSummaries.map((summary) =>
        activeDeck && summary.id === activeDeck.id ? activeDeck : summary
      ),
    [activeDeck, deckSummaries]
  );

  const recordActiveSnapshot = useCallback(() => {
    const deck = activeDeckRef.current;
    const snapshotActiveId = activeIdRef.current;
    if (!deck || !snapshotActiveId) return;

    setPast((p) => {
      const next = [...p, { deck: cloneDeck(deck), activeId: snapshotActiveId }];
      return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
    });
    setFuture([]);
  }, []);

  const showQuantityLimit = useCallback((cardName?: string) => {
    setNotice(
      `${cardName ?? "That card"} is limited to ${CARD_QUANTITY_LIMIT} copies per deck.`
    );
  }, []);

  const showTemporaryDeckNotice = useCallback(() => {
    setNotice("Copy this temporary deck before making changes.");
  }, []);

  const canEditDeck = useCallback(
    (deckId: string) => {
      const isTemporaryId = deckId.startsWith("public:");
      if (!isTemporaryId) return true;
      showTemporaryDeckNotice();
      return false;
    },
    [showTemporaryDeckNotice]
  );

  const reloadOfflineSnapshot = useCallback(async () => {
    const snapshot = await loadOfflineDeckSnapshot();
    setOfflineSnapshot(snapshot);
    onPendingDeckChangesChange?.();
    return snapshot;
  }, [onPendingDeckChangesChange]);

  const writeOfflineDeck = useCallback(
    async (deck: Deck, dirty = true) => {
      await putOfflineDeck(withDeckCounts(deck), dirty);
      await reloadOfflineSnapshot();
    },
    [reloadOfflineSnapshot]
  );

  const updateOfflineDeck = useCallback(
    async (deckId: string, updater: (deck: Deck) => Deck) => {
      const current =
        activeDeckRef.current?.id === deckId
          ? activeDeckRef.current
          : offlineDecks.find((deck) => deck.id === deckId);
      if (!current) return;
      await writeOfflineDeck(updater(cloneDeck(current)));
    },
    [offlineDecks, writeOfflineDeck]
  );

  useEffect(() => {
    if (offlineActive || !online || !auth.isAuthenticated) {
      return;
    }
    let cancelled = false;

    async function syncOfflineDecks() {
      const snapshot = await loadOfflineDeckSnapshot();
      if (
        snapshot.pendingDirtyIds.length === 0 &&
        snapshot.pendingDeletedIds.length === 0
      ) {
        return;
      }

      onOfflineSyncingChange?.(true);
      try {
        for (const deckId of snapshot.pendingDeletedIds) {
          if (cancelled) return;
          await deleteMutation({ deckId });
        }

        const syncedIds: string[] = [];
        for (const deckId of snapshot.pendingDirtyIds) {
          if (cancelled) return;
          const deck = snapshot.decks.find((candidate) => candidate.id === deckId);
          if (!deck) continue;
          await createMutation({
            deckId: deck.id,
            name: deck.name,
            isPublic: deck.isPublic,
          });
          await replaceDeckMutation({ deck });
          syncedIds.push(deck.id);
        }

        await clearSyncedDeckChanges(syncedIds, snapshot.pendingDeletedIds);
        await reloadOfflineSnapshot();
      } finally {
        onOfflineSyncingChange?.(false);
      }
    }

    void syncOfflineDecks().catch(() => {
      onOfflineSyncingChange?.(false);
    });

    return () => {
      cancelled = true;
    };
  }, [
    auth.isAuthenticated,
    createMutation,
    deleteMutation,
    offlineActive,
    onOfflineSyncingChange,
    online,
    reloadOfflineSnapshot,
    replaceDeckMutation,
  ]);

  useEffect(() => {
    if (!offlineEnabled || !online) return;
    const decksToCache = new Map<string, Deck>();
    for (const deck of allKnownOnlineDecks) {
      decksToCache.set(deck.id, deck);
    }
    for (const deck of offlineSnapshot?.decks ?? []) {
      decksToCache.set(deck.id, deck);
    }
    if (activeDeck) decksToCache.set(activeDeck.id, activeDeck);
    if (decksToCache.size === 0) return;
    void cacheNormalArtForDecks(Array.from(decksToCache.values())).catch(
      () => undefined
    );
  }, [
    activeDeck,
    allKnownOnlineDecks,
    offlineEnabled,
    offlineSnapshot?.decks,
    online,
  ]);

  const createDeck = useCallback(
    async (name?: string) => {
      if (anonymousDecksActive) {
        setNotice(
          "You need to log in or create a free account to create another deck."
        );
        return activeIdRef.current;
      }

      if (localDecksActive) {
        const deckId = uid();
        const deck = createEmptyDeck(
          deckId,
          name || "Untitled Deck",
          defaultDeckPublic
        );
        await writeOfflineDeck(deck);
        await setOfflineActiveDeck(deckId);
        setSelectedActiveId(deckId);
        return deckId;
      }

      if (!auth.isAuthenticated) return null;

      const deckId = uid();
      const createdId = await createMutation({
        deckId,
        name: name || "Untitled Deck",
        isPublic: defaultDeckPublic,
      });
      setSelectedActiveId(createdId);
      return createdId;
    },
    [
      anonymousDecksActive,
      auth.isAuthenticated,
      createMutation,
      defaultDeckPublic,
      localDecksActive,
      writeOfflineDeck,
    ]
  );

  const setActive = useCallback(
    (id: string) => {
      setSelectedActiveId(id);
      if (localDecksActive) void setOfflineActiveDeck(id);
    },
    [localDecksActive]
  );

  const renameDeck = useCallback(
    async (id: string, name: string) => {
      if (!canEditDeck(id)) return;

      if (anonymousDecksActive) {
        setNotice(
          "You need to log in or create a free account to name and save this deck."
        );
        return;
      }

      if (localDecksActive) {
        await updateOfflineDeck(id, (deck) => ({
          ...deck,
          name: name.trim() || deck.name,
          updatedAt: Date.now(),
        }));
        return;
      }
      if (!auth.isAuthenticated) return;
      await renameMutation({ deckId: id, name });
    },
    [
      anonymousDecksActive,
      auth.isAuthenticated,
      canEditDeck,
      localDecksActive,
      renameMutation,
      updateOfflineDeck,
    ]
  );

  const setFormat = useCallback(
    async (id: string, format: string) => {
      if (!canEditDeck(id)) return;

      if (localDecksActive) {
        await updateOfflineDeck(id, (deck) => ({
          ...deck,
          format,
          updatedAt: Date.now(),
        }));
        return;
      }
      if (!auth.isAuthenticated) return;
      await setFormatMutation({ deckId: id, format });
    },
    [
      auth.isAuthenticated,
      canEditDeck,
      localDecksActive,
      setFormatMutation,
      updateOfflineDeck,
    ]
  );

  const deleteDeck = useCallback(
    async (id: string) => {
      if (!canEditDeck(id)) return;

      if (anonymousDecksActive) {
        setNotice(
          "You need to log in or create a free account to manage saved decks."
        );
        return;
      }

      if (localDecksActive) {
        await deleteOfflineDeck(id);
        const snapshot = await reloadOfflineSnapshot();
        if (activeIdRef.current === id) {
          const nextId = snapshot.summaries[0]?.id ?? null;
          setSelectedActiveId(nextId);
          await setOfflineActiveDeck(nextId);
        }
        return;
      }
      if (!auth.isAuthenticated) return;
      await deleteMutation({ deckId: id });
      if (activeIdRef.current === id) {
        setSelectedActiveId(null);
      }
    },
    [
      anonymousDecksActive,
      auth.isAuthenticated,
      canEditDeck,
      deleteMutation,
      localDecksActive,
      reloadOfflineSnapshot,
    ]
  );

  const setDeckPublic = useCallback(
    async (id: string, isPublic: boolean) => {
      if (!canEditDeck(id)) return;

      if (anonymousDecksActive) {
        setNotice(
          "You need to log in or create a free account to publish this deck."
        );
        return;
      }

      if (localDecksActive) {
        setNotice("Publishing is available when cloud sync is online.");
        return;
      }

      if (!auth.isAuthenticated) return;
      await setPublicMutation({ deckId: id, isPublic });
    },
    [
      anonymousDecksActive,
      auth.isAuthenticated,
      canEditDeck,
      localDecksActive,
      setPublicMutation,
    ]
  );

  const addCard = useCallback(
    async (deckId: string, card: ScryfallCard, quantity = 1) => {
      if (!canEditDeck(deckId)) return;

      const deck = activeDeckRef.current;
      const current = deck?.entries.find((entry) => entry.cardId === card.id);
      const requestedQuantity = Math.max(1, Math.floor(quantity));
      const available = CARD_QUANTITY_LIMIT - (current?.quantity ?? 0);

      if (available <= 0) {
        showQuantityLimit(card.name);
        return;
      }

      const safeQuantity = Math.min(requestedQuantity, available);
      if (safeQuantity < requestedQuantity) {
        showQuantityLimit(card.name);
      }

      recordActiveSnapshot();
      if (localDecksActive) {
        await updateOfflineDeck(deckId, (currentDeck) => {
          const entries = currentDeck.entries.map((entry) => ({ ...entry }));
          const existing = entries.find((entry) => entry.cardId === card.id);
          if (existing) {
            existing.quantity = Math.min(
              CARD_QUANTITY_LIMIT,
              existing.quantity + safeQuantity
            );
          } else {
            entries.push(cardToEntry(card, safeQuantity));
          }
          return {
            ...currentDeck,
            entries,
            updatedAt: Date.now(),
          };
        });
        return;
      }

      if (!auth.isAuthenticated) return;
      await addCardMutation({
        deckId,
        card: cardToEntry(card, safeQuantity),
        quantity: safeQuantity,
      });
    },
    [
      addCardMutation,
      auth.isAuthenticated,
      canEditDeck,
      localDecksActive,
      recordActiveSnapshot,
      showQuantityLimit,
      updateOfflineDeck,
    ]
  );

  const setQuantity = useCallback(
    async (
      deckId: string,
      cardId: string,
      quantity: number,
      zone: DeckZone = "main"
    ) => {
      if (!canEditDeck(deckId)) return;

      const activeDeck = activeDeckRef.current;
      const zoneEntries = activeDeck
        ? deckEntriesForZone(activeDeck, zone)
        : undefined;
      const current = zoneEntries?.find((entry) => entry.cardId === cardId);
      const safeQuantity =
        quantity <= 0
          ? quantity
          : Math.min(Math.floor(quantity), CARD_QUANTITY_LIMIT);

      if (quantity > CARD_QUANTITY_LIMIT) {
        showQuantityLimit(current?.name);
      }
      if (current && current.quantity === safeQuantity) return;

      recordActiveSnapshot();
      if (localDecksActive) {
        await updateOfflineDeck(deckId, (deck) => ({
          ...deck,
          [deckZoneKey(zone)]:
            safeQuantity <= 0
              ? deckEntriesForZone(deck, zone).filter(
                  (entry) => entry.cardId !== cardId
                )
              : deckEntriesForZone(deck, zone).map((entry) =>
                  entry.cardId === cardId
                    ? {
                        ...entry,
                        quantity: safeQuantity,
                        isCommander:
                          zone === "main" ? entry.isCommander : undefined,
                      }
                    : entry
                ),
          updatedAt: Date.now(),
        }));
        return;
      }

      if (!auth.isAuthenticated) return;
      await setQuantityMutation({
        deckId,
        cardId,
        quantity: safeQuantity,
        zone,
      });
    },
    [
      auth.isAuthenticated,
      canEditDeck,
      localDecksActive,
      recordActiveSnapshot,
      setQuantityMutation,
      showQuantityLimit,
      updateOfflineDeck,
    ]
  );

  const moveCard = useCallback(
    async (
      deckId: string,
      cardId: string,
      from: DeckZone,
      to: DeckZone
    ) => {
      if (!canEditDeck(deckId)) return;

      const deck = activeDeckRef.current;
      if (!deck || from === to) return;
      const moving = deckEntriesForZone(deck, from).find(
        (entry) => entry.cardId === cardId
      );
      if (!moving) return;

      recordActiveSnapshot();
      if (localDecksActive) {
        await updateOfflineDeck(deckId, (currentDeck) =>
          moveEntryBetweenZones(currentDeck, cardId, from, to)
        );
        return;
      }

      if (!auth.isAuthenticated) return;
      await moveCardMutation({ deckId, cardId, from, to });
    },
    [
      auth.isAuthenticated,
      canEditDeck,
      moveCardMutation,
      localDecksActive,
      recordActiveSnapshot,
      updateOfflineDeck,
    ]
  );

  const setCommander = useCallback(
    async (deckId: string, cardId: string | null) => {
      if (!canEditDeck(deckId)) return;

      const currentCommander =
        activeDeckRef.current?.entries.find((entry) => entry.isCommander)
          ?.cardId ?? null;
      if (currentCommander === cardId) return;

      recordActiveSnapshot();
      if (localDecksActive) {
        await updateOfflineDeck(deckId, (deck) => ({
          ...deck,
          entries: deck.entries.map((entry) => ({
            ...entry,
            isCommander: cardId !== null ? entry.cardId === cardId : undefined,
          })),
          updatedAt: Date.now(),
        }));
        return;
      }

      if (!auth.isAuthenticated) return;
      await setCommanderMutation({
        deckId,
        cardId: cardId ?? undefined,
      });
    },
    [
      auth.isAuthenticated,
      canEditDeck,
      localDecksActive,
      recordActiveSnapshot,
      setCommanderMutation,
      updateOfflineDeck,
    ]
  );

  const clearDeck = useCallback(
    async (deckId: string) => {
      if (!canEditDeck(deckId)) return;

      recordActiveSnapshot();
      if (localDecksActive) {
        await updateOfflineDeck(deckId, (deck) => ({
          ...deck,
          entries: [],
          sideboard: [],
          maybeboard: [],
          updatedAt: Date.now(),
        }));
        return;
      }

      if (!auth.isAuthenticated) return;
      await clearMutation({ deckId });
    },
    [
      auth.isAuthenticated,
      canEditDeck,
      clearMutation,
      localDecksActive,
      recordActiveSnapshot,
      updateOfflineDeck,
    ]
  );

  const importEntries = useCallback(
    async (
      deckId: string,
      incoming: DeckEntry[],
      sideboard: DeckEntry[],
      maybeboard: DeckEntry[],
      mode: "merge" | "replace"
    ) => {
      if (!canEditDeck(deckId)) return;

      if (
        incomingWouldExceedLimit(
          activeDeckRef.current,
          incoming,
          sideboard,
          maybeboard,
          mode
        )
      ) {
        showQuantityLimit("One or more cards");
      }
      recordActiveSnapshot();
      if (localDecksActive) {
        await updateOfflineDeck(deckId, (deck) => ({
          ...deck,
          entries:
            mode === "replace"
              ? normalizeEntries(incoming)
              : mergeEntries(deck.entries, incoming),
          sideboard:
            mode === "replace"
              ? normalizeEntries(sideboard, false)
              : mergeEntries(deck.sideboard, sideboard, false),
          maybeboard:
            mode === "replace"
              ? normalizeEntries(maybeboard, false)
              : mergeEntries(deck.maybeboard, maybeboard, false),
          updatedAt: Date.now(),
        }));
        return;
      }

      if (!auth.isAuthenticated) return;
      await importEntriesMutation({
        deckId,
        entries: incoming,
        sideboard,
        maybeboard,
        mode,
      });
    },
    [
      auth.isAuthenticated,
      canEditDeck,
      importEntriesMutation,
      localDecksActive,
      recordActiveSnapshot,
      showQuantityLimit,
      updateOfflineDeck,
    ]
  );

  const refreshCardData = useCallback(
    async (deckId: string) => {
      if (!canEditDeck(deckId)) return;

      const deck = activeDeckRef.current;
      if (!deck || deck.id !== deckId) return;

      const needIds = [
        ...deck.entries,
        ...(deck.sideboard ?? []),
        ...(deck.maybeboard ?? []),
      ]
        .filter(
          (entry) => entry.priceUsd === undefined || entry.rarity === undefined
        )
        .map((entry) => entry.cardId);
      if (needIds.length === 0) return;

      if (localDecksActive) {
        try {
          const cards = offlineActive
            ? await import("./offline").then(({ getOfflineCardsByIdentifiers }) =>
                getOfflineCardsByIdentifiers(needIds.map((id) => ({ id })))
              )
            : await getCardsByIdentifiers(needIds.map((id) => ({ id })));
          if (cards.length === 0) return;
          const cardsById = new Map(cards.map((card) => [card.id, card]));
          const hydrateEntry = (entry: DeckEntry) => {
            const card = cardsById.get(entry.cardId);
            if (!card) return entry;
            const usd = card.prices?.usd;
            const priceUsd = usd != null && usd !== "" ? Number(usd) : undefined;
            return {
              ...entry,
              rarity: entry.rarity ?? card.rarity,
              priceUsd:
                entry.priceUsd ??
                (Number.isFinite(priceUsd) ? priceUsd : undefined),
            };
          };
          await updateOfflineDeck(deckId, (currentDeck) => ({
            ...currentDeck,
            entries: currentDeck.entries.map(hydrateEntry),
            sideboard: deckEntriesForZone(currentDeck, "sideboard").map(
              hydrateEntry
            ),
            maybeboard: deckEntriesForZone(currentDeck, "maybeboard").map(
              hydrateEntry
            ),
            updatedAt: Date.now(),
          }));
        } catch {
          // Network or offline-cache errors leave metadata unknown for now.
        }
        return;
      }

      if (!auth.isAuthenticated) return;
      try {
        const cards = await getCardsByIdentifiers(needIds.map((id) => ({ id })));
        if (cards.length === 0) return;

        const cardData = cards
          .map((card) => {
            const raw = card.prices?.usd;
            const priceUsd = raw != null && raw !== "" ? Number(raw) : undefined;
            return {
              cardId: card.id,
              priceUsd: Number.isFinite(priceUsd) ? priceUsd : undefined,
              rarity: card.rarity,
            };
          })
          .filter(
            (data) => data.priceUsd !== undefined || data.rarity !== undefined
          );

        if (cardData.length > 0) {
          await patchCardDataMutation({ deckId, cards: cardData });
        }
      } catch {
        // Network errors leave card metadata unknown until a later refresh.
      }
    },
    [
      auth.isAuthenticated,
      canEditDeck,
      localDecksActive,
      offlineActive,
      patchCardDataMutation,
      updateOfflineDeck,
    ]
  );

  const copyTemporaryDeck = useCallback(async () => {
    const source = activeDeckRef.current;
    if (!source || !source.id.startsWith("public:")) {
      return null;
    }

    if (anonymousDecksActive) {
      setNotice(
        "You need to log in or create a free account to copy this deck."
      );
      return null;
    }

    const deckId = uid();
    const now = Date.now();
    const name = `${source.name} Copy`;
    const copied = withDeckCounts({
      ...cloneDeck(source),
      id: deckId,
      publicId: undefined,
      isPublic: defaultDeckPublic,
      name,
      createdAt: now,
      updatedAt: now,
    });

    if (localDecksActive) {
      await writeOfflineDeck(copied);
      await setOfflineActiveDeck(deckId);
      setSelectedActiveId(deckId);
      setNotice(`Copied ${source.name}.`);
      return deckId;
    }

    if (!auth.isAuthenticated) return null;
    await createMutation({
      deckId,
      name,
      isPublic: defaultDeckPublic,
    });
    await replaceDeckMutation({ deck: copied });
    setSelectedActiveId(deckId);
    setNotice(`Copied ${source.name}.`);
    return deckId;
  }, [
    anonymousDecksActive,
    auth.isAuthenticated,
    createMutation,
    defaultDeckPublic,
    localDecksActive,
    replaceDeckMutation,
    writeOfflineDeck,
  ]);

  const undo = useCallback(async () => {
    const prev = past[past.length - 1];
    const current = activeDeckRef.current;
    const currentActiveId = activeIdRef.current;
    if (!prev || !current || !currentActiveId) return;
    if (!localDecksActive && !auth.isAuthenticated) return;

    setPast((p) => p.slice(0, -1));
    setFuture((f) =>
      [{ deck: cloneDeck(current), activeId: currentActiveId }, ...f].slice(
        0,
        MAX_HISTORY
      )
    );
    if (localDecksActive) await writeOfflineDeck(prev.deck);
    else await replaceDeckMutation({ deck: prev.deck });
    setSelectedActiveId(prev.activeId);
  }, [
    auth.isAuthenticated,
    localDecksActive,
    past,
    replaceDeckMutation,
    writeOfflineDeck,
  ]);

  const redo = useCallback(async () => {
    const next = future[0];
    const current = activeDeckRef.current;
    const currentActiveId = activeIdRef.current;
    if (!next || !current || !currentActiveId) return;
    if (!localDecksActive && !auth.isAuthenticated) return;

    setFuture((f) => f.slice(1));
    setPast((p) =>
      [...p, { deck: cloneDeck(current), activeId: currentActiveId }].slice(
        -MAX_HISTORY
      )
    );
    if (localDecksActive) await writeOfflineDeck(next.deck);
    else await replaceDeckMutation({ deck: next.deck });
    setSelectedActiveId(next.activeId);
  }, [
    auth.isAuthenticated,
    future,
    localDecksActive,
    replaceDeckMutation,
    writeOfflineDeck,
  ]);

  const activeDeckIsTemporary = activeDeck?.id.startsWith("public:") === true;

  return {
    hydrated,
    isAuthenticated: auth.isAuthenticated || localDecksActive,
    isSignedIn: auth.isAuthenticated,
    isLocal: localDecksActive,
    isAnonymous: anonymousDecksActive,
    canCreateDeck: auth.isAuthenticated || offlineActive,
    canRenameDeck: !activeDeckIsTemporary && (auth.isAuthenticated || offlineActive),
    canDeleteDeck: auth.isAuthenticated || offlineActive,
    canToggleDeckPublic:
      !activeDeckIsTemporary && auth.isAuthenticated && !localDecksActive,
    canEditActiveDeck: !activeDeckIsTemporary,
    canCopyTemporaryDeck: activeDeckIsTemporary,
    activeDeckIsTemporary,
    temporaryDeckOwnedDeckId,
    temporaryDeckNotFound:
      viewingTemporaryDeck && temporaryDeckResult === null,
    isLoading: auth.isLoading,
    defaultDeckPublic,
    setDefaultDeckPublic,
    notice,
    showNotice: setNotice,
    clearNotice: () => setNotice(null),
    decks,
    activeDeck: activeDeck ?? null,
    activeId,
    setActive,
    createDeck,
    renameDeck,
    setFormat,
    deleteDeck,
    setDeckPublic,
    addCard,
    setQuantity,
    moveCard,
    setCommander,
    clearDeck,
    importEntries,
    refreshCardData,
    copyTemporaryDeck,
    undo,
    redo,
    canUndo: !activeDeckIsTemporary && past.length > 0,
    canRedo: !activeDeckIsTemporary && future.length > 0,
  };
}

export function useDeck(deckId: string | null) {
  const auth = useConvexAuth();
  const localDecksActive = !auth.isLoading && !auth.isAuthenticated;
  const [offlineSnapshot, setOfflineSnapshot] =
    useState<OfflineDeckSnapshot | null>(null);
  const deck = useQuery(
    api.decks.get,
    auth.isAuthenticated && deckId ? { deckId } : "skip"
  );
  const localDeck =
    localDecksActive && deckId
      ? offlineSnapshot?.decks.find((candidate) => candidate.id === deckId) ??
        null
      : null;

  useEffect(() => {
    if (!localDecksActive || !deckId) return;
    let cancelled = false;
    loadOfflineDeckSnapshot()
      .then((snapshot) => {
        if (!cancelled) setOfflineSnapshot(snapshot);
      })
      .catch(() => {
        if (!cancelled) setOfflineSnapshot(EMPTY_OFFLINE_SNAPSHOT);
      });
    return () => {
      cancelled = true;
    };
  }, [deckId, localDecksActive]);

  return {
    hydrated:
      !auth.isLoading &&
      (!deckId ||
        (auth.isAuthenticated
          ? deck !== undefined
          : offlineSnapshot !== null)),
    isAuthenticated: auth.isAuthenticated || localDecksActive,
    isSignedIn: auth.isAuthenticated,
    deck: auth.isAuthenticated ? deck ?? null : localDeck,
  };
}

function validActiveId(
  decks: DeckSummary[],
  current: string | null
): string | null {
  if (current && decks.some((deck) => deck.id === current)) return current;
  return decks[0]?.id ?? null;
}

function mergeDeckSummaries(...lists: DeckSummary[][]): DeckSummary[] {
  const byId = new Map<string, DeckSummary>();
  for (const list of lists) {
    for (const deck of list) {
      byId.set(deck.id, deck);
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt);
}

function mergeDeckLists(...lists: Deck[][]): Deck[] {
  const byId = new Map<string, Deck>();
  for (const list of lists) {
    for (const deck of list) {
      byId.set(deck.id, withDeckCounts(deck));
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt);
}

function filterDeletedSummaries(
  decks: DeckSummary[],
  deletedIds: string[]
): DeckSummary[] {
  if (deletedIds.length === 0) return decks;
  const deleted = new Set(deletedIds);
  return decks.filter((deck) => !deleted.has(deck.id));
}

function filterDeletedDecks(decks: Deck[], deletedIds: string[]): Deck[] {
  if (deletedIds.length === 0) return decks;
  const deleted = new Set(deletedIds);
  return decks.filter((deck) => !deleted.has(deck.id));
}

function incomingWouldExceedLimit(
  deck: Deck | null,
  incoming: DeckEntry[],
  sideboard: DeckEntry[],
  maybeboard: DeckEntry[],
  mode: "merge" | "replace"
) {
  return (
    entriesWouldExceedLimit(deck?.entries ?? [], incoming, mode) ||
    entriesWouldExceedLimit(deck?.sideboard ?? [], sideboard, mode) ||
    entriesWouldExceedLimit(deck?.maybeboard ?? [], maybeboard, mode)
  );
}

function entriesWouldExceedLimit(
  current: DeckEntry[],
  incoming: DeckEntry[],
  mode: "merge" | "replace"
) {
  const quantities = new Map<string, number>();

  if (mode === "merge") {
    for (const entry of current) {
      quantities.set(entry.cardId, entry.quantity);
    }
  }

  for (const entry of incoming) {
    const next = (quantities.get(entry.cardId) ?? 0) + entry.quantity;
    if (next > CARD_QUANTITY_LIMIT) return true;
    quantities.set(entry.cardId, next);
  }

  return false;
}

function normalizeEntries(
  entries: DeckEntry[],
  allowCommander = true
): DeckEntry[] {
  const byId = new Map<string, DeckEntry>();
  for (const entry of entries) {
    const existing = byId.get(entry.cardId);
    if (existing) {
      existing.quantity = Math.min(
        CARD_QUANTITY_LIMIT,
        existing.quantity + entry.quantity
      );
      if (allowCommander) existing.isCommander ||= entry.isCommander;
    } else {
      byId.set(entry.cardId, {
        ...entry,
        isCommander: allowCommander ? entry.isCommander : undefined,
      });
    }
  }
  return Array.from(byId.values());
}

function mergeEntries(
  current: DeckEntry[],
  incoming: DeckEntry[],
  allowCommander = true
): DeckEntry[] {
  return normalizeEntries([...current, ...incoming], allowCommander);
}

function deckEntriesForZone(deck: Deck, zone: DeckZone): DeckEntry[] {
  return deck[deckZoneKey(zone)] ?? [];
}

function deckZoneKey(zone: DeckZone): "entries" | "sideboard" | "maybeboard" {
  if (zone === "sideboard") return "sideboard";
  if (zone === "maybeboard") return "maybeboard";
  return "entries";
}

function moveEntryBetweenZones(
  deck: Deck,
  cardId: string,
  from: DeckZone,
  to: DeckZone
): Deck {
  if (from === to) return deck;
  const fromEntries = deckEntriesForZone(deck, from);
  const toEntries = deckEntriesForZone(deck, to);
  const moving = fromEntries.find((entry) => entry.cardId === cardId);
  if (!moving) return deck;

  const nextFrom = fromEntries.filter((entry) => entry.cardId !== cardId);
  const movedEntry: DeckEntry = {
    ...moving,
    isCommander: undefined,
  };
  const nextTo = mergeEntries(toEntries, [movedEntry], to === "main");

  return withDeckCounts({
    ...deck,
    [deckZoneKey(from)]: nextFrom,
    [deckZoneKey(to)]: nextTo,
    updatedAt: Date.now(),
  });
}
