"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Deck, DeckEntry, DeckSummary, ScryfallCard } from "./types";
import { getCardImage, getCardsByIdentifiers } from "./scryfall";

type Snapshot = { deck: Deck; activeId: string };

const CARD_QUANTITY_LIMIT = 255;
const MAX_HISTORY = 100;

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function cloneDeck(deck: Deck): Deck {
  return { ...deck, entries: deck.entries.map((entry) => ({ ...entry })) };
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
    set: card.set,
    collectorNumber: card.collector_number,
    priceUsd: Number.isFinite(priceUsd) ? priceUsd : undefined,
  };
}

export function useDecks() {
  const auth = useConvexAuth();
  const deckSummariesResult = useQuery(
    api.decks.listDecks,
    auth.isAuthenticated ? {} : "skip"
  );
  const deckSummaries = deckSummariesResult ?? [];
  const deckSummariesLoaded =
    !auth.isAuthenticated || deckSummariesResult !== undefined;
  const [selectedActiveId, setSelectedActiveId] = useState<string | null>(null);
  const activeId = useMemo(
    () => validActiveId(deckSummaries, selectedActiveId),
    [deckSummaries, selectedActiveId]
  );
  const activeDeck = useQuery(
    api.decks.get,
    auth.isAuthenticated && activeId ? { deckId: activeId } : "skip"
  );

  const createMutation = useMutation(api.decks.create);
  const renameMutation = useMutation(api.decks.rename);
  const setFormatMutation = useMutation(api.decks.setFormat);
  const deleteMutation = useMutation(api.decks.deleteDeck);
  const addCardMutation = useMutation(api.decks.addCard);
  const setQuantityMutation = useMutation(api.decks.setQuantity);
  const clearMutation = useMutation(api.decks.clear);
  const importEntriesMutation = useMutation(api.decks.importEntries);
  const replaceDeckMutation = useMutation(api.decks.replaceDeck);
  const patchPricesMutation = useMutation(api.decks.patchPrices);

  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const activeDeckRef = useRef<Deck | null>(null);
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeDeckRef.current = activeDeck ?? null;
    activeIdRef.current = activeId;
  }, [activeDeck, activeId]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const hydrated =
    !auth.isLoading &&
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

  const createDeck = useCallback(
    async (name?: string) => {
      if (!auth.isAuthenticated) return null;

      const deckId = uid();
      const createdId = await createMutation({
        deckId,
        name: name || "Untitled Deck",
      });
      setSelectedActiveId(createdId);
      return createdId;
    },
    [auth.isAuthenticated, createMutation]
  );

  const setActive = useCallback((id: string) => {
    setSelectedActiveId(id);
  }, []);

  const renameDeck = useCallback(
    async (id: string, name: string) => {
      if (!auth.isAuthenticated) return;
      await renameMutation({ deckId: id, name });
    },
    [auth.isAuthenticated, renameMutation]
  );

  const setFormat = useCallback(
    async (id: string, format: string) => {
      if (!auth.isAuthenticated) return;
      await setFormatMutation({ deckId: id, format });
    },
    [auth.isAuthenticated, setFormatMutation]
  );

  const deleteDeck = useCallback(
    async (id: string) => {
      if (!auth.isAuthenticated) return;
      await deleteMutation({ deckId: id });
      if (activeIdRef.current === id) {
        setSelectedActiveId(null);
      }
    },
    [auth.isAuthenticated, deleteMutation]
  );

  const addCard = useCallback(
    async (deckId: string, card: ScryfallCard, quantity = 1) => {
      if (!auth.isAuthenticated) return;
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
      await addCardMutation({
        deckId,
        card: cardToEntry(card, safeQuantity),
        quantity: safeQuantity,
      });
    },
    [
      addCardMutation,
      auth.isAuthenticated,
      recordActiveSnapshot,
      showQuantityLimit,
    ]
  );

  const setQuantity = useCallback(
    async (deckId: string, cardId: string, quantity: number) => {
      if (!auth.isAuthenticated) return;
      const current = activeDeckRef.current?.entries.find(
        (entry) => entry.cardId === cardId
      );
      const safeQuantity =
        quantity <= 0
          ? quantity
          : Math.min(Math.floor(quantity), CARD_QUANTITY_LIMIT);

      if (quantity > CARD_QUANTITY_LIMIT) {
        showQuantityLimit(current?.name);
      }
      if (current && current.quantity === safeQuantity) return;

      recordActiveSnapshot();
      await setQuantityMutation({ deckId, cardId, quantity: safeQuantity });
    },
    [
      auth.isAuthenticated,
      recordActiveSnapshot,
      setQuantityMutation,
      showQuantityLimit,
    ]
  );

  const clearDeck = useCallback(
    async (deckId: string) => {
      if (!auth.isAuthenticated) return;
      recordActiveSnapshot();
      await clearMutation({ deckId });
    },
    [auth.isAuthenticated, clearMutation, recordActiveSnapshot]
  );

  const importEntries = useCallback(
    async (deckId: string, incoming: DeckEntry[], mode: "merge" | "replace") => {
      if (!auth.isAuthenticated) return;
      if (incomingWouldExceedLimit(activeDeckRef.current, incoming, mode)) {
        showQuantityLimit("One or more cards");
      }
      recordActiveSnapshot();
      await importEntriesMutation({ deckId, entries: incoming, mode });
    },
    [
      auth.isAuthenticated,
      importEntriesMutation,
      recordActiveSnapshot,
      showQuantityLimit,
    ]
  );

  const refreshPrices = useCallback(
    async (deckId: string) => {
      if (!auth.isAuthenticated) return;
      const deck = activeDeckRef.current;
      if (!deck || deck.id !== deckId) return;

      const needIds = deck.entries
        .filter((entry) => entry.priceUsd === undefined)
        .map((entry) => entry.cardId);
      if (needIds.length === 0) return;

      try {
        const cards = await getCardsByIdentifiers(needIds.map((id) => ({ id })));
        if (cards.length === 0) return;

        const prices = cards
          .map((card) => {
            const raw = card.prices?.usd;
            const priceUsd = raw != null && raw !== "" ? Number(raw) : undefined;
            return {
              cardId: card.id,
              priceUsd: Number.isFinite(priceUsd) ? priceUsd : undefined,
            };
          })
          .filter((price) => price.priceUsd !== undefined);

        if (prices.length > 0) {
          await patchPricesMutation({ deckId, prices });
        }
      } catch {
        // Network errors leave prices unknown until a later refresh.
      }
    },
    [auth.isAuthenticated, patchPricesMutation]
  );

  const undo = useCallback(async () => {
    const prev = past[past.length - 1];
    const current = activeDeckRef.current;
    const currentActiveId = activeIdRef.current;
    if (!prev || !current || !currentActiveId || !auth.isAuthenticated) return;

    setPast((p) => p.slice(0, -1));
    setFuture((f) =>
      [{ deck: cloneDeck(current), activeId: currentActiveId }, ...f].slice(
        0,
        MAX_HISTORY
      )
    );
    await replaceDeckMutation({ deck: prev.deck });
    setSelectedActiveId(prev.activeId);
  }, [auth.isAuthenticated, past, replaceDeckMutation]);

  const redo = useCallback(async () => {
    const next = future[0];
    const current = activeDeckRef.current;
    const currentActiveId = activeIdRef.current;
    if (!next || !current || !currentActiveId || !auth.isAuthenticated) return;

    setFuture((f) => f.slice(1));
    setPast((p) =>
      [...p, { deck: cloneDeck(current), activeId: currentActiveId }].slice(
        -MAX_HISTORY
      )
    );
    await replaceDeckMutation({ deck: next.deck });
    setSelectedActiveId(next.activeId);
  }, [auth.isAuthenticated, future, replaceDeckMutation]);

  return {
    hydrated,
    isAuthenticated: auth.isAuthenticated,
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
    clearDeck,
    importEntries,
    refreshPrices,
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

function incomingWouldExceedLimit(
  deck: Deck | null,
  incoming: DeckEntry[],
  mode: "merge" | "replace"
) {
  const quantities = new Map<string, number>();

  if (mode === "merge" && deck) {
    for (const entry of deck.entries) {
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
