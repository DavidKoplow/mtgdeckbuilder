"use client";

import { useCallback, useMemo, useReducer } from "react";
import type { Deck, DeckEntry } from "./types";

export type Zone = "library" | "hand" | "battlefield" | "graveyard" | "exile";

export type PlayCard = {
  instanceId: string;
  cardId: string;
  name: string;
  imageNormal?: string;
  imageSmall?: string;
  typeLine?: string;
  manaCost?: string;
  cmc?: number;
  colors?: string[];
  tapped: boolean;
  counters: Record<string, number>;
  isToken?: boolean;
  tokenNote?: string;
};

export type Phase = "mulligan-deciding" | "mulligan-bottoming" | "playing";

export type PlayState = {
  library: PlayCard[];
  hand: PlayCard[];
  battlefield: PlayCard[];
  graveyard: PlayCard[];
  exile: PlayCard[];
  life: number;
  turn: number;
  phase: Phase;
  mulligansTaken: number;
  scry: PlayCard[] | null;
  search: { open: boolean; dest: Zone } | null;
};

function uid(): string {
  return (
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  );
}

function entryToInstances(e: DeckEntry): PlayCard[] {
  const out: PlayCard[] = [];
  for (let i = 0; i < e.quantity; i++) {
    out.push({
      instanceId: uid(),
      cardId: e.cardId,
      name: e.name,
      imageNormal: e.imageNormal,
      imageSmall: e.imageSmall,
      typeLine: e.typeLine,
      manaCost: e.manaCost,
      cmc: e.cmc,
      colors: e.colors,
      tapped: false,
      counters: {},
    });
  }
  return out;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildLibrary(deck: Deck): PlayCard[] {
  const lib: PlayCard[] = [];
  for (const e of deck.entries) lib.push(...entryToInstances(e));
  return shuffle(lib);
}

function initialState(deck: Deck, life = 20): PlayState {
  const lib = buildLibrary(deck);
  const hand = lib.splice(0, Math.min(7, lib.length));
  return {
    library: lib,
    hand,
    battlefield: [],
    graveyard: [],
    exile: [],
    life,
    turn: 1,
    phase: "mulligan-deciding",
    mulligansTaken: 0,
    scry: null,
    search: null,
  };
}

type Action =
  | { type: "new-game"; deck: Deck; life?: number }
  | { type: "shuffle" }
  | { type: "draw"; count: number }
  | {
      type: "move";
      instanceId: string;
      from: Zone;
      to: Zone;
      position?: "top" | "bottom";
    }
  | { type: "tap-toggle"; instanceId: string }
  | { type: "untap-all" }
  | { type: "counter"; instanceId: string; kind: string; delta: number }
  | {
      type: "add-token";
      token: { name: string; typeLine?: string; tokenNote?: string };
    }
  | { type: "life"; delta: number }
  | { type: "set-life"; value: number }
  | { type: "end-turn" }
  | { type: "mulligan" }
  | { type: "keep-hand" }
  | { type: "bottom-cards"; instanceIds: string[] }
  | { type: "scry-start"; count: number }
  | { type: "scry-finish"; top: string[]; bottom: string[] }
  | { type: "search-open"; dest: Zone }
  | {
      type: "search-pick";
      instanceId: string;
      shuffle: boolean;
    }
  | { type: "search-cancel" };

function findIn(state: PlayState, zone: Zone, id: string): PlayCard | undefined {
  return state[zone].find((c) => c.instanceId === id);
}

function without(arr: PlayCard[], id: string): PlayCard[] {
  return arr.filter((c) => c.instanceId !== id);
}

function reducer(state: PlayState, action: Action): PlayState {
  switch (action.type) {
    case "new-game":
      return initialState(action.deck, action.life ?? state.life);

    case "shuffle":
      return { ...state, library: shuffle(state.library) };

    case "draw": {
      const n = Math.min(action.count, state.library.length);
      if (n === 0) return state;
      const drawn = state.library.slice(0, n);
      return {
        ...state,
        library: state.library.slice(n),
        hand: [...state.hand, ...drawn],
      };
    }

    case "move": {
      const card = findIn(state, action.from, action.instanceId);
      if (!card) return state;
      const next: PlayState = {
        ...state,
        [action.from]: without(state[action.from], action.instanceId),
      } as PlayState;

      // Reset tapped/counters when leaving the battlefield
      const cleaned =
        action.to === "battlefield"
          ? card
          : { ...card, tapped: false, counters: {} };

      if (action.to === "library") {
        next.library =
          action.position === "top"
            ? [cleaned, ...next.library]
            : [...next.library, cleaned];
      } else {
        next[action.to] = [...next[action.to], cleaned];
      }
      return next;
    }

    case "tap-toggle":
      return {
        ...state,
        battlefield: state.battlefield.map((c) =>
          c.instanceId === action.instanceId ? { ...c, tapped: !c.tapped } : c
        ),
      };

    case "untap-all":
      return {
        ...state,
        battlefield: state.battlefield.map((c) => ({ ...c, tapped: false })),
      };

    case "counter": {
      return {
        ...state,
        battlefield: state.battlefield.map((c) => {
          if (c.instanceId !== action.instanceId) return c;
          const current = c.counters[action.kind] ?? 0;
          const nextVal = current + action.delta;
          const counters = { ...c.counters };
          if (nextVal === 0) delete counters[action.kind];
          else counters[action.kind] = nextVal;
          return { ...c, counters };
        }),
      };
    }

    case "add-token": {
      const token: PlayCard = {
        instanceId: uid(),
        cardId: `token-${uid()}`,
        name: action.token.name,
        typeLine: action.token.typeLine ?? "Token Creature",
        tokenNote: action.token.tokenNote,
        tapped: false,
        counters: {},
        isToken: true,
      };
      return { ...state, battlefield: [...state.battlefield, token] };
    }

    case "life":
      return { ...state, life: state.life + action.delta };
    case "set-life":
      return { ...state, life: action.value };

    case "end-turn":
      return {
        ...state,
        turn: state.turn + 1,
        battlefield: state.battlefield.map((c) => ({ ...c, tapped: false })),
      };

    case "mulligan": {
      // Put hand back, shuffle, deal new 7 — mulligan count goes up
      const combined = shuffle([...state.library, ...state.hand]);
      return {
        ...state,
        library: combined.slice(7),
        hand: combined.slice(0, 7),
        mulligansTaken: state.mulligansTaken + 1,
        phase: "mulligan-deciding",
      };
    }

    case "keep-hand": {
      if (state.mulligansTaken === 0)
        return { ...state, phase: "playing" };
      return { ...state, phase: "mulligan-bottoming" };
    }

    case "bottom-cards": {
      // Move chosen instances from hand to bottom of library in given order
      const ids = new Set(action.instanceIds);
      const toBottom = action.instanceIds
        .map((id) => state.hand.find((c) => c.instanceId === id))
        .filter((c): c is PlayCard => !!c);
      const newHand = state.hand.filter((c) => !ids.has(c.instanceId));
      return {
        ...state,
        hand: newHand,
        library: [...state.library, ...toBottom],
        phase: "playing",
      };
    }

    case "scry-start": {
      const n = Math.min(action.count, state.library.length);
      return {
        ...state,
        scry: state.library.slice(0, n),
        library: state.library.slice(n),
      };
    }

    case "scry-finish": {
      if (!state.scry) return state;
      const byId = new Map(state.scry.map((c) => [c.instanceId, c]));
      const top = action.top
        .map((id) => byId.get(id))
        .filter((c): c is PlayCard => !!c);
      const bottom = action.bottom
        .map((id) => byId.get(id))
        .filter((c): c is PlayCard => !!c);
      return {
        ...state,
        library: [...top, ...state.library, ...bottom],
        scry: null,
      };
    }

    case "search-open":
      return { ...state, search: { open: true, dest: action.dest } };

    case "search-pick": {
      if (!state.search) return state;
      const card = state.library.find(
        (c) => c.instanceId === action.instanceId
      );
      if (!card) return state;
      const remaining = without(state.library, action.instanceId);
      const next: PlayState = {
        ...state,
        library: action.shuffle ? shuffle(remaining) : remaining,
        search: null,
      };
      const cleaned =
        state.search.dest === "battlefield"
          ? card
          : { ...card, tapped: false, counters: {} };
      next[state.search.dest] = [...state[state.search.dest], cleaned];
      return next;
    }

    case "search-cancel":
      return { ...state, search: null };
  }
}

export function usePlaytest(deck: Deck, startingLife = 20) {
  const [state, dispatch] = useReducer(
    reducer,
    undefined,
    () => initialState(deck, startingLife)
  );

  const newGame = useCallback(
    (life?: number) => dispatch({ type: "new-game", deck, life }),
    [deck]
  );
  const shuffleLib = useCallback(() => dispatch({ type: "shuffle" }), []);
  const draw = useCallback(
    (count = 1) => dispatch({ type: "draw", count }),
    []
  );
  const move = useCallback(
    (
      instanceId: string,
      from: Zone,
      to: Zone,
      position?: "top" | "bottom"
    ) => dispatch({ type: "move", instanceId, from, to, position }),
    []
  );
  const tapToggle = useCallback(
    (instanceId: string) =>
      dispatch({ type: "tap-toggle", instanceId }),
    []
  );
  const untapAll = useCallback(() => dispatch({ type: "untap-all" }), []);
  const counter = useCallback(
    (instanceId: string, kind: string, delta: number) =>
      dispatch({ type: "counter", instanceId, kind, delta }),
    []
  );
  const addToken = useCallback(
    (token: { name: string; typeLine?: string; tokenNote?: string }) =>
      dispatch({ type: "add-token", token }),
    []
  );
  const lifeDelta = useCallback(
    (delta: number) => dispatch({ type: "life", delta }),
    []
  );
  const setLife = useCallback(
    (value: number) => dispatch({ type: "set-life", value }),
    []
  );
  const endTurn = useCallback(() => dispatch({ type: "end-turn" }), []);
  const mulligan = useCallback(() => dispatch({ type: "mulligan" }), []);
  const keepHand = useCallback(() => dispatch({ type: "keep-hand" }), []);
  const bottomCards = useCallback(
    (instanceIds: string[]) =>
      dispatch({ type: "bottom-cards", instanceIds }),
    []
  );
  const scryStart = useCallback(
    (count: number) => dispatch({ type: "scry-start", count }),
    []
  );
  const scryFinish = useCallback(
    (top: string[], bottom: string[]) =>
      dispatch({ type: "scry-finish", top, bottom }),
    []
  );
  const searchOpen = useCallback(
    (dest: Zone) => dispatch({ type: "search-open", dest }),
    []
  );
  const searchPick = useCallback(
    (instanceId: string, doShuffle = true) =>
      dispatch({
        type: "search-pick",
        instanceId,
        shuffle: doShuffle,
      }),
    []
  );
  const searchCancel = useCallback(
    () => dispatch({ type: "search-cancel" }),
    []
  );

  const stats = useMemo(
    () => ({
      librarySize: state.library.length,
      handSize: state.hand.length,
    }),
    [state.library.length, state.hand.length]
  );

  return {
    state,
    stats,
    newGame,
    shuffleLib,
    draw,
    move,
    tapToggle,
    untapAll,
    counter,
    addToken,
    lifeDelta,
    setLife,
    endTurn,
    mulligan,
    keepHand,
    bottomCards,
    scryStart,
    scryFinish,
    searchOpen,
    searchPick,
    searchCancel,
  };
}
