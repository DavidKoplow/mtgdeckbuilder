import type { Deck, DeckEntry, ScryfallCard } from "./types";
import { effectivePlaytestUsername } from "./appSettings";
import {
  defaultMageAiType,
  defaultMagePlayerRating,
  effectiveMageServerId,
  mageServerOption,
  type MageServerOption,
  type MagePlaytestConfig,
} from "./magePlaytestConfig";
import { getCardsByIdentifiers, type CollectionIdentifier } from "./scryfall";

export type MageGatewayDeckEntry = {
  name: string;
  quantity: number;
  set?: string;
  collectorNumber?: string;
};

export type StartMageGameRequest = {
  mageHost?: string;
  magePort?: number;
  opponentType: MagePlaytestConfig["opponentType"];
  playerName: string;
  playerRating?: number;
  opponentName: string;
  ai: string;
  deckName: string;
  format: string;
  main: MageGatewayDeckEntry[];
  sideboard: MageGatewayDeckEntry[];
  opponentDeckName?: string;
  opponentMain?: MageGatewayDeckEntry[];
  opponentSideboard?: MageGatewayDeckEntry[];
};

export type StartMageSoloGameResponse = {
  id: string;
  eventUrl: string;
  opponentDeckAccepted?: boolean;
};

export type MageSessionEventsResponse = {
  id?: string;
  terminal?: boolean;
  events?: MageGatewayEvent[];
};

export type MageCounterView = {
  name?: string;
  count?: number;
};

export type MageCardView = {
  id?: string;
  parentId?: string;
  name?: string;
  displayName?: string;
  displayFullName?: string;
  alternateName?: string;
  expansionSetCode?: string;
  cardNumber?: string;
  rules?: string[];
  power?: string;
  toughness?: string;
  loyalty?: string;
  defense?: string;
  cardTypes?: string[];
  superTypes?: string[];
  subTypes?: unknown;
  manaCostLeftStr?: string[];
  manaCostRightStr?: string[];
  counters?: MageCounterView[];
  tapped?: boolean;
  rotate?: boolean;
  isToken?: boolean;
  faceDown?: boolean;
  canAttack?: boolean;
  canBlock?: boolean;
  targets?: string[];
  attachments?: string[];
  attachedTo?: string;
  attachedToPermanent?: boolean;
  sourceCard?: MageCardView | null;
  isAbility?: boolean;
  original?: MageCardView | null;
  // Permanent-only fields (PermanentView extends CardView)
  damage?: number;
  summoningSickness?: boolean;
  phasedIn?: boolean;
  flipped?: boolean;
  morphed?: boolean;
  disguised?: boolean;
  manifested?: boolean;
  cloaked?: boolean;
  copy?: boolean;
  controlled?: boolean;
  mageObjectType?: string;
};

export type MageCardsView = Record<string, MageCardView>;

export type MageExileView = MageCardsView & {
  id?: string;
  name?: string;
};

export type MageRevealedView = {
  name?: string;
  cards?: MageCardsView;
};

export type MageCombatGroupView = {
  attackers?: MageCardsView;
  blockers?: MageCardsView;
  isBlocked?: boolean;
  defenderName?: string;
  defenderId?: string;
};

export type MageUserData = {
  flagName?: string;
  avatarId?: number;
  generalRating?: number;
  constructedRating?: number;
  limitedRating?: number;
};

export type MagePlayerView = {
  playerId?: string;
  name?: string;
  controlled?: boolean;
  isHuman?: boolean;
  life?: number;
  counters?: MageCounterView[];
  wins?: number;
  winsNeeded?: number;
  libraryCount?: number;
  handCount?: number;
  isActive?: boolean;
  hasPriority?: boolean;
  timerActive?: boolean;
  priorityTimeLeftSecs?: number;
  manaPool?: unknown;
  graveyard?: MageCardsView;
  exile?: MageCardsView;
  sideboard?: MageCardsView;
  battlefield?: MageCardsView;
  topCard?: MageCardView | null;
  commandList?: MageCardView[];
  commandObjectList?: MageCardView[];
  userData?: MageUserData;
  monarch?: boolean;
  initiative?: boolean;
  designationNames?: string[];
  passedTurn?: boolean;
  passedUntilEndOfTurn?: boolean;
  passedUntilNextMain?: boolean;
  passedUntilStackResolved?: boolean;
  passedAllTurns?: boolean;
  passedUntilEndStepBeforeMyTurn?: boolean;
};

export type MagePlayableObjects = {
  objects?: Record<string, unknown>;
};

export type MageMultiAmountMessage = {
  message?: string;
  min?: number;
  max?: number;
  defaultValue?: number;
};

export type MageGameView = {
  players?: MagePlayerView[];
  myPlayerId?: string | null;
  myHand?: MageCardsView;
  /** Opponent hands visible during reveal / target-from-hand effects */
  opponentHands?: Record<string, MageCardsView>;
  /** Hands the client is allowed to view (spectator / reveal) */
  watchedHands?: Record<string, MageCardsView>;
  stack?: MageCardsView;
  exile?: MageExileView[];
  exiles?: MageExileView[];
  revealed?: MageRevealedView[];
  lookedAt?: MageRevealedView[];
  companion?: MageRevealedView[];
  combat?: MageCombatGroupView[];
  phase?: string;
  step?: string;
  turn?: number;
  activePlayerId?: string;
  activePlayerName?: string;
  priorityPlayerName?: string;
  special?: boolean;
  canPlayObjects?: MagePlayableObjects | null;
};

export type MageChoiceView = {
  choices?: string[];
  keyChoices?: Record<string, string>;
  choice?: string | null;
  choiceKey?: string | null;
  message?: string;
  subMessage?: string;
  required?: boolean;
  specialEnabled?: boolean;
  specialText?: string;
  specialHint?: string;
};

export type MageGatewayEvent = {
  sessionId?: string;
  type?: string;
  callbackMethod?: string;
  callbackType?: string;
  objectId?: string;
  sequence?: number;
  time?: number;
  chatTime?: number;
  gameId?: string;
  playerId?: string;
  chatId?: string;
  username?: string | null;
  messageId?: number;
  message?: string;
  turnInfo?: string | null;
  color?: string | null;
  messageType?: string | null;
  soundToPlay?: string | null;
  flag?: boolean;
  min?: number;
  max?: number;
  gameView?: MageGameView | null;
  options?: Record<string, unknown> | null;
  choices?: Record<string, string> | null;
  choice?: MageChoiceView | null;
  cardsView1?: MageCardsView | null;
  cardsView2?: MageCardsView | null;
  targets?: string[] | Record<string, unknown> | null;
  messages?: unknown[] | null;
  payload?: unknown;
};

type StartOptions = {
  signal?: AbortSignal;
  opponentDeck?: Deck;
  playerName?: string;
};

const DEFAULT_MAGE_GATEWAY_URL = "http://127.0.0.1:17888";

export function mageGatewayBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_MAGE_GATEWAY_URL?.trim();
  return (configured || DEFAULT_MAGE_GATEWAY_URL).replace(/\/+$/, "");
}

export function mageGatewayHealthUrl(server?: Pick<MageServerOption, "host" | "port"> | null): string {
  const baseUrl = mageGatewayBaseUrl();
  if (!server) return `${baseUrl}/health`;
  const url = new URL(`${baseUrl}/health`);
  url.searchParams.set("backendStats", "1");
  url.searchParams.set("mageHost", server.host);
  url.searchParams.set("magePort", String(server.port));
  return url.toString();
}

export function mageGatewayEventUrl(
  sessionId: string,
  options: { spectator?: boolean } = {}
): string {
  const baseUrl = mageGatewayBaseUrl();
  const suffix = options.spectator ? "?spectator=1" : "";
  return websocketUrl(`/v1/games/${sessionId}/events${suffix}`, baseUrl);
}

function mageGatewayEventHistoryUrl(
  sessionId: string,
  options: { spectator?: boolean } = {}
): string {
  const baseUrl = mageGatewayBaseUrl();
  const suffix = options.spectator ? "?spectator=1" : "";
  return `${baseUrl}/v1/games/${encodeURIComponent(sessionId)}/events${suffix}`;
}

export function deckEntriesForMage(entries: DeckEntry[]): MageGatewayDeckEntry[] {
  return entries
    .filter((entry) => entry.quantity > 0 && entry.name.trim().length > 0)
    .map((entry) => deckEntryForMage(entry, entry.quantity));
}

export async function startMageGame(
  deck: Deck,
  config: MagePlaytestConfig,
  options: StartOptions = {}
): Promise<StartMageSoloGameResponse> {
  const baseUrl = mageGatewayBaseUrl();
  const server = mageServerOption(effectiveMageServerId(config));
  const mageDeck = await deckForMage(deck, config, options.signal);
  const opponentMageDeck =
    config.opponentType === "ai" && options.opponentDeck
      ? await deckForMage(options.opponentDeck, config, options.signal)
      : null;
  const request: StartMageGameRequest = {
    mageHost: server.host,
    magePort: server.port,
    opponentType: config.opponentType,
    playerName: options.playerName?.trim() || effectivePlaytestUsername(),
    playerRating: defaultMagePlayerRating(config.playerRating),
    opponentName: config.opponentType === "human" ? "Opponent" : "Sparring AI",
    ai: defaultMageAiType(config.ai),
    deckName: deck.name || "Web playtest",
    format: config.gameMode,
    main: mageDeck.main,
    sideboard: mageDeck.sideboard,
  };
  if (opponentMageDeck && options.opponentDeck) {
    request.opponentDeckName = options.opponentDeck.name || "AI opponent";
    request.opponentMain = opponentMageDeck.main;
    request.opponentSideboard = opponentMageDeck.sideboard;
  }

  let response = await postStartRequest(`${baseUrl}/v1/games`, request, options);
  let payload = await readJson(response);
  if (response.status === 404 && errorMessage(payload) === "Not found") {
    if (config.opponentType === "human") {
      throw new Error(
        "This MAGE gateway does not support real-player matchmaking yet. Rebuild and restart the Docker container so the gateway exposes /v1/games."
      );
    }
    response = await postStartRequest(`${baseUrl}/v1/solo-games`, request, options);
    payload = await readJson(response);
  }
  if (!response.ok) {
    throw new Error(
      errorMessage(payload) ||
        `MAGE gateway returned HTTP ${response.status}.`
    );
  }

  const parsed = payload as Partial<StartMageSoloGameResponse>;
  if (!parsed.id || !parsed.eventUrl) {
    throw new Error("MAGE gateway returned an invalid session response.");
  }
  if (opponentMageDeck && parsed.opponentDeckAccepted !== true) {
    throw new Error(
      "This MAGE gateway did not acknowledge the selected AI deck. Rebuild and restart the MAGE Docker container so the gateway seats the AI with the chosen opponent deck."
    );
  }

  return {
    id: parsed.id,
    eventUrl: websocketUrl(parsed.eventUrl, baseUrl),
    opponentDeckAccepted: parsed.opponentDeckAccepted,
  };
}

export async function fetchMageSessionEvents(
  sessionId: string,
  options: { spectator?: boolean; signal?: AbortSignal } = {}
): Promise<MageSessionEventsResponse | null> {
  try {
    const response = await fetch(mageGatewayEventHistoryUrl(sessionId, options), {
      signal: options.signal,
    });
    if (!response.ok) return null;
    const payload = (await readJson(response)) as Partial<MageSessionEventsResponse>;
    if (!payload || typeof payload !== "object") return null;
    return {
      id: typeof payload.id === "string" ? payload.id : sessionId,
      terminal: payload.terminal === true,
      events: Array.isArray(payload.events) ? payload.events : [],
    };
  } catch {
    return null;
  }
}

async function postStartRequest(
  url: string,
  request: StartMageGameRequest,
  options: StartOptions
): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new Error(
      `Could not reach the MAGE gateway at ${mageGatewayBaseUrl()}. Start the MAGE Docker container and try again.`
    );
  }
}

export async function startMageSoloGame(
  deck: Deck,
  options: StartOptions = {}
): Promise<StartMageSoloGameResponse> {
  return startMageGame(
    deck,
    {
      opponentType: "ai",
      gameMode: "commander",
      ai: "COMPUTER_MAD",
    },
    options
  );
}

async function deckForMage(
  deck: Deck,
  config: MagePlaytestConfig,
  signal?: AbortSignal
): Promise<Pick<StartMageGameRequest, "main" | "sideboard">> {
  if (config.gameMode !== "commander") {
    return {
      main: deckEntriesForMage(deck.entries),
      sideboard: deckEntriesForMage(deck.sideboard),
    };
  }

  const main: MageGatewayDeckEntry[] = [];
  const sideboard: MageGatewayDeckEntry[] = [];
  for (const entry of deck.entries) {
    const commanderQuantity = entry.isCommander ? Math.min(1, entry.quantity) : 0;
    const libraryQuantity = Math.max(0, entry.quantity - commanderQuantity);
    if (libraryQuantity > 0) {
      main.push(deckEntryForMage(entry, libraryQuantity));
    }
    if (commanderQuantity > 0) {
      sideboard.push(deckEntryForMage(entry, commanderQuantity));
    }
  }
  sideboard.push(...deckEntriesForMage(deck.sideboard));
  const companionMaybeboard = await deckEntriesForMageMaybeboardCompanions(
    deck.maybeboard,
    signal
  );
  sideboard.push(...companionMaybeboard);
  return { main, sideboard };
}

async function deckEntriesForMageMaybeboardCompanions(
  maybeboard: DeckEntry[],
  signal?: AbortSignal
): Promise<MageGatewayDeckEntry[]> {
  const relevantEntries = maybeboard.filter(
    (entry) => entry.quantity > 0 && entry.name.trim().length > 0
  );
  if (relevantEntries.length === 0) {
    return [];
  }

  const identifiers = new Map<string, CollectionIdentifier>();
  for (const entry of relevantEntries) {
    if (!entry.cardId) continue;
    if (identifiers.has(entry.cardId)) continue;
    identifiers.set(entry.cardId, identifierForCardId(entry.cardId));
  }

  if (identifiers.size === 0) {
    return [];
  }

  const cards = await getCardsByIdentifiers([...identifiers.values()], signal);
  const cardsById = new Map<string, ScryfallCard>();
  for (const card of cards) {
    cardsById.set(card.id, card);
    if (card.oracle_id) {
      cardsById.set(`oracle:${card.oracle_id}`, card);
    }
  }

  return relevantEntries
    .filter((entry) => hasCompanion(cardsById.get(entry.cardId ?? "")))
    .map((entry) => deckEntryForMage(entry, entry.quantity));
}

function websocketUrl(rawUrl: string, baseUrl: string): string {
  const url = new URL(rawUrl, baseUrl);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }
  return url.toString();
}

function deckEntryForMage(
  entry: DeckEntry,
  quantity: number
): MageGatewayDeckEntry {
  return {
    name: entry.name,
    quantity: Math.max(1, Math.floor(quantity)),
    set: entry.set,
    collectorNumber: entry.collectorNumber,
  };
}

function identifierForCardId(cardId: string): CollectionIdentifier {
  if (cardId.startsWith("oracle:")) {
    return { oracle_id: cardId.slice("oracle:".length) };
  }
  return { id: cardId };
}

function hasCompanion(card: ScryfallCard | null | undefined): boolean {
  return oracleText(card).toLowerCase().includes("companion");
}

function oracleText(card: ScryfallCard | null | undefined): string {
  if (!card) return "";
  return [
    card.oracle_text,
    ...(card.card_faces?.map((face) => face.oracle_text) ?? []),
  ]
    .filter(Boolean)
    .join("\n");
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function errorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const error = (payload as { error?: unknown }).error;
  return typeof error === "string" && error.trim() ? error : null;
}
