"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Deck, DeckEntry, DeckSummary, ScryfallCard } from "./types";
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
type DeckZone = "main" | "sideboard";

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

type UseDecksOptions = {
  offlineEnabled?: boolean;
  offlineActive?: boolean;
  online?: boolean;
  onOfflineSyncingChange?: (syncing: boolean) => void;
  onPendingDeckChangesChange?: () => void;
};

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function cloneDeck(deck: Deck): Deck {
  return withDeckCounts({
    ...deck,
    entries: cloneEntries(deck.entries),
    sideboard: cloneEntries(deck.sideboard),
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
  return {
    ...deck,
    entries,
    sideboard,
    cardCount: countEntries(entries),
    sideboardCount: countEntries(sideboard),
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
  const online = options.online !== false;
  const onOfflineSyncingChange = options.onOfflineSyncingChange;
  const onPendingDeckChangesChange = options.onPendingDeckChangesChange;
  const [offlineSnapshot, setOfflineSnapshot] =
    useState<OfflineDeckSnapshot | null>(null);
  const [onlineDeckSummariesSnapshot, setOnlineDeckSummariesSnapshot] =
    useState<DeckSummary[]>(EMPTY_DECK_SUMMARIES);
  const [onlineDecksSnapshot, setOnlineDecksSnapshot] = useState<Deck[]>([]);
  const deckSummariesResult = useQuery(
    api.decks.listDecks,
    auth.isAuthenticated && !offlineActive ? {} : "skip"
  );
  const fullDecksResult = useQuery(
    api.decks.listDecksFull,
    auth.isAuthenticated && offlineEnabled && !offlineActive ? {} : "skip"
  );
  const offlineDecksLoaded = !offlineEnabled || offlineSnapshot !== null;
  const pendingDeletedDeckIds = useMemo(
    () => offlineSnapshot?.pendingDeletedIds ?? EMPTY_DECK_IDS,
    [offlineSnapshot?.pendingDeletedIds]
  );
  const offlineDeckSummaries = useMemo(
    () =>
      filterDeletedSummaries(
        mergeDeckSummaries(
          onlineDeckSummariesSnapshot,
          offlineSnapshot?.summaries ?? EMPTY_DECK_SUMMARIES
        ),
        pendingDeletedDeckIds
      ),
    [
      offlineSnapshot?.summaries,
      onlineDeckSummariesSnapshot,
      pendingDeletedDeckIds,
    ]
  );
  const offlineDecks = useMemo(
    () =>
      filterDeletedDecks(
        mergeDeckLists(onlineDecksSnapshot, offlineSnapshot?.decks ?? []),
        pendingDeletedDeckIds
      ),
    [offlineSnapshot?.decks, onlineDecksSnapshot, pendingDeletedDeckIds]
  );
  const onlineDeckSummaries =
    deckSummariesResult ?? onlineDeckSummariesSnapshot;
  const deckSummaries = offlineActive
    ? offlineDeckSummaries
    : onlineDeckSummaries;
  const deckSummariesLoaded =
    offlineActive || !auth.isAuthenticated || deckSummariesResult !== undefined;
  const [selectedActiveId, setSelectedActiveId] = useState<string | null>(null);
  const activeId = useMemo(
    () =>
      validActiveId(
        deckSummaries,
        selectedActiveId ?? (offlineActive ? offlineSnapshot?.activeId ?? null : null)
      ),
    [deckSummaries, offlineActive, offlineSnapshot?.activeId, selectedActiveId]
  );
  const activeDeckResult = useQuery(
    api.decks.get,
    auth.isAuthenticated && activeId && !offlineActive
      ? { deckId: activeId }
      : "skip"
  );
  const activeDeckRef = useRef<Deck | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const activeDeck = offlineActive
    ? offlineDecks.find((deck) => deck.id === activeId) ?? null
    : activeDeckResult;
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
  const addCardMutation = useMutation(api.decks.addCard);
  const setQuantityMutation = useMutation(api.decks.setQuantity);
  const moveCardMutation = useMutation(api.decks.moveCard);
  const setCommanderMutation = useMutation(api.decks.setCommander);
  const clearMutation = useMutation(api.decks.clear);
  const importEntriesMutation = useMutation(api.decks.importEntries);
  const replaceDeckMutation = useMutation(api.decks.replaceDeck);
  const patchCardDataMutation = useMutation(api.decks.patchCardData);

  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!offlineEnabled) {
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
  }, [offlineEnabled]);

  useEffect(() => {
    activeDeckRef.current = activeDeck ?? null;
    activeIdRef.current = activeId;
  }, [activeDeck, activeId]);

  useEffect(() => {
    if (offlineActive || deckSummariesResult === undefined) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setOnlineDeckSummariesSnapshot(deckSummariesResult);
    });
    return () => {
      cancelled = true;
    };
  }, [deckSummariesResult, offlineActive]);

  useEffect(() => {
    if (offlineActive || fullDecksResult === undefined) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setOnlineDecksSnapshot(fullDecksResult);
    });
    return () => {
      cancelled = true;
    };
  }, [fullDecksResult, offlineActive]);

  useEffect(() => {
    if (offlineActive || !activeDeckResult) return;
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
  }, [activeDeckResult, offlineActive]);

  useEffect(() => {
    if (!offlineEnabled || offlineActive || !deckSummariesLoaded) return;
    let cancelled = false;
    async function saveSnapshot() {
      await saveOfflineDeckSnapshot(deckSummaries, allKnownOnlineDecks, activeId);
      const snapshot = await loadOfflineDeckSnapshot();
      if (!cancelled) setOfflineSnapshot(snapshot);
    }
    void saveSnapshot();
    return () => {
      cancelled = true;
    };
  }, [
    activeId,
    allKnownOnlineDecks,
    deckSummaries,
    deckSummariesLoaded,
    offlineActive,
    offlineEnabled,
  ]);

  useEffect(() => {
    if (!offlineEnabled || !offlineActive) return;
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
  }, [offlineActive, offlineEnabled]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const hydrated =
    offlineActive
      ? offlineDecksLoaded
      : !auth.isLoading &&
        (!auth.isAuthenticated ||
          (deckSummariesLoaded && (!activeId || activeDeck !== undefined)));

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
    if (!offlineEnabled || offlineActive || !online || !auth.isAuthenticated) {
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
          await createMutation({ deckId: deck.id, name: deck.name });
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
    offlineEnabled,
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
      if (offlineActive) {
        const now = Date.now();
        const deckId = uid();
        const deck: Deck = {
          id: deckId,
          name: name || "Untitled Deck",
          format: "commander",
          cardCount: 0,
          sideboardCount: 0,
          createdAt: now,
          updatedAt: now,
          entries: [],
          sideboard: [],
        };
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
      });
      setSelectedActiveId(createdId);
      return createdId;
    },
    [auth.isAuthenticated, createMutation, offlineActive, writeOfflineDeck]
  );

  const setActive = useCallback(
    (id: string) => {
      setSelectedActiveId(id);
      if (offlineActive) void setOfflineActiveDeck(id);
    },
    [offlineActive]
  );

  const renameDeck = useCallback(
    async (id: string, name: string) => {
      if (offlineActive) {
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
    [auth.isAuthenticated, offlineActive, renameMutation, updateOfflineDeck]
  );

  const setFormat = useCallback(
    async (id: string, format: string) => {
      if (offlineActive) {
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
    [auth.isAuthenticated, offlineActive, setFormatMutation, updateOfflineDeck]
  );

  const deleteDeck = useCallback(
    async (id: string) => {
      if (offlineActive) {
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
    [auth.isAuthenticated, deleteMutation, offlineActive, reloadOfflineSnapshot]
  );

  const addCard = useCallback(
    async (deckId: string, card: ScryfallCard, quantity = 1) => {
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
      if (offlineActive) {
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
      offlineActive,
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
      const activeDeck = activeDeckRef.current;
      const zoneEntries =
        zone === "sideboard" ? activeDeck?.sideboard : activeDeck?.entries;
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
      if (offlineActive) {
        await updateOfflineDeck(deckId, (deck) => ({
          ...deck,
          [zone === "sideboard" ? "sideboard" : "entries"]:
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
      offlineActive,
      recordActiveSnapshot,
      setQuantityMutation,
      showQuantityLimit,
      updateOfflineDeck,
    ]
  );

  const moveCard = useCallback(
    async (deckId: string, cardId: string, to: DeckZone) => {
      const deck = activeDeckRef.current;
      if (!deck) return;
      const from: DeckZone = to === "sideboard" ? "main" : "sideboard";
      const moving = deckEntriesForZone(deck, from).find(
        (entry) => entry.cardId === cardId
      );
      if (!moving) return;

      recordActiveSnapshot();
      if (offlineActive) {
        await updateOfflineDeck(deckId, (currentDeck) =>
          moveEntryBetweenZones(currentDeck, cardId, to)
        );
        return;
      }

      if (!auth.isAuthenticated) return;
      await moveCardMutation({ deckId, cardId, to });
    },
    [
      auth.isAuthenticated,
      moveCardMutation,
      offlineActive,
      recordActiveSnapshot,
      updateOfflineDeck,
    ]
  );

  const setCommander = useCallback(
    async (deckId: string, cardId: string | null) => {
      const currentCommander =
        activeDeckRef.current?.entries.find((entry) => entry.isCommander)
          ?.cardId ?? null;
      if (currentCommander === cardId) return;

      recordActiveSnapshot();
      if (offlineActive) {
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
      offlineActive,
      recordActiveSnapshot,
      setCommanderMutation,
      updateOfflineDeck,
    ]
  );

  const clearDeck = useCallback(
    async (deckId: string) => {
      recordActiveSnapshot();
      if (offlineActive) {
        await updateOfflineDeck(deckId, (deck) => ({
          ...deck,
          entries: [],
          sideboard: [],
          updatedAt: Date.now(),
        }));
        return;
      }

      if (!auth.isAuthenticated) return;
      await clearMutation({ deckId });
    },
    [
      auth.isAuthenticated,
      clearMutation,
      offlineActive,
      recordActiveSnapshot,
      updateOfflineDeck,
    ]
  );

  const importEntries = useCallback(
    async (
      deckId: string,
      incoming: DeckEntry[],
      sideboard: DeckEntry[],
      mode: "merge" | "replace"
    ) => {
      if (
        incomingWouldExceedLimit(
          activeDeckRef.current,
          incoming,
          sideboard,
          mode
        )
      ) {
        showQuantityLimit("One or more cards");
      }
      recordActiveSnapshot();
      if (offlineActive) {
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
          updatedAt: Date.now(),
        }));
        return;
      }

      if (!auth.isAuthenticated) return;
      await importEntriesMutation({
        deckId,
        entries: incoming,
        sideboard,
        mode,
      });
    },
    [
      auth.isAuthenticated,
      importEntriesMutation,
      offlineActive,
      recordActiveSnapshot,
      showQuantityLimit,
      updateOfflineDeck,
    ]
  );

  const refreshCardData = useCallback(
    async (deckId: string) => {
      const deck = activeDeckRef.current;
      if (!deck || deck.id !== deckId) return;

      const needIds = [...deck.entries, ...(deck.sideboard ?? [])]
        .filter(
          (entry) => entry.priceUsd === undefined || entry.rarity === undefined
        )
        .map((entry) => entry.cardId);
      if (needIds.length === 0) return;

      if (offlineActive) {
        const { getOfflineCardsByIdentifiers } = await import("./offline");
        const cards = await getOfflineCardsByIdentifiers(
          needIds.map((id) => ({ id }))
        );
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
          updatedAt: Date.now(),
        }));
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
    [auth.isAuthenticated, offlineActive, patchCardDataMutation, updateOfflineDeck]
  );

  const undo = useCallback(async () => {
    const prev = past[past.length - 1];
    const current = activeDeckRef.current;
    const currentActiveId = activeIdRef.current;
    if (!prev || !current || !currentActiveId) return;
    if (!offlineActive && !auth.isAuthenticated) return;

    setPast((p) => p.slice(0, -1));
    setFuture((f) =>
      [{ deck: cloneDeck(current), activeId: currentActiveId }, ...f].slice(
        0,
        MAX_HISTORY
      )
    );
    if (offlineActive) await writeOfflineDeck(prev.deck);
    else await replaceDeckMutation({ deck: prev.deck });
    setSelectedActiveId(prev.activeId);
  }, [
    auth.isAuthenticated,
    offlineActive,
    past,
    replaceDeckMutation,
    writeOfflineDeck,
  ]);

  const redo = useCallback(async () => {
    const next = future[0];
    const current = activeDeckRef.current;
    const currentActiveId = activeIdRef.current;
    if (!next || !current || !currentActiveId) return;
    if (!offlineActive && !auth.isAuthenticated) return;

    setFuture((f) => f.slice(1));
    setPast((p) =>
      [...p, { deck: cloneDeck(current), activeId: currentActiveId }].slice(
        -MAX_HISTORY
      )
    );
    if (offlineActive) await writeOfflineDeck(next.deck);
    else await replaceDeckMutation({ deck: next.deck });
    setSelectedActiveId(next.activeId);
  }, [
    auth.isAuthenticated,
    future,
    offlineActive,
    replaceDeckMutation,
    writeOfflineDeck,
  ]);

  return {
    hydrated,
    isAuthenticated: auth.isAuthenticated || offlineActive,
    isLoading: auth.isLoading,
    notice,
    clearNotice: () => setNotice(null),
    decks,
    activeDeck: activeDeck ?? null,
    activeId,
    setActive,
    createDeck,
    renameDeck,
    setFormat,
    deleteDeck,
    addCard,
    setQuantity,
    moveCard,
    setCommander,
    clearDeck,
    importEntries,
    refreshCardData,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}

export function useDeck(deckId: string | null) {
  const auth = useConvexAuth();
  const deck = useQuery(
    api.decks.get,
    auth.isAuthenticated && deckId ? { deckId } : "skip"
  );

  return {
    hydrated:
      !auth.isLoading &&
      (!auth.isAuthenticated || !deckId || deck !== undefined),
    isAuthenticated: auth.isAuthenticated,
    deck: deck ?? null,
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
  mode: "merge" | "replace"
) {
  return (
    entriesWouldExceedLimit(deck?.entries ?? [], incoming, mode) ||
    entriesWouldExceedLimit(deck?.sideboard ?? [], sideboard, mode)
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
  return zone === "sideboard" ? deck.sideboard ?? [] : deck.entries ?? [];
}

function moveEntryBetweenZones(deck: Deck, cardId: string, to: DeckZone): Deck {
  const from: DeckZone = to === "sideboard" ? "main" : "sideboard";
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
    entries: to === "main" ? nextTo : nextFrom,
    sideboard: to === "sideboard" ? nextTo : nextFrom,
    updatedAt: Date.now(),
  });
}
