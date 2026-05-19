"use client";

import { useCallback, useMemo, useReducer } from "react";
import type { Deck, DeckEntry } from "./types";

export type Zone =
  | "library"
  | "hand"
  | "battlefield"
  | "graveyard"
  | "exile"
  | "command";
export type PlayMode = "normal" | "commander";

export type PlayCard = {
  instanceId: string;
  cardId: string;
  name: string;
  isCommander?: boolean;
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

export type PlayTokenTemplate = {
  name: string;
  typeLine?: string;
  tokenNote?: string;
};

export type Phase = "mulligan-deciding" | "mulligan-bottoming" | "playing";

export type PlayState = {
  library: PlayCard[];
  command: PlayCard[];
  hand: PlayCard[];
  battlefield: PlayCard[];
  graveyard: PlayCard[];
  exile: PlayCard[];
  life: number;
  poison: number;
  recentTokens: PlayTokenTemplate[];
  mode: PlayMode;
  turn: number;
  phase: Phase;
  mulligansTaken: number;
  scry: PlayCard[] | null;
  search: { open: boolean; dest: Zone } | null;
};

const RECENT_TOKEN_LIMIT = 6;

function uid(): string {
  return (
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  );
}

function startingLife(mode: PlayMode) {
  return mode === "commander" ? 40 : 20;
}

function entryToInstances(
  e: DeckEntry,
  quantity = e.quantity,
  isCommander = false
): PlayCard[] {
  const out: PlayCard[] = [];
  for (let i = 0; i < quantity; i++) {
    out.push({
      instanceId: uid(),
      cardId: e.cardId,
      name: e.name,
      isCommander,
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
  return buildStartingZones(deck, "normal").library;
}

function buildStartingZones(deck: Deck, mode: PlayMode) {
  const lib: PlayCard[] = [];
  const command: PlayCard[] = [];

  for (const e of deck.entries) {
    const commanderQuantity = mode === "commander" && e.isCommander ? 1 : 0;
    if (commanderQuantity > 0) {
      command.push(...entryToInstances(e, commanderQuantity, true));
    }

    const libraryQuantity = Math.max(0, e.quantity - commanderQuantity);
    if (libraryQuantity > 0) {
      lib.push(...entryToInstances(e, libraryQuantity));
    }
  }

  return { library: shuffle(lib), command };
}

function initialState(
  deck: Deck,
  mode: PlayMode = "normal",
  life = startingLife(mode)
): PlayState {
  const { library: lib, command } = buildStartingZones(deck, mode);
  const hand = lib.splice(0, Math.min(7, lib.length));
  return {
    library: lib,
    command,
    hand,
    battlefield: [],
    graveyard: [],
    exile: [],
    life,
    poison: 0,
    recentTokens: [],
    mode,
    turn: 1,
    phase: "mulligan-deciding",
    mulligansTaken: 0,
    scry: null,
    search: null,
  };
}

type Action =
  | { type: "new-game"; deck: Deck; mode?: PlayMode; life?: number }
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
      token: PlayTokenTemplate;
    }
  | { type: "life"; delta: number }
  | { type: "set-life"; value: number }
  | { type: "poison"; delta: number }
  | { type: "set-poison"; value: number }
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

function canMoveToZone(card: PlayCard, zone: Zone): boolean {
  return zone !== "command" || card.isCommander === true;
}

function normalizeCounter(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function sameTokenTemplate(a: PlayTokenTemplate, b: PlayTokenTemplate): boolean {
  return (
    a.name === b.name &&
    (a.typeLine ?? "") === (b.typeLine ?? "") &&
    (a.tokenNote ?? "") === (b.tokenNote ?? "")
  );
}

function rememberRecentToken(
  recentTokens: PlayTokenTemplate[],
  token: PlayTokenTemplate
): PlayTokenTemplate[] {
  return [
    token,
    ...recentTokens.filter((existing) => !sameTokenTemplate(existing, token)),
  ].slice(0, RECENT_TOKEN_LIMIT);
}

function reducer(state: PlayState, action: Action): PlayState {
  switch (action.type) {
    case "new-game": {
      const mode = action.mode ?? state.mode;
      return initialState(action.deck, mode, action.life ?? startingLife(mode));
    }

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
      if (!canMoveToZone(card, action.to)) return state;
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
      return {
        ...state,
        battlefield: [...state.battlefield, token],
        recentTokens: rememberRecentToken(state.recentTokens, action.token),
      };
    }

    case "life":
      return { ...state, life: state.life + action.delta };
    case "set-life":
      return { ...state, life: action.value };
    case "poison":
      return { ...state, poison: normalizeCounter(state.poison + action.delta) };
    case "set-poison":
      return { ...state, poison: normalizeCounter(action.value) };

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
      if (!canMoveToZone(card, state.search.dest)) return state;
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

export function usePlaytest(deck: Deck, startingMode: PlayMode = "normal") {
  const [state, dispatch] = useReducer(
    reducer,
    undefined,
    () => initialState(deck, startingMode)
  );

  const newGame = useCallback(
    (mode?: PlayMode, life?: number) =>
      dispatch({ type: "new-game", deck, mode, life }),
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
    (token: PlayTokenTemplate) => dispatch({ type: "add-token", token }),
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
  const poisonDelta = useCallback(
    (delta: number) => dispatch({ type: "poison", delta }),
    []
  );
  const setPoison = useCallback(
    (value: number) => dispatch({ type: "set-poison", value }),
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
    poisonDelta,
    setPoison,
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
