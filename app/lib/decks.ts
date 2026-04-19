"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Deck, DeckEntry, ScryfallCard } from "./types";
import { getCardImage, getCardsByIdentifiers } from "./scryfall";

const STORAGE_KEY = "deckwright:decks:v1";
const ACTIVE_KEY = "deckwright:active-deck:v1";

type Snapshot = { decks: Deck[]; activeId: string | null };

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function emptyDeck(name = "Untitled Deck"): Deck {
  const now = Date.now();
  return {
    id: uid(),
    name,
    format: "commander",
    createdAt: now,
    updatedAt: now,
    entries: [],
  };
}

function cloneDecks(decks: Deck[]): Deck[] {
  return decks.map((d) => ({ ...d, entries: d.entries.map((e) => ({ ...e })) }));
}

function readDecks(): Deck[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Deck[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function writeDecks(decks: Deck[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
  } catch {
    // quota or disabled — ignore
  }
}

function readActiveId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_KEY);
}

function writeActiveId(id: string | null) {
  if (id) window.localStorage.setItem(ACTIVE_KEY, id);
  else window.localStorage.removeItem(ACTIVE_KEY);
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

const MAX_HISTORY = 100;

export function useDecks() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);

  // Refs mirror state so history ops read the latest values even across rapid dispatches.
  const decksRef = useRef<Deck[]>([]);
  const activeRef = useRef<string | null>(null);
  decksRef.current = decks;
  activeRef.current = activeId;

  useEffect(() => {
    const stored = readDecks();
    if (stored.length === 0) {
      const first = emptyDeck("My First Deck");
      setDecks([first]);
      setActiveId(first.id);
      writeDecks([first]);
      writeActiveId(first.id);
    } else {
      setDecks(stored);
      const storedActive = readActiveId();
      const valid =
        storedActive && stored.some((d) => d.id === storedActive)
          ? storedActive
          : stored[0].id;
      setActiveId(valid);
      writeActiveId(valid);
    }
    setHydrated(true);
  }, []);

  const persist = useCallback((next: Deck[]) => {
    setDecks(next);
    writeDecks(next);
  }, []);

  const setActive = useCallback((id: string) => {
    setActiveId(id);
    writeActiveId(id);
  }, []);

  // Commit a mutation and record the prior state for undo.
  const commit = useCallback(
    (nextDecks: Deck[], nextActive: string | null) => {
      const snap: Snapshot = {
        decks: cloneDecks(decksRef.current),
        activeId: activeRef.current,
      };
      setPast((p) => {
        const next = [...p, snap];
        return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next;
      });
      setFuture([]);
      persist(nextDecks);
      if (nextActive !== activeRef.current) {
        setActiveId(nextActive);
        writeActiveId(nextActive);
      }
    },
    [persist]
  );

  const createDeck = useCallback(
    (name?: string) => {
      const d = emptyDeck(name || "Untitled Deck");
      const nextDecks = [...decksRef.current, d];
      commit(nextDecks, d.id);
      return d.id;
    },
    [commit]
  );

  // Rename / format are "silent" — no history. Coalesces keystroke-level edits.
  const renameDeck = useCallback((id: string, name: string) => {
    const next = decksRef.current.map((d) =>
      d.id === id ? { ...d, name, updatedAt: Date.now() } : d
    );
    setDecks(next);
    writeDecks(next);
  }, []);

  const setFormat = useCallback((id: string, format: string) => {
    const next = decksRef.current.map((d) =>
      d.id === id ? { ...d, format, updatedAt: Date.now() } : d
    );
    setDecks(next);
    writeDecks(next);
  }, []);

  const deleteDeck = useCallback(
    (id: string) => {
      const current = decksRef.current;
      const remaining = current.filter((d) => d.id !== id);
      if (remaining.length === 0) {
        const fresh = emptyDeck("Untitled Deck");
        commit([fresh], fresh.id);
        return;
      }
      const nextActive =
        activeRef.current === id ? remaining[0].id : activeRef.current;
      commit(remaining, nextActive);
    },
    [commit]
  );

  const addCard = useCallback(
    (deckId: string, card: ScryfallCard, quantity = 1) => {
      const next = decksRef.current.map((d) => {
        if (d.id !== deckId) return d;
        const idx = d.entries.findIndex((e) => e.cardId === card.id);
        let entries: DeckEntry[];
        if (idx >= 0) {
          entries = d.entries.slice();
          entries[idx] = {
            ...entries[idx],
            quantity: entries[idx].quantity + quantity,
          };
        } else {
          entries = [...d.entries, cardToEntry(card, quantity)];
        }
        return { ...d, entries, updatedAt: Date.now() };
      });
      commit(next, activeRef.current);
    },
    [commit]
  );

  const setQuantity = useCallback(
    (deckId: string, cardId: string, quantity: number) => {
      const next = decksRef.current.map((d) => {
        if (d.id !== deckId) return d;
        let entries: DeckEntry[];
        if (quantity <= 0) {
          entries = d.entries.filter((e) => e.cardId !== cardId);
        } else {
          entries = d.entries.map((e) =>
            e.cardId === cardId ? { ...e, quantity } : e
          );
        }
        return { ...d, entries, updatedAt: Date.now() };
      });
      commit(next, activeRef.current);
    },
    [commit]
  );

  const clearDeck = useCallback(
    (deckId: string) => {
      const next = decksRef.current.map((d) =>
        d.id === deckId ? { ...d, entries: [], updatedAt: Date.now() } : d
      );
      commit(next, activeRef.current);
    },
    [commit]
  );

  const importEntries = useCallback(
    (deckId: string, incoming: DeckEntry[], mode: "merge" | "replace") => {
      const next = decksRef.current.map((d) => {
        if (d.id !== deckId) return d;
        if (mode === "replace") {
          return { ...d, entries: incoming, updatedAt: Date.now() };
        }
        const byId = new Map(d.entries.map((e) => [e.cardId, { ...e }]));
        for (const e of incoming) {
          const existing = byId.get(e.cardId);
          if (existing) {
            existing.quantity += e.quantity;
          } else {
            byId.set(e.cardId, { ...e });
          }
        }
        return { ...d, entries: Array.from(byId.values()), updatedAt: Date.now() };
      });
      commit(next, activeRef.current);
    },
    [commit]
  );

  // Silent (no history) price backfill — prices change over time and users
  // don't expect undo to revert them. Only touches entries that need it.
  const refreshPrices = useCallback(async (deckId: string) => {
    const deck = decksRef.current.find((d) => d.id === deckId);
    if (!deck) return;
    const needIds = deck.entries
      .filter((e) => e.priceUsd === undefined)
      .map((e) => e.cardId);
    if (needIds.length === 0) return;
    try {
      const cards = await getCardsByIdentifiers(
        needIds.map((id) => ({ id }))
      );
      if (cards.length === 0) return;
      const priceById = new Map<string, number | undefined>();
      for (const c of cards) {
        const raw = c.prices?.usd;
        const n = raw != null && raw !== "" ? Number(raw) : undefined;
        priceById.set(c.id, Number.isFinite(n) ? n : undefined);
      }
      const current = decksRef.current;
      const patched = current.map((d) => {
        if (d.id !== deckId) return d;
        let touched = false;
        const entries = d.entries.map((e) => {
          if (e.priceUsd !== undefined) return e;
          if (!priceById.has(e.cardId)) return e;
          touched = true;
          return { ...e, priceUsd: priceById.get(e.cardId) };
        });
        return touched ? { ...d, entries } : d;
      });
      setDecks(patched);
      writeDecks(patched);
    } catch {
      // Network errors: silently leave prices unknown.
    }
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      const currentSnap: Snapshot = {
        decks: cloneDecks(decksRef.current),
        activeId: activeRef.current,
      };
      setFuture((f) => [currentSnap, ...f].slice(0, MAX_HISTORY));
      persist(prev.decks);
      setActiveId(prev.activeId);
      writeActiveId(prev.activeId);
      return p.slice(0, -1);
    });
  }, [persist]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const nextSnap = f[0];
      const currentSnap: Snapshot = {
        decks: cloneDecks(decksRef.current),
        activeId: activeRef.current,
      };
      setPast((p) => [...p, currentSnap].slice(-MAX_HISTORY));
      persist(nextSnap.decks);
      setActiveId(nextSnap.activeId);
      writeActiveId(nextSnap.activeId);
      return f.slice(1);
    });
  }, [persist]);

  const activeDeck = useMemo(
    () => decks.find((d) => d.id === activeId) ?? null,
    [decks, activeId]
  );

  return {
    hydrated,
    decks,
    activeDeck,
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
