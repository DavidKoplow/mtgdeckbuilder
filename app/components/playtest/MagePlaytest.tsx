"use client";

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useConvex, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { AppIcon } from "../AppIcon";
import { CardHover } from "../CardHover";
import { ManaCost, ManaPip, ManaText, ManaTextBlock } from "../ManaCost";
import { useFinePointer } from "../../hooks/useMediaQuery";
import { getCardByName, getCardImage } from "../../lib/scryfall";
import {
  fetchMageSessionEvents,
  mageGatewayEventUrl,
  mageGatewayBaseUrl,
  mageGatewayHealthUrl,
  startMageGame,
  type MageCardView,
  type MageCardsView,
  type MageCombatGroupView,
  type MageCounterView,
  type MageExileView,
  type MageChoiceView,
  type MageGameView,
  type MageGatewayEvent,
  type MageMultiAmountMessage,
  type MagePlayerView,
  type MageRevealedView,
} from "../../lib/mageGateway";
import {
  MAGE_AI_OPTIONS,
  MAGE_GAME_MODES,
  MAGE_SERVER_OPTIONS,
  defaultMageAiType,
  defaultMageGameMode,
  defaultMagePlayerRating,
  defaultMageServerId,
  effectiveMageServerId,
  mageAiServerOption,
  mageGameModeLabel,
  mageServerOption,
  validateDeckForMageGameMode,
  type MageDeckValidation,
  type MageGameMode,
  type MageOpponentDeckMode,
  type MageOpponentDeckSource,
  type MageOpponentType,
  type MagePlaytestConfig,
  type MageServerOption,
  type MageServerId,
} from "../../lib/magePlaytestConfig";
import type {
  Deck,
  DeckEntry,
  PublicDeck,
  PublicDeckSummary,
  ScryfallCard,
} from "../../lib/types";

type Status = "idle" | "starting" | "connecting" | "connected" | "closed" | "error";
type Hover = { src?: string; x: number; y: number } | null;
type CardImage = { normal?: string; small?: string };
type MageChatMessage = {
  id: string;
  chatId: string | null;
  username: string | null;
  message: string;
  time: number | null;
  turnInfo: string | null;
  color: string | null;
  messageType: string | null;
};
type GatewayHealth = "checking" | "online" | "offline";
type GatewayBackendStats = {
  ok?: boolean;
  mageHost?: string | null;
  magePort?: number | null;
  onlineUsers?: number | null;
  activeGames?: number | null;
  gameThreads?: number | null;
  maxGames?: number | null;
  waiting?: number | null;
  waitingTables?: number | null;
  waitingByFormat?: Record<string, number | null> | null;
  checkedAt?: number | null;
  error?: string | null;
};
type GatewaySessionStats = {
  active?: number | null;
  waiting?: number | null;
  waitingByFormat?: Record<string, number | null> | null;
  terminal?: number | null;
  total?: number | null;
};
type GatewayStats = {
  ok?: boolean;
  backend?: GatewayBackendStats | null;
  sessions?: GatewaySessionStats | null;
};
type PlaytestToastState = { id: number; message: string };
type StoredMageSession = {
  deckId: string;
  sessionId: string;
  config: MagePlaytestConfig;
  savedAt: number;
};

type MageCommand = {
  type: string;
  gameId?: string;
  playerId?: string;
  clientGameView?: MageGameView | null;
  clientPrompt?: MageGatewayEvent | null;
  id?: string;
  value?: string | number | boolean;
  chatId?: string;
  message?: string;
  action?: string;
  data?: string | number | boolean | null;
};

type MageSessionState = {
  status: Status;
  sessionId: string | null;
  gameId: string | null;
  playerId: string | null;
  spectator: boolean;
  gameView: MageGameView | null;
  prompt: MageGatewayEvent | null;
  events: MageGatewayEvent[];
  chatId: string | null;
  chat: MageChatMessage[];
  error: string | null;
  lastMessage: string | null;
  config: MagePlaytestConfig | null;
};

type UseMagePlaytest = MageSessionState & {
  start: (config: MagePlaytestConfig, opponentDeck?: Deck) => Promise<void>;
  disconnect: () => void;
  chooseUuid: (id: string) => void;
  chooseBoolean: (value: boolean) => void;
  chooseInteger: (value: number) => void;
  chooseString: (value: string) => void;
  chooseManaType: (value: string) => void;
  addManaToPool: (mana: ManaPoolDelta) => void;
  playerAction: (action: string, data?: string | number | boolean | null) => void;
  passPriority: () => void;
  passUntilNextTurn: () => void;
  concede: () => void;
  sendChatMessage: (message: string) => boolean;
};

type MageManaPoolView = {
  red?: unknown;
  green?: unknown;
  blue?: unknown;
  white?: unknown;
  black?: unknown;
  colorless?: unknown;
};

type ManaPoolCounts = {
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  colorless: number;
};

type ManaPoolDelta = Partial<ManaPoolCounts>;
type ExileCardView = MageCardView & { exiledBy?: MageCardView };
type BattlefieldLayout = {
  roots: MageCardView[];
  attachmentsByHost: Map<string, MageCardView[]>;
};

const EVENT_LOG_LIMIT = 160;
const CHAT_LOG_LIMIT = 120;
const CARD_WIDTH = 76;
const HAND_CARD_WIDTH = 116;
const MY_HAND_VIEW_KEY = "__my_hand__";

type VisibleHandView = {
  key: string;
  label: string;
  shortLabel: string;
  cards: MageCardView[];
  isOwnHand: boolean;
};
const MAGE_CARD_DRAG_TYPE = "application/x-mage-card";
const PASS_UNTIL_NEXT_TURN_ACTION = "PASS_PRIORITY_UNTIL_NEXT_TURN_SKIP_STACK";

type MageCardDragPayload = {
  id: string;
  from: CardActionContext;
};

type OpponentDeckCandidate = {
  key: string;
  source: MageOpponentDeckSource;
  id: string;
  publicId?: string;
  name: string;
  format: string;
  cardCount: number;
  sideboardCount: number;
  deck?: Deck;
  officialSummary?: PublicDeckSummary;
};

type ResolvedOpponentDeck = {
  deck: Deck;
  candidate: OpponentDeckCandidate;
};

const STORED_MAGE_SESSION_PREFIX = "mtgdeckbuilder:mage-playtest:v1:";
const STORED_MAGE_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const DEFAULT_MAGE_OPPONENT_DECK_MODE: MageOpponentDeckMode = "current";
const OPPONENT_DECK_SEARCH_LIMIT = 24;
const OPPONENT_OFFICIAL_RANDOM_LIMIT = 80;
const CONSTRUCTED_FORMAT_ORDER = [
  "standard",
  "pioneer",
  "modern",
  "legacy",
  "vintage",
];

const initialSessionState: MageSessionState = {
  status: "idle",
  sessionId: null,
  gameId: null,
  playerId: null,
  spectator: false,
  gameView: null,
  prompt: null,
  events: [],
  chatId: null,
  chat: [],
  error: null,
  lastMessage: null,
  config: null,
};

const PRIORITY_ACTIONS = [
  { label: "Undo", action: "UNDO" },
];

const MANA_TYPES = [
  { label: "W", value: "WHITE" },
  { label: "U", value: "BLUE" },
  { label: "B", value: "BLACK" },
  { label: "R", value: "RED" },
  { label: "G", value: "GREEN" },
  { label: "C", value: "COLORLESS" },
];

const MANA_POOL_TYPES: Array<{
  label: string;
  key: keyof ManaPoolCounts;
  color: string;
}> = [
  { label: "W", key: "white", color: "var(--mana-w)" },
  { label: "U", key: "blue", color: "var(--mana-u)" },
  { label: "B", key: "black", color: "var(--mana-b)" },
  { label: "R", key: "red", color: "var(--mana-r)" },
  { label: "G", key: "green", color: "var(--mana-g)" },
  { label: "C", key: "colorless", color: "#d6d3d1" },
];

const MANA_SYMBOL_TO_POOL_KEY: Record<string, keyof ManaPoolCounts> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
  C: "colorless",
};

const MANA_TYPE_TO_POOL_KEY: Record<string, keyof ManaPoolCounts> = {
  WHITE: "white",
  BLUE: "blue",
  BLACK: "black",
  RED: "red",
  GREEN: "green",
  COLORLESS: "colorless",
};

const POOL_KEY_TO_MANA_TYPE: Record<keyof ManaPoolCounts, string> = {
  white: "WHITE",
  blue: "BLUE",
  black: "BLACK",
  red: "RED",
  green: "GREEN",
  colorless: "COLORLESS",
};

const BASIC_LAND_MANA: Record<string, ManaPoolDelta> = {
  plains: { white: 1 },
  island: { blue: 1 },
  swamp: { black: 1 },
  mountain: { red: 1 },
  forest: { green: 1 },
  wastes: { colorless: 1 },
};

type CardActionContext = "battlefield" | "hand" | "stack" | "zone" | "command";

type BoardContextValue = {
  register: (id: string, el: HTMLElement | null) => void;
  inspect: (card: MageCardView | null) => void;
  openContextMenu: (
    card: MageCardView,
    context: CardActionContext,
    x: number,
    y: number
  ) => void;
};

const BoardContext = createContext<BoardContextValue | null>(null);

type ZoneViewerState = {
  title: string;
  subtitle?: string;
  cards: MageCardView[];
};

type ContextMenuState = {
  card: MageCardView;
  context: CardActionContext;
  x: number;
  y: number;
};

type CombatRoles = {
  attackers: Set<string>;
  blockers: Set<string>;
  possibleAttackers: Set<string>;
  possibleBlockers: Set<string>;
};

// Turn structure for the phase track. Each entry groups a phase with its steps.
const PHASE_TRACK: Array<{ phase: string; label: string; steps: Array<{ key: string; label: string }> }> = [
  {
    phase: "BEGINNING",
    label: "Beginning",
    steps: [
      { key: "UNTAP", label: "Untap" },
      { key: "UPKEEP", label: "Upkeep" },
      { key: "DRAW", label: "Draw" },
    ],
  },
  {
    phase: "PRECOMBAT_MAIN",
    label: "Main 1",
    steps: [{ key: "PRECOMBAT_MAIN", label: "Main" }],
  },
  {
    phase: "COMBAT",
    label: "Combat",
    steps: [
      { key: "BEGIN_COMBAT", label: "Begin" },
      { key: "DECLARE_ATTACKERS", label: "Attack" },
      { key: "DECLARE_BLOCKERS", label: "Block" },
      { key: "COMBAT_DAMAGE", label: "Damage" },
      { key: "END_COMBAT", label: "End" },
    ],
  },
  {
    phase: "POSTCOMBAT_MAIN",
    label: "Main 2",
    steps: [{ key: "POSTCOMBAT_MAIN", label: "Main" }],
  },
  {
    phase: "END",
    label: "End",
    steps: [
      { key: "END_TURN", label: "End" },
      { key: "CLEANUP", label: "Cleanup" },
    ],
  },
];

type PhaseStepStyle = {
  text: string;
  textMuted: string;
  bg: string;
  ring: string;
  dot: string;
  dotRing: string;
  dotMuted: string;
  statBorder: string;
  statBg: string;
};

const DEFAULT_PHASE_STEP_STYLE: PhaseStepStyle = {
  text: "text-text",
  textMuted: "text-text-subtle",
  bg: "bg-surface-subtle",
  ring: "ring-border",
  dot: "bg-accent",
  dotRing: "ring-accent/30",
  dotMuted: "bg-text-subtle/50",
  statBorder: "border-border",
  statBg: "bg-white",
};

const PHASE_STEP_STYLES: Record<string, Partial<PhaseStepStyle>> = {
  BEGINNING: {
    text: "text-sky-800",
    textMuted: "text-sky-600",
    bg: "bg-sky-50",
    ring: "ring-sky-200",
    dot: "bg-sky-500",
    dotRing: "ring-sky-300/70",
    dotMuted: "bg-sky-300/70",
    statBorder: "border-sky-200",
    statBg: "bg-sky-50/80",
  },
  UNTAP: {
    text: "text-sky-700",
    textMuted: "text-sky-500",
    bg: "bg-sky-50",
    ring: "ring-sky-200",
    dot: "bg-sky-400",
    dotRing: "ring-sky-300/70",
    dotMuted: "bg-sky-200",
    statBorder: "border-sky-200",
    statBg: "bg-sky-50/80",
  },
  UPKEEP: {
    text: "text-sky-800",
    textMuted: "text-sky-600",
    bg: "bg-sky-50",
    ring: "ring-sky-200",
    dot: "bg-sky-500",
    dotRing: "ring-sky-300/70",
    dotMuted: "bg-sky-300/70",
    statBorder: "border-sky-200",
    statBg: "bg-sky-50/80",
  },
  DRAW: {
    text: "text-indigo-800",
    textMuted: "text-indigo-600",
    bg: "bg-indigo-50",
    ring: "ring-indigo-200",
    dot: "bg-indigo-500",
    dotRing: "ring-indigo-300/70",
    dotMuted: "bg-indigo-300/70",
    statBorder: "border-indigo-200",
    statBg: "bg-indigo-50/80",
  },
  PRECOMBAT_MAIN: {
    text: "text-emerald-800",
    textMuted: "text-emerald-600",
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    dot: "bg-emerald-500",
    dotRing: "ring-emerald-300/70",
    dotMuted: "bg-emerald-300/70",
    statBorder: "border-emerald-200",
    statBg: "bg-emerald-50/80",
  },
  COMBAT: {
    text: "text-amber-800",
    textMuted: "text-amber-700",
    bg: "bg-amber-50",
    ring: "ring-amber-200",
    dot: "bg-amber-500",
    dotRing: "ring-amber-300/70",
    dotMuted: "bg-amber-300/70",
    statBorder: "border-amber-200",
    statBg: "bg-amber-50/80",
  },
  BEGIN_COMBAT: {
    text: "text-amber-800",
    textMuted: "text-amber-600",
    bg: "bg-amber-50",
    ring: "ring-amber-200",
    dot: "bg-amber-500",
    dotRing: "ring-amber-300/70",
    dotMuted: "bg-amber-300/70",
    statBorder: "border-amber-200",
    statBg: "bg-amber-50/80",
  },
  DECLARE_ATTACKERS: {
    text: "text-red-700",
    textMuted: "text-red-600",
    bg: "bg-red-50",
    ring: "ring-red-300",
    dot: "bg-[color:var(--danger)]",
    dotRing: "ring-red-300/80",
    dotMuted: "bg-red-300/70",
    statBorder: "border-red-300",
    statBg: "bg-red-50/90",
  },
  DECLARE_BLOCKERS: {
    text: "text-blue-700",
    textMuted: "text-blue-600",
    bg: "bg-blue-50",
    ring: "ring-blue-300",
    dot: "bg-blue-600",
    dotRing: "ring-blue-300/80",
    dotMuted: "bg-blue-300/70",
    statBorder: "border-blue-300",
    statBg: "bg-blue-50/90",
  },
  COMBAT_DAMAGE: {
    text: "text-rose-800",
    textMuted: "text-rose-600",
    bg: "bg-rose-50",
    ring: "ring-rose-200",
    dot: "bg-rose-600",
    dotRing: "ring-rose-300/70",
    dotMuted: "bg-rose-300/70",
    statBorder: "border-rose-200",
    statBg: "bg-rose-50/80",
  },
  END_COMBAT: {
    text: "text-stone-700",
    textMuted: "text-stone-500",
    bg: "bg-stone-100",
    ring: "ring-stone-300",
    dot: "bg-stone-500",
    dotRing: "ring-stone-300/70",
    dotMuted: "bg-stone-300/70",
    statBorder: "border-stone-300",
    statBg: "bg-stone-50",
  },
  POSTCOMBAT_MAIN: {
    text: "text-teal-800",
    textMuted: "text-teal-600",
    bg: "bg-teal-50",
    ring: "ring-teal-200",
    dot: "bg-teal-500",
    dotRing: "ring-teal-300/70",
    dotMuted: "bg-teal-300/70",
    statBorder: "border-teal-200",
    statBg: "bg-teal-50/80",
  },
  END: {
    text: "text-violet-800",
    textMuted: "text-violet-600",
    bg: "bg-violet-50",
    ring: "ring-violet-200",
    dot: "bg-violet-500",
    dotRing: "ring-violet-300/70",
    dotMuted: "bg-violet-300/70",
    statBorder: "border-violet-200",
    statBg: "bg-violet-50/80",
  },
  END_TURN: {
    text: "text-violet-800",
    textMuted: "text-violet-600",
    bg: "bg-violet-50",
    ring: "ring-violet-200",
    dot: "bg-violet-500",
    dotRing: "ring-violet-300/70",
    dotMuted: "bg-violet-300/70",
    statBorder: "border-violet-200",
    statBg: "bg-violet-50/80",
  },
  CLEANUP: {
    text: "text-purple-800",
    textMuted: "text-purple-600",
    bg: "bg-purple-50",
    ring: "ring-purple-200",
    dot: "bg-purple-500",
    dotRing: "ring-purple-300/70",
    dotMuted: "bg-purple-300/70",
    statBorder: "border-purple-200",
    statBg: "bg-purple-50/80",
  },
};

function resolvePhaseStepStyle(phase: string, step: string): PhaseStepStyle {
  const stepStyle = PHASE_STEP_STYLES[step];
  const phaseStyle = PHASE_STEP_STYLES[phase];
  return {
    ...DEFAULT_PHASE_STEP_STYLE,
    ...phaseStyle,
    ...stepStyle,
  };
}

function phaseStepStyleForGame(game: MageGameView | null): PhaseStepStyle {
  const { phase, step } = activeStepKeys(game);
  return resolvePhaseStepStyle(phase, step);
}

function stepStyleForKey(stepKey: string, phaseKey: string): PhaseStepStyle {
  return resolvePhaseStepStyle(phaseKey, stepKey);
}

// Skip / priority shortcuts mapped to MAGE PlayerAction enum values.
const SKIP_ACTIONS: Array<{ action: string; label: string; title: string }> = [
  {
    action: "PASS_PRIORITY_UNTIL_TURN_END_STEP",
    label: "End of turn",
    title: "Pass priority until the end step (F5)",
  },
  {
    action: "PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE",
    label: "Next main",
    title: "Pass priority until the next main phase (F6)",
  },
  {
    action: "PASS_PRIORITY_UNTIL_MY_NEXT_TURN",
    label: "My turn",
    title: "Pass priority until my next turn (F9)",
  },
  {
    action: "PASS_PRIORITY_UNTIL_STACK_RESOLVED",
    label: "Stack resolves",
    title: "Pass priority until the stack resolves (F8)",
  },
  {
    action: "PASS_PRIORITY_UNTIL_END_STEP_BEFORE_MY_NEXT_TURN",
    label: "Before my turn",
    title: "Pass priority until the end step before my next turn (F11)",
  },
  {
    action: "PASS_PRIORITY_CANCEL_ALL_ACTIONS",
    label: "Stop skipping",
    title: "Cancel all queued skip actions (F3)",
  },
];

const NOTABLE_COUNTER_STYLES: Record<string, string> = {
  poison: "border-emerald-300 bg-emerald-50 text-emerald-700",
  energy: "border-amber-300 bg-amber-50 text-amber-700",
  experience: "border-violet-300 bg-violet-50 text-violet-700",
  rad: "border-lime-300 bg-lime-50 text-lime-700",
  ticket: "border-sky-300 bg-sky-50 text-sky-700",
};
const CARD_IMAGE_LOOKUP_BATCH_SIZE = 16;

export function MagePlaytest({
  deck,
  initialGameId,
  returnHref,
  manualFallback,
}: {
  deck: Deck;
  initialGameId?: string;
  returnHref: string;
  manualFallback?: ReactNode;
}) {
  const session = useMagePlaytest(deck, initialGameId);
  const convex = useConvex();
  const opponentDecksResult = useQuery(api.decks.listDecksFull, {});
  const [showManualFallback, setShowManualFallback] = useState(false);
  const [setupOpen, setSetupOpen] = useState(true);
  const [setupOpenedByUser, setSetupOpenedByUser] = useState(false);
  const [lastConfig, setLastConfig] = useState<MagePlaytestConfig | null>(null);
  const [gatewayHealth, setGatewayHealth] = useState<GatewayHealth>("checking");
  const [gatewayStats, setGatewayStats] = useState<GatewayStats | null>(null);
  const [eventLogOpen, setEventLogOpen] = useState(false);
  const [confirmPassTurnKey, setConfirmPassTurnKey] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [toast, setToast] = useState<PlaytestToastState | null>(null);
  const [inspectCard, setInspectCard] = useState<MageCardView | null>(null);
  const [zoneViewer, setZoneViewer] = useState<ZoneViewerState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [opponentImageDeck, setOpponentImageDeck] = useState<Deck | null>(null);
  const [resolvedCardImages, setResolvedCardImages] = useState<Map<string, CardImage>>(
    () => new Map()
  );
  const [cardImageLookupCycle, setCardImageLookupCycle] = useState(0);
  const [gameEndDismissedKey, setGameEndDismissedKey] = useState<string | null>(null);
  const [handViewKey, setHandViewKey] = useState(MY_HAND_VIEW_KEY);
  const prevOpponentHandKeysRef = useRef("");
  const pendingCardImageNamesRef = useRef<Set<string>>(new Set());
  const failedCardImageNamesRef = useRef<Set<string>>(new Set());
  const cardImageLookupMountedRef = useRef(true);
  const toastIdRef = useRef(0);
  const boardRef = useRef<HTMLElement | null>(null);
  const cardElementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const [combatTick, setCombatTick] = useState(0);
  const finePointer = useFinePointer();
  const opponentDecksLoaded = opponentDecksResult !== undefined;
  const opponentDecks = useMemo(
    () =>
      (opponentDecksResult ?? []).filter(
        (candidate) => candidate.id === deck.id || deckCardCount(candidate) > 0
      ),
    [deck.id, opponentDecksResult]
  );
  const deckImageByName = useMemo(
    () => buildDeckImageMap(deck, opponentImageDeck),
    [deck, opponentImageDeck]
  );
  const imageByName = useMemo(
    () => mergeImageMaps(deckImageByName, resolvedCardImages),
    [deckImageByName, resolvedCardImages]
  );
  const game = session.gameView;
  const activeSession =
    session.status === "starting" ||
    session.status === "connecting" ||
    session.status === "connected";
  const effectiveLastConfig = lastConfig ?? session.config;
  const setupVisible =
    (setupOpen && (!activeSession || setupOpenedByUser)) ||
    (session.status === "idle" && !session.sessionId && !showManualFallback);
  const players = useMemo(() => game?.players ?? [], [game?.players]);
  const self =
    players.find((player) => player.controlled) ??
    players.find((player) => player.playerId === session.playerId) ??
    players[0];
  const opponent =
    players.find((player) => player !== self && !player.controlled) ??
    players.find((player) => player !== self);
  const handGameView = useMemo(
    () => gameViewForHands(game, session.prompt?.gameView),
    [game, session.prompt?.gameView]
  );
  const visibleHands = useMemo(
    () =>
      collectVisibleHands(handGameView, {
        spectator: session.spectator,
        selfName: self?.name,
      }),
    [handGameView, session.spectator, self?.name]
  );
  const opponentHandSignature = useMemo(
    () =>
      visibleHands
        .filter((hand) => !hand.isOwnHand)
        .map((hand) => hand.key)
        .sort()
        .join("|"),
    [visibleHands]
  );
  const effectiveHandViewKey = visibleHands.some((hand) => hand.key === handViewKey)
    ? handViewKey
    : (visibleHands.find((hand) => !hand.isOwnHand)?.key ??
      visibleHands[0]?.key ??
      MY_HAND_VIEW_KEY);
  const activeHand =
    visibleHands.find((hand) => hand.key === effectiveHandViewKey) ?? visibleHands[0];
  const interactiveIds = useMemo(
    () => collectInteractiveIds(session.prompt, game),
    [session.prompt, game]
  );
  const promptChoiceZones = useMemo(
    () => collectPromptChoiceZones(session.prompt, game),
    [session.prompt, game]
  );
  const selectablePlayers = useMemo(
    () => collectSelectablePlayers(session.prompt, players),
    [session.prompt, players]
  );
  const selectablePlayerIds = useMemo(
    () =>
      new Set(
        selectablePlayers
          .map((player) => player.playerId)
          .filter((id): id is string => !!id)
      ),
    [selectablePlayers]
  );
  const playableIds = useMemo(() => collectPlayableIds(game), [game]);
  const payingMana =
    session.prompt?.callbackMethod === "GAME_PLAY_MANA" ||
    session.prompt?.callbackMethod === "GAME_PLAY_XMANA";
  const manaPaymentTotal = useManaPaymentTotal(session.prompt);
  const canChooseCards = isCardChoicePrompt(session.prompt);
  const stackCards = cardsFromView(game?.stack);
  const stackTargetIds = useMemo(() => collectStackTargetIds(stackCards), [stackCards]);
  const promptSelectedTargetIds = useMemo(
    () => collectChosenTargetIds(session.prompt),
    [session.prompt]
  );
  const visibleTargetedIds = useMemo(
    () => unionIdSets(stackTargetIds, promptSelectedTargetIds),
    [stackTargetIds, promptSelectedTargetIds]
  );
  const stackSourceIds = useMemo(() => collectCardIds(stackCards), [stackCards]);
  const exileCards = useMemo(
    () => cardsFromExileZones(game?.exile, players),
    [game?.exile, players]
  );
  const visibleCardImageNames = useMemo(
    () => collectVisibleCardImageNames(game, players, visibleHands, session.prompt),
    [game, players, session.prompt, visibleHands]
  );
  const canAct = session.status === "connected" && !session.spectator;
  const selfManaPool = manaPoolFromView(self?.manaPool);
  const passWouldEndTurn = canAct && isSelfActivePlayer(self, game);
  const activeTurnKey = game
    ? `${game.turn ?? "unknown"}:${game.activePlayerId ?? game.activePlayerName ?? "unknown"}`
    : "";
  const confirmPassOpen =
    confirmPassTurnKey !== null &&
    passWouldEndTurn &&
    confirmPassTurnKey === activeTurnKey;
  const combatGroups = useMemo(() => combatGroupsFromView(game), [game]);
  const combatRoles = useMemo(
    () => collectCombatRoles(game, session.prompt),
    [game, session.prompt]
  );
  const combatActive = combatGroups.length > 0;
  const gameOver = session.prompt?.type === "gameOver";
  const gameEndKey = `${session.sessionId ?? ""}:${session.prompt?.messageId ?? session.prompt?.sequence ?? ""}`;
  const gameEndOpen = gameOver && gameEndDismissedKey !== gameEndKey;

  const getPublicOpponentDeck = useCallback(
    (publicId: string) =>
      convex.query(api.decks.getPublicDeck, { publicId }) as Promise<PublicDeck | null>,
    [convex]
  );
  const getOfficialRandomOpponentDecks = useCallback(
    async () => {
      const decks: PublicDeckSummary[] = [];
      const pageSize = OPPONENT_OFFICIAL_RANDOM_LIMIT;
      for (let page = 1; page <= 80; page += 1) {
        const pageResult = await convex.query(api.decks.searchPublicDeckPage, {
          query: "",
          limit: pageSize,
          page,
          source: "official" as const,
        });
        decks.push(...pageResult.decks);
        if (!pageResult.hasNextPage || pageResult.decks.length < pageSize) {
          break;
        }
      }

      return decks;
    },
    [convex]
  );

  const notify = useCallback((message: string) => {
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, message });
  }, []);

  const onHover = useCallback((src: string | undefined, x: number, y: number) => {
    setHover(src ? { src, x, y } : null);
  }, []);

  const registerCardElement = useCallback(
    (id: string, el: HTMLElement | null) => {
      const map = cardElementsRef.current;
      if (el) {
        map.set(id, el);
      } else {
        map.delete(id);
      }
      setCombatTick((tick) => tick + 1);
    },
    []
  );

  const inspect = useCallback((card: MageCardView | null) => {
    setInspectCard((current) => {
      if (card === null) return current;
      if (current && current.id && card.id && current.id === card.id) return current;
      return card;
    });
  }, []);

  const openContextMenu = useCallback(
    (card: MageCardView, context: CardActionContext, x: number, y: number) => {
      setContextMenu({ card, context, x, y });
    },
    []
  );

  const boardContext = useMemo<BoardContextValue>(
    () => ({ register: registerCardElement, inspect, openContextMenu }),
    [registerCardElement, inspect, openContextMenu]
  );

  const imageFor = useCallback(
    (card: MageCardView) => imageForMageCard(card, imageByName),
    [imageByName]
  );

  const chooseCard = useCallback(
    (card: MageCardView): boolean => {
      const id = card.id;
      if (!id) {
        notify("MAGE did not provide an id for that card.");
        return false;
      }
      if (
        canChooseCards &&
        interactiveIds.size > 0 &&
        !idInInteractiveSet(interactiveIds, id)
      ) {
        notify(`${cardName(card)} is not a valid choice for this prompt.`);
        return false;
      }
      session.chooseUuid(id);
      return true;
    },
    [canChooseCards, interactiveIds, notify, session]
  );

  const choosePlayer = useCallback(
    (playerId: string) => {
      if (session.status !== "connected") {
        notify("Start a MAGE game before choosing a player.");
        return;
      }
      if (session.spectator) {
        notify("Spectators cannot make game choices.");
        return;
      }
      if (!idInInteractiveSet(selectablePlayerIds, playerId)) {
        notify("That player is not a valid choice for this prompt.");
        return;
      }
      session.chooseUuid(playerId);
    },
    [notify, selectablePlayerIds, session]
  );

  const chooseSelfBattlefieldCard = useCallback(
    (card: MageCardView) => {
      const chosen = chooseCard(card);
      if (!chosen || payingMana) return;
      const mana = manaProducedByActivation(card, session.prompt);
      if (mana) session.addManaToPool(mana);
    },
    [chooseCard, payingMana, session]
  );

  const spendMana = useCallback(
    (manaType: string) => {
      if (!payingMana) {
        notify(
          "Play a spell or ability first. When the game asks you to pay mana, click the colors in the Mana bar (top right) or use the prompt buttons."
        );
        return;
      }
      const produced = manaDeltaFromManaType(manaType);
      if (produced) {
        const spent: ManaPoolDelta = {};
        for (const key of Object.keys(produced) as Array<keyof ManaPoolCounts>) {
          const amount = numericMana(produced[key]);
          if (amount > 0) spent[key] = -amount;
        }
        if (hasManaDelta(spent)) session.addManaToPool(spent);
      }
      session.chooseManaType(manaType);
    },
    [notify, payingMana, session]
  );

  const notifyBlockedCard = useCallback(
    (card: MageCardView) => {
      const name = cardName(card);
      if (session.status !== "connected") {
        notify("Start a MAGE game before choosing cards.");
      } else if (session.spectator) {
        notify("Spectators cannot make game choices.");
      } else if (canChooseCards) {
        notify(`${name} is not a valid choice for this prompt.`);
      } else {
        notify(
          `${name} is not playable right now. With priority, playable cards show a green outline — tap lands for mana, then click mana in the header to pay costs.`
        );
      }
    },
    [canChooseCards, notify, session.spectator, session.status]
  );

  useEffect(() => {
    cardImageLookupMountedRef.current = true;
    return () => {
      cardImageLookupMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const pending = pendingCardImageNamesRef.current;
    const failed = failedCardImageNamesRef.current;
    const namesToResolve: string[] = [];

    for (const name of visibleCardImageNames) {
      const key = normalizeName(name);
      if (
        !key ||
        imageByName.has(key) ||
        pending.has(key) ||
        failed.has(key) ||
        isUnknownCardImageName(key)
      ) {
        continue;
      }
      pending.add(key);
      namesToResolve.push(name);
      if (namesToResolve.length >= CARD_IMAGE_LOOKUP_BATCH_SIZE) break;
    }

    if (namesToResolve.length === 0) return;

    Promise.allSettled(
      namesToResolve.map(async (query) => ({
        query,
        card: await getCardByName(query),
      }))
    ).then((results) => {
      const additions: Array<{ names: string[]; image: CardImage }> = [];

      for (const [index, result] of results.entries()) {
        const query =
          result.status === "fulfilled" ? result.value.query : namesToResolve[index];
        const queryKey = query ? normalizeName(query) : "";
        if (!queryKey) continue;
        pending.delete(queryKey);
        if (result.status === "rejected") {
          failed.add(queryKey);
          continue;
        }
        const card = result.value.card;
        const image = card ? imageFromScryfallCard(card) : null;
        if (!card || !image || (!image.normal && !image.small)) {
          failed.add(queryKey);
          continue;
        }
        additions.push({
          names: [result.value.query, ...scryfallCardImageLookupNames(card)],
          image,
        });
      }

      if (!cardImageLookupMountedRef.current) return;

      if (additions.length > 0) {
        setResolvedCardImages((current) => {
          let changed = false;
          const next = new Map(current);
          for (const addition of additions) {
            for (const name of addition.names) {
              const key = normalizeName(name);
              if (!key || next.has(key)) continue;
              next.set(key, addition.image);
              changed = true;
            }
          }
          return changed ? next : current;
        });
      }

      setCardImageLookupCycle((cycle) => cycle + 1);
    });
  }, [cardImageLookupCycle, imageByName, visibleCardImageNames]);

  useEffect(() => {
    if (!opponentHandSignature) {
      prevOpponentHandKeysRef.current = "";
      if (handViewKey !== MY_HAND_VIEW_KEY) {
        const timer = window.setTimeout(() => {
          setHandViewKey(MY_HAND_VIEW_KEY);
        }, 0);
        return () => window.clearTimeout(timer);
      }
      return;
    }
    const previous = prevOpponentHandKeysRef.current;
    prevOpponentHandKeysRef.current = opponentHandSignature;
    const activeStillVisible = visibleHands.some((hand) => hand.key === handViewKey);
    if (!previous) {
      const revealedHand = visibleHands.find((hand) => !hand.isOwnHand);
      if (revealedHand) {
        const timer = window.setTimeout(() => {
          setHandViewKey(revealedHand.key);
        }, 0);
        return () => window.clearTimeout(timer);
      }
      return;
    }
    if (!activeStillVisible) {
      const revealedHand = visibleHands.find((hand) => !hand.isOwnHand);
      const nextHandViewKey = revealedHand?.key ?? MY_HAND_VIEW_KEY;
      const timer = window.setTimeout(() => {
        setHandViewKey(nextHandViewKey);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [handViewKey, opponentHandSignature, visibleHands]);

  useEffect(() => {
    const config = session.config;
    const opponentDeckMode =
      config?.opponentType === "ai"
        ? config.opponentDeckMode ?? DEFAULT_MAGE_OPPONENT_DECK_MODE
        : DEFAULT_MAGE_OPPONENT_DECK_MODE;
    if (!config || opponentDeckMode === "current") {
      const timer = window.setTimeout(() => {
        setOpponentImageDeck(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (config.opponentDeckSource !== "official" && !opponentDecksLoaded) return;

    let cancelled = false;
    resolveConfiguredOpponentDeck(
      config,
      opponentDecks,
      deck.id,
      getPublicOpponentDeck,
      getOfficialRandomOpponentDecks
    )
      .then((resolvedOpponent) => {
        if (!cancelled) setOpponentImageDeck(resolvedOpponent?.deck ?? null);
      })
      .catch(() => {
        if (!cancelled) setOpponentImageDeck(null);
      });

    return () => {
      cancelled = true;
    };
  }, [
    deck.id,
    getOfficialRandomOpponentDecks,
    getPublicOpponentDeck,
    opponentDecks,
    opponentDecksLoaded,
    session.config,
  ]);

  useEffect(() => {
    let cancelled = false;
    let abort: AbortController | null = null;
    const checkGatewayHealth = () => {
      abort?.abort();
      abort = new AbortController();
      fetch(mageGatewayHealthUrl(), {
        cache: "no-store",
        signal: abort.signal,
      })
        .then(async (response) => {
          const stats = await readGatewayStats(response);
          if (cancelled) return;
          setGatewayHealth(response.ok ? "online" : "offline");
          setGatewayStats(response.ok ? stats : null);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (cancelled) return;
          setGatewayHealth("offline");
          setGatewayStats(null);
        });
    };
    checkGatewayHealth();
    const interval = window.setInterval(checkGatewayHealth, 5000);
    return () => {
      cancelled = true;
      abort?.abort();
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!eventLogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEventLogOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [eventLogOpen]);

  useEffect(() => {
    if (!confirmPassOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirmPassTurnKey(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmPassOpen]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const latest = session.events.at(-1);
    if (latest?.type !== "error") return;
    const message = plainMageText(latest.message ?? eventSummary(latest));
    if (message) notify(message);
  }, [notify, session.events]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!combatActive) return;
    const bump = () => setCombatTick((tick) => tick + 1);
    window.addEventListener("resize", bump);
    window.addEventListener("scroll", bump, true);
    return () => {
      window.removeEventListener("resize", bump);
      window.removeEventListener("scroll", bump, true);
    };
  }, [combatActive]);

  const startWithConfig = useCallback(
    async (inputConfig: MagePlaytestConfig) => {
      const requestedConfig = normalizedMagePlaytestConfig(
        rerollableMagePlaytestConfig(inputConfig)
      );
      const requestedServer = mageServerOption(
        effectiveMageServerId(requestedConfig)
      );
      if (requestedConfig.opponentType === "ai" && !requestedServer.ai) {
        notify(
          "No playable AI server is configured. Choose Real Player or connect the gateway to an AI-enabled MAGE server."
        );
        setSetupOpenedByUser(true);
        setSetupOpen(true);
        return;
      }
      const resolvedOpponent = await resolveConfiguredOpponentDeck(
        requestedConfig,
        opponentDecks,
        deck.id,
        getPublicOpponentDeck,
        getOfficialRandomOpponentDecks
      );
      const opponentDeck = resolvedOpponent?.deck ?? null;
      const opponentDeckMode =
        requestedConfig.opponentType === "ai"
          ? requestedConfig.opponentDeckMode ?? DEFAULT_MAGE_OPPONENT_DECK_MODE
          : DEFAULT_MAGE_OPPONENT_DECK_MODE;
      if (
        requestedConfig.opponentType === "ai" &&
        opponentDeckMode !== "current" &&
        !opponentDeck
      ) {
        notify("Choose an AI deck or switch the AI deck back to Current.");
        setSetupOpenedByUser(true);
        setSetupOpen(true);
        return;
      }
      if (
        requestedConfig.opponentType === "ai" &&
        opponentDeckMode !== "current" &&
        opponentDeck &&
        !isCompatibleOpponentDeck(
          savedOpponentDeckCandidate(opponentDeck),
          requestedConfig.gameMode
        )
      ) {
        notify(
          `${opponentDeck.name} is not compatible with ${mageGameModeLabel(
            requestedConfig.gameMode
          )}. Choose another AI deck.`
        );
        setSetupOpenedByUser(true);
        setSetupOpen(true);
        return;
      }
      setOpponentImageDeck(opponentDeckMode === "current" ? null : opponentDeck);
      const config: MagePlaytestConfig = {
        ...requestedConfig,
        mageServerId: effectiveMageServerId(requestedConfig),
        opponentDeckMode,
        opponentDeckSource:
          opponentDeckMode === "current"
            ? null
            : resolvedOpponent?.candidate.source ??
              requestedConfig.opponentDeckSource ??
              "saved",
        opponentDeckId:
          opponentDeckMode === "current"
            ? null
            : resolvedOpponent?.candidate.source === "saved"
              ? resolvedOpponent.candidate.id
              : null,
        opponentDeckPublicId:
          opponentDeckMode === "current"
            ? null
            : resolvedOpponent?.candidate.source === "official"
              ? resolvedOpponent.candidate.publicId ?? null
              : null,
        opponentDeckName:
          opponentDeckMode === "current" ? deck.name : opponentDeck?.name ?? null,
      };
      setLastConfig(rerollableMagePlaytestConfig(config));
      setSetupOpen(false);
      setSetupOpenedByUser(false);
      void session.start(config, opponentDeck ?? undefined);
    },
    [
      deck.id,
      deck.name,
      getOfficialRandomOpponentDecks,
      getPublicOpponentDeck,
      notify,
      opponentDecks,
      session,
    ]
  );

  const restart = useCallback(() => {
    if (effectiveLastConfig) {
      void startWithConfig(rerollableMagePlaytestConfig(effectiveLastConfig));
      return;
    }
    setSetupOpenedByUser(true);
    setSetupOpen(true);
  }, [effectiveLastConfig, startWithConfig]);

  const requestPassUntilNextTurn = useCallback(() => {
    if (passWouldEndTurn) {
      setConfirmPassTurnKey(activeTurnKey);
      return;
    }
    session.passUntilNextTurn();
  }, [activeTurnKey, passWouldEndTurn, session]);

  const confirmPassUntilNextTurn = useCallback(() => {
    setConfirmPassTurnKey(null);
    session.passUntilNextTurn();
  }, [session]);

  if (showManualFallback && manualFallback) {
    return <>{manualFallback}</>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg">
      <header
        className="soft-divider shrink-0 bg-surface-raised px-3 py-2"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={returnHref}
              className="control flex items-center gap-2 px-3 py-2 text-sm"
            >
              <AppIcon size={20} className="rounded-md" />
              Builder
            </Link>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{deck.name}</div>
              <div className="truncate text-xs text-text-subtle">
                MAGE gateway {mageGatewayBaseUrl()}
              </div>
            </div>
            <GatewayHealthPill
              health={gatewayHealth}
              stats={gatewayStats}
              showPopulation={session.config?.opponentType === "human"}
            />
            <StatusPill status={session.status} error={session.error} />
            {session.spectator && (
              <span className="shrink-0 rounded-full border border-border bg-white px-2.5 py-1 text-[11px] font-semibold text-text-muted">
                spectator
              </span>
            )}
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <GameStat label="Turn" value={formatTurn(game)} />
            <PhaseStepStat game={game} />
            <TurnOwnerPill self={self} game={game} />
            <GameStat label="Active" value={game?.activePlayerName || "—"} />
            <GameStat label="Priority" value={game?.priorityPlayerName || "—"} />
            <GameStat label="You ELO" value={formatPlayerRating(self)} />
            <GameStat label="Opp ELO" value={formatPlayerRating(opponent)} />
            <ManaPoolStat
              pool={selfManaPool}
              payingMana={payingMana}
              canAct={canAct}
              onSpend={spendMana}
              onBlocked={notify}
            />
          </div>
        </div>

        <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <ActionButton
              disabled={!canAct}
              disabledReason={
                session.spectator
                  ? "Spectators cannot pass priority."
                  : "Connect to MAGE before passing priority."
              }
              onBlocked={notify}
              onClick={requestPassUntilNextTurn}
            >
              Pass
            </ActionButton>
            {PRIORITY_ACTIONS.map((item) => (
              <ActionButton
                key={item.action}
                disabled={!canAct}
                disabledReason={
                  session.spectator
                    ? "Spectators cannot use game actions."
                    : "Connect to MAGE before using game actions."
                }
                onBlocked={notify}
                onClick={() => session.playerAction(item.action)}
              >
                {item.label}
              </ActionButton>
            ))}
            <SkipActionsMenu
              disabled={!canAct}
              disabledReason={
                session.spectator
                  ? "Spectators cannot use game actions."
                  : "Connect to MAGE before using game actions."
              }
              onBlocked={notify}
              onAction={(action) => session.playerAction(action)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <ActionButton
              disabled={session.status === "starting" || session.status === "connecting"}
              disabledReason="MAGE is already starting."
              onBlocked={notify}
              onClick={restart}
            >
              {session.sessionId ? "Restart" : "Start"}
            </ActionButton>
            <ActionButton
              disabled={session.status === "starting" || session.status === "connecting"}
              disabledReason="Wait for MAGE to finish starting before changing setup."
              onBlocked={notify}
              onClick={() => {
                setSetupOpenedByUser(true);
                setSetupOpen(true);
              }}
            >
              Setup
            </ActionButton>
            <ActionButton
              danger
              disabled={!canAct}
              disabledReason={
                session.spectator
                  ? "Spectators cannot concede."
                  : "Connect to MAGE before conceding."
              }
              onBlocked={notify}
              onClick={session.concede}
            >
              Concede
            </ActionButton>
            <ActionButton
              disabled={session.status !== "connected"}
              disabledReason="There is no connected MAGE session to disconnect."
              onBlocked={notify}
              onClick={session.disconnect}
            >
              Disconnect
            </ActionButton>
            {manualFallback && (
              <ActionButton onClick={() => setShowManualFallback(true)}>
                Manual Table
              </ActionButton>
            )}
          </div>
        </div>

        <PhaseTrack game={game} self={self} />
      </header>

      <BoardContext value={boardContext}>
        <main
          ref={boardRef}
          className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(17rem,20rem)] grid-rows-[minmax(0,1fr)_12.5rem] gap-2 overflow-hidden p-2"
        >
          <section className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-2 overflow-hidden">
            <PlayerZone
              label="Opponent"
              player={opponent}
              compact
              combatRoles={combatRoles}
              playableIds={playableIds}
              imageFor={imageFor}
              interactiveIds={interactiveIds}
              selectablePlayerIds={selectablePlayerIds}
              targetedIds={visibleTargetedIds}
              castingIds={stackSourceIds}
              canChooseCards={canChooseCards}
              spectator={session.spectator}
              onCardActivate={chooseCard}
              onPlayerSelect={choosePlayer}
              onBlocked={notifyBlockedCard}
              onHover={onHover}
              onOpenZone={setZoneViewer}
            />

            <PlayerZone
              label="You"
              player={self}
              combatRoles={combatRoles}
              playableIds={playableIds}
              acceptsHandDrops
              imageFor={imageFor}
              interactiveIds={interactiveIds}
              selectablePlayerIds={selectablePlayerIds}
              targetedIds={visibleTargetedIds}
              castingIds={stackSourceIds}
              canChooseCards={canChooseCards}
              spectator={session.spectator}
              onCardActivate={chooseSelfBattlefieldCard}
              onPlayerSelect={choosePlayer}
              onPlayCardFromHand={(card) => {
                const id = card.id;
                if (!id || !idInInteractiveSet(playableIds, id)) {
                  notifyBlockedCard(card);
                  return false;
                }
                const played = chooseCard(card);
                if (!played) notifyBlockedCard(card);
                return played;
              }}
              onBlocked={notifyBlockedCard}
              onHover={onHover}
              onOpenZone={setZoneViewer}
            />
          </section>

          <aside className="workspace-panel row-span-2 flex min-h-0 flex-col gap-2 overflow-hidden rounded-lg bg-surface p-2">
            <PromptPanel
              session={session}
              game={game}
              imageFor={imageFor}
              manaPool={selfManaPool}
              manaPaymentTotal={manaPaymentTotal}
              canAct={canAct}
              selectablePlayers={selectablePlayers}
              promptChoiceZones={promptChoiceZones}
              interactiveIds={interactiveIds}
              selectedIds={promptSelectedTargetIds}
              onSpendMana={spendMana}
              onChoosePlayer={choosePlayer}
              onChooseCard={chooseCard}
              onBlocked={notify}
              onPassUntilNextTurn={requestPassUntilNextTurn}
            />
            <div className="thin-scroll flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-0.5">
              <BigCardPanel card={inspectCard} imageFor={imageFor} />
              {combatActive && (
                <CombatSummaryPanel
                  groups={combatGroups}
                  players={players}
                  imageFor={imageFor}
                />
              )}
              <StackZone
                cards={stackCards}
                imageFor={imageFor}
                interactiveIds={interactiveIds}
                playableIds={playableIds}
                targetedIds={visibleTargetedIds}
                castingIds={stackSourceIds}
                canChooseCards={canChooseCards}
                spectator={session.spectator}
                onCardActivate={chooseCard}
                onBlocked={notifyBlockedCard}
                onHover={onHover}
              />
              <ExileZone
                cards={exileCards}
                imageFor={imageFor}
                interactiveIds={interactiveIds}
                playableIds={playableIds}
                targetedIds={visibleTargetedIds}
                castingIds={stackSourceIds}
                canChooseCards={canChooseCards}
                spectator={session.spectator}
                onCardActivate={chooseCard}
                onBlocked={notifyBlockedCard}
                onHover={onHover}
              />
              <SharedZonesPanel game={game} onOpenZone={setZoneViewer} />
              <GameChatPanel
                messages={session.chat}
                canSend={
                  session.status === "connected" &&
                  !session.spectator &&
                  !!session.chatId
                }
                onSend={session.sendChatMessage}
              />
            </div>
            <EventLogButton
              eventCount={session.events.length}
              onOpen={() => setEventLogOpen(true)}
            />
          </aside>

          <HandZone
            hands={visibleHands}
            activeHandKey={effectiveHandViewKey}
            onActiveHandChange={setHandViewKey}
            status={session.status}
            imageFor={imageFor}
            interactiveIds={interactiveIds}
            playableIds={playableIds}
            targetedIds={visibleTargetedIds}
            castingIds={stackSourceIds}
            canChooseCards={canChooseCards}
            spectator={session.spectator}
            onCardActivate={chooseCard}
            onBlocked={notifyBlockedCard}
            onHover={onHover}
          />

          <CombatArrowsOverlay
            containerRef={boardRef}
            cardElementsRef={cardElementsRef}
            groups={combatGroups}
            tick={combatTick}
          />
        </main>
      </BoardContext>

      <EventLogPopup
        open={eventLogOpen}
        onClose={() => setEventLogOpen(false)}
        events={session.events}
      />

      <ZoneViewerDialog
        state={zoneViewer}
        imageFor={imageFor}
        onClose={() => setZoneViewer(null)}
        onHover={onHover}
      />

      <CardContextMenu
        state={contextMenu}
        imageFor={imageFor}
        onClose={() => setContextMenu(null)}
        onInspect={(card) => {
          setInspectCard(card);
          setContextMenu(null);
        }}
      />

      <GameEndDialog
        open={gameEndOpen}
        message={plainMageText(session.prompt?.message)}
        onClose={() => setGameEndDismissedKey(gameEndKey)}
        onRematch={() => {
          setGameEndDismissedKey(gameEndKey);
          restart();
        }}
      />

      <PlaytestToastOverlay toast={toast} onClose={() => setToast(null)} />

      <ConfirmPassTurnDialog
        open={confirmPassOpen}
        onCancel={() => setConfirmPassTurnKey(null)}
        onConfirm={confirmPassUntilNextTurn}
      />

      <CardHover
        src={hover?.src}
        x={hover?.x ?? 0}
        y={hover?.y ?? 0}
        visible={finePointer && !!hover?.src}
      />

      {setupVisible && (
        <PlaytestSetupDialog
          deck={deck}
          gatewayHealth={gatewayHealth}
          gatewayStats={gatewayStats}
          starting={session.status === "starting" || session.status === "connecting"}
          initialConfig={
            effectiveLastConfig
              ? normalizedMagePlaytestConfig(
                  rerollableMagePlaytestConfig(effectiveLastConfig)
                )
              : null
          }
          opponentDecks={opponentDecks}
          opponentDecksLoaded={opponentDecksLoaded}
          onStart={startWithConfig}
          onClose={
            session.sessionId || showManualFallback
              ? () => {
                  setSetupOpen(false);
                  setSetupOpenedByUser(false);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

type ValidationState =
  | { status: "checking"; gameMode: MageGameMode }
  | { status: "ready"; gameMode: MageGameMode; result: MageDeckValidation }
  | { status: "invalid"; gameMode: MageGameMode; result: MageDeckValidation }
  | { status: "error"; gameMode: MageGameMode; message: string };

function PlaytestSetupDialog({
  deck,
  gatewayHealth,
  gatewayStats,
  starting,
  initialConfig,
  opponentDecks,
  opponentDecksLoaded,
  onStart,
  onClose,
}: {
  deck: Deck;
  gatewayHealth: GatewayHealth;
  gatewayStats: GatewayStats | null;
  starting: boolean;
  initialConfig: MagePlaytestConfig | null;
  opponentDecks: Deck[];
  opponentDecksLoaded: boolean;
  onStart: (config: MagePlaytestConfig) => void;
  onClose?: () => void;
}) {
  const convex = useConvex();
  const initialOpponentType = initialConfig?.opponentType ?? "ai";
  const [opponentType, setOpponentType] = useState<MageOpponentType>(
    initialOpponentType
  );
  const [mageServerId, setMageServerId] = useState<MageServerId>(() =>
    initialOpponentType === "ai"
      ? effectiveMageServerId({
          opponentType: "ai",
          mageServerId: initialConfig?.mageServerId,
        })
      : defaultMageServerId(initialConfig?.mageServerId)
  );
  const [gameMode, setGameMode] = useState<MageGameMode>(
    initialConfig?.gameMode ?? defaultMageGameMode(deck.format)
  );
  const [ai, setAi] = useState<MagePlaytestConfig["ai"]>(
    defaultMageAiType(initialConfig?.ai)
  );
  const [playerRating, setPlayerRating] = useState<number>(() =>
    defaultMagePlayerRating(initialConfig?.playerRating)
  );
  const [opponentDeckMode, setOpponentDeckMode] = useState<MageOpponentDeckMode>(
    initialConfig?.opponentDeckMode ?? DEFAULT_MAGE_OPPONENT_DECK_MODE
  );
  const [selectedOpponentDeckKey, setSelectedOpponentDeckKey] = useState<
    string | null
  >(() => initialOpponentDeckCandidateKey(initialConfig, deck.id));
  const [includeOfficialOpponentDecks, setIncludeOfficialOpponentDecks] = useState(
    initialConfig?.includeOfficialOpponentDecks ?? false
  );
  const [opponentDeckSearch, setOpponentDeckSearch] = useState("");
  const [validation, setValidation] = useState<ValidationState>({
    status: "checking",
    gameMode,
  });
  const officialSearchResults = useQuery(
    api.decks.searchPublicDecks,
    includeOfficialOpponentDecks
      ? {
          query: opponentDeckSearch,
          limit: OPPONENT_DECK_SEARCH_LIMIT,
          source: "official" as const,
        }
      : "skip"
  );
  const [officialRandomDecks, setOfficialRandomDecks] = useState<
    PublicDeckSummary[]
  >([]);
  const [officialRandomDecksLoaded, setOfficialRandomDecksLoaded] = useState(
    false
  );

  const fetchOfficialRandomDecks = useCallback(async () => {
    const decks: PublicDeckSummary[] = [];
    const pageSize = OPPONENT_OFFICIAL_RANDOM_LIMIT;
    for (let page = 1; page <= 80; page += 1) {
      const pageResult = await convex.query(api.decks.searchPublicDeckPage, {
        query: "",
        limit: pageSize,
        page,
        source: "official" as const,
      });
      decks.push(...pageResult.decks);
      if (!pageResult.hasNextPage || pageResult.decks.length < pageSize) {
        break;
      }
    }

    return decks;
  }, [convex]);

  useEffect(() => {
    if (!includeOfficialOpponentDecks) {
      setOfficialRandomDecks([]);
      setOfficialRandomDecksLoaded(true);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const decks = await fetchOfficialRandomDecks();
        if (cancelled) return;
        setOfficialRandomDecks(decks);
        setOfficialRandomDecksLoaded(true);
      } catch {
        if (cancelled) return;
        setOfficialRandomDecks([]);
        setOfficialRandomDecksLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [includeOfficialOpponentDecks, fetchOfficialRandomDecks]);

  const availableOpponentDecks = useMemo(
    () => opponentDecks.filter((candidate) => deckCardCount(candidate) > 0),
    [opponentDecks]
  );
  const savedOpponentCandidates = useMemo(
    () => availableOpponentDecks.map(savedOpponentDeckCandidate),
    [availableOpponentDecks]
  );
  const compatibleSavedOpponentCandidates = useMemo(
    () =>
      savedOpponentCandidates.filter((candidate) =>
        isCompatibleOpponentDeck(candidate, gameMode)
      ),
    [gameMode, savedOpponentCandidates]
  );
  const savedSearchCandidates = useMemo(
    () =>
      filterOpponentDecks(
        compatibleSavedOpponentCandidates,
        opponentDeckSearch
      ),
    [compatibleSavedOpponentCandidates, opponentDeckSearch]
  );
  const officialSearchCandidates = useMemo(
    () =>
      includeOfficialOpponentDecks
        ? (officialSearchResults ?? [])
            .map(officialOpponentDeckCandidate)
            .filter((candidate) => isCompatibleOpponentDeck(candidate, gameMode))
        : [],
    [gameMode, includeOfficialOpponentDecks, officialSearchResults]
  );
  const filteredOpponentDecks = useMemo(
    () =>
      [...savedSearchCandidates, ...officialSearchCandidates].slice(
        0,
        OPPONENT_DECK_SEARCH_LIMIT
      ),
    [officialSearchCandidates, savedSearchCandidates]
  );
  const selectedOpponentCandidate = useMemo(
    () =>
      candidateByKey(
        [
          ...compatibleSavedOpponentCandidates,
          ...officialSearchCandidates,
        ],
        selectedOpponentDeckKey
      ),
    [
      compatibleSavedOpponentCandidates,
      officialSearchCandidates,
      selectedOpponentDeckKey,
    ]
  );
  const fallbackSelectedOpponentCandidate = useMemo(
    () =>
      preferredOpponentCandidate(
        compatibleSavedOpponentCandidates,
        filteredOpponentDecks,
        deck.id
      ),
    [compatibleSavedOpponentCandidates, deck.id, filteredOpponentDecks]
  );
  const effectiveSelectedOpponentCandidate =
    selectedOpponentCandidate ?? fallbackSelectedOpponentCandidate;
  const effectiveSelectedOpponentDeckKey =
    effectiveSelectedOpponentCandidate?.key ?? selectedOpponentDeckKey;
  const officialRandomCandidates = useMemo(
    () =>
      includeOfficialOpponentDecks
        ? officialRandomDecks
            .map(officialOpponentDeckCandidate)
            .filter((candidate) => isCompatibleOpponentDeck(candidate, gameMode))
        : [],
    [gameMode, includeOfficialOpponentDecks, officialRandomDecks]
  );
  const allRandomOpponentCandidates = useMemo(
    () => [...compatibleSavedOpponentCandidates, ...officialRandomCandidates],
    [compatibleSavedOpponentCandidates, officialRandomCandidates]
  );
  const randomOpponentCandidates = useMemo(
    () => randomOpponentDeckCandidates(allRandomOpponentCandidates, deck.id),
    [allRandomOpponentCandidates, deck.id]
  );
  const randomCandidateCount = randomOpponentCandidates.length;
  const officialSearchLoaded =
    !includeOfficialOpponentDecks || officialSearchResults !== undefined;
  const searchDecksLoaded = opponentDecksLoaded && officialSearchLoaded;
  const randomDecksLoaded =
    opponentDecksLoaded &&
    (includeOfficialOpponentDecks ? officialRandomDecksLoaded : true);
  const effectiveServerId = effectiveMageServerId({
    opponentType,
    mageServerId,
  });
  const selectedMageServer = mageServerOption(effectiveServerId);
  const selectedMageServerTarget = useMemo(
    () => ({ host: selectedMageServer.host, port: selectedMageServer.port }),
    [selectedMageServer.host, selectedMageServer.port]
  );
  const [selectedGatewayHealth, setSelectedGatewayHealth] =
    useState<GatewayHealth>("checking");
  const [selectedGatewayStats, setSelectedGatewayStats] =
    useState<GatewayStats | null>(null);
  const visibleGatewayHealth =
    opponentType === "human" ? selectedGatewayHealth : gatewayHealth;
  const visibleGatewayStats =
    opponentType === "human" ? selectedGatewayStats : gatewayStats;

  const startSetupGame = useCallback(
    () => {
      const opponentCandidate =
        opponentType !== "ai" ||
        opponentDeckMode === "current" ||
        opponentDeckMode === "random"
          ? null
          : effectiveSelectedOpponentCandidate;
      onStart({
        opponentType,
        gameMode,
        ai: defaultMageAiType(ai),
        playerRating: defaultMagePlayerRating(playerRating),
        mageServerId: effectiveServerId,
        opponentDeckMode:
          opponentType === "ai"
            ? opponentDeckMode
            : DEFAULT_MAGE_OPPONENT_DECK_MODE,
        opponentDeckSource: opponentCandidate?.source ?? null,
        opponentDeckId:
          opponentCandidate?.source === "saved" ? opponentCandidate.id : null,
        opponentDeckPublicId:
          opponentCandidate?.source === "official"
            ? opponentCandidate.publicId ?? null
            : null,
        opponentDeckName:
          opponentType === "ai"
            ? opponentDeckMode === "current"
              ? deck.name
              : opponentCandidate?.name ?? null
            : null,
        includeOfficialOpponentDecks,
      });
    },
    [
      ai,
      deck.name,
      effectiveSelectedOpponentCandidate,
      effectiveServerId,
      gameMode,
      includeOfficialOpponentDecks,
      onStart,
      opponentDeckMode,
      opponentType,
      playerRating,
    ]
  );

  useEffect(() => {
    if (opponentType !== "human") {
      return;
    }

    let cancelled = false;
    let abort: AbortController | null = null;
    const checkSelectedGatewayHealth = () => {
      abort?.abort();
      abort = new AbortController();
      fetch(mageGatewayHealthUrl(selectedMageServerTarget), {
        cache: "no-store",
        signal: abort.signal,
      })
        .then(async (response) => {
          const stats = await readGatewayStats(response);
          if (cancelled) return;
          setSelectedGatewayHealth(response.ok ? "online" : "offline");
          setSelectedGatewayStats(
            response.ok ? statsForSelectedServer(stats, selectedMageServerTarget) : null
          );
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (cancelled) return;
          setSelectedGatewayHealth("offline");
          setSelectedGatewayStats(null);
        });
    };

    const startTimer = window.setTimeout(() => {
      if (cancelled) return;
      setSelectedGatewayHealth("checking");
      setSelectedGatewayStats(null);
      checkSelectedGatewayHealth();
    }, 0);
    const interval = window.setInterval(checkSelectedGatewayHealth, 5000);
    return () => {
      cancelled = true;
      abort?.abort();
      window.clearTimeout(startTimer);
      window.clearInterval(interval);
    };
  }, [opponentType, selectedMageServerTarget]);

  useEffect(() => {
    const abort = new AbortController();
    const validatedGameMode = gameMode;
    validateDeckForMageGameMode(deck, gameMode, abort.signal)
      .then((result) => {
        setValidation({
          status: result.valid ? "ready" : "invalid",
          gameMode: validatedGameMode,
          result,
        });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setValidation({
          status: "error",
          gameMode: validatedGameMode,
          message:
            error instanceof Error
              ? error.message
              : "Could not verify this deck.",
        });
      });
    return () => abort.abort();
  }, [deck, gameMode]);

  const currentValidation =
    validation.gameMode === gameMode ? validation : { status: "checking" as const, gameMode };
  const opponentDeckReady =
    opponentType !== "ai" ||
    opponentDeckMode === "current" ||
    (opponentDeckMode === "random"
      ? randomDecksLoaded && randomCandidateCount > 0
      : searchDecksLoaded && effectiveSelectedOpponentCandidate !== null);
  const serverReady = opponentType !== "ai" || selectedMageServer.ai;
  const canStart =
    !starting &&
    currentValidation.status === "ready" &&
    opponentDeckReady &&
    serverReady;
  const startLabel =
    opponentType === "human" ? "Join or Create Table" : "Start Game";
  const footerStatus = setupFooterStatus({
    validation: currentValidation,
    gameMode,
    opponentType,
    opponentDeckMode,
    opponentDecksLoaded:
      opponentDeckMode === "random" ? randomDecksLoaded : searchDecksLoaded,
    randomCandidateCount,
    selectedOpponentDeck: effectiveSelectedOpponentCandidate,
    serverLabel: opponentType === "human" ? selectedMageServer.label : null,
    serverReady,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="mage-playtest-setup-title"
        className="flex max-h-[min(90dvh,44rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
      >
        <header className="soft-divider flex shrink-0 items-start justify-between gap-4 bg-surface-raised px-5 py-4">
          <div className="min-w-0">
            <h2
              id="mage-playtest-setup-title"
              className="truncate text-base font-semibold text-text"
            >
              Playtest {deck.name}
            </h2>
            <div className="mt-1 text-xs text-text-subtle">
              MAGE gateway {mageGatewayBaseUrl()}
              {opponentType === "human" ? ` · ${selectedMageServer.host}` : ""}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <a
              href="https://xmage.today/"
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-border bg-white px-2.5 py-1 text-[11px] font-semibold text-text-muted transition hover:border-border-strong hover:text-text"
            >
              Powered by XMage
            </a>
            <GatewayHealthPill
              health={visibleGatewayHealth}
              stats={visibleGatewayStats}
              showPopulation={opponentType === "human"}
            />
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs text-text-muted hover:border-border-strong hover:text-text"
              >
                Close
              </button>
            )}
          </div>
        </header>

        <div className="thin-scroll min-h-0 flex-1 overflow-auto px-5 py-4">
          <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
            <section>
              <div className="text-[11px] font-semibold uppercase text-text-muted">
                Opponent
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <SetupChoiceButton
                  active={opponentType === "ai"}
                  onClick={() => {
                    setOpponentType("ai");
                    const aiServer = mageAiServerOption();
                    if (aiServer) {
                      setMageServerId(aiServer.id);
                    }
                  }}
                >
                  AI
                </SetupChoiceButton>
                <SetupChoiceButton
                  active={opponentType === "human"}
                  onClick={() => setOpponentType("human")}
                >
                  Real Player
                </SetupChoiceButton>
              </div>
              {opponentType === "human" && (
                <div className="mt-3">
                  <div className="text-[11px] font-semibold uppercase text-text-muted">
                    Server
                  </div>
                  <MageServerSelector
                    selectedServerId={effectiveServerId}
                    onSelect={setMageServerId}
                  />
                  <div className="mt-3 rounded-lg border border-border bg-surface-subtle px-3 py-2 text-xs text-text-subtle">
                    <div className="font-semibold text-text">
                      {selectedMageServer.host}:{selectedMageServer.port}
                    </div>
                    <div className="mt-1">
                      Joins a compatible public table first, then creates a
                      waiting table if none is open.
                    </div>
                  </div>
                  <label className="mt-3 block">
                    <span className="text-[11px] font-semibold uppercase text-text-muted">
                      Your ELO
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={3000}
                      step={1}
                      value={playerRating}
                      onChange={(event) =>
                        setPlayerRating(
                          defaultMagePlayerRating(event.currentTarget.value)
                        )
                      }
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-white px-3 text-sm font-semibold tabular-nums outline-none focus:border-accent"
                    />
                  </label>
                </div>
              )}
              {opponentType === "ai" && (
                <div className="mt-3 space-y-3">
                  {!selectedMageServer.ai && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      No configured public server currently exposes playable AI.
                      Use Real Player or point the gateway at an AI-enabled MAGE
                      server.
                    </div>
                  )}
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase text-text-muted">
                      AI
                    </span>
                    <select
                      value={ai}
                      onChange={(event) =>
                        setAi(event.target.value as MagePlaytestConfig["ai"])
                      }
                      className="mt-1 h-10 w-full rounded-lg border border-border bg-white px-3 text-sm outline-none focus:border-accent"
                    >
                      {MAGE_AI_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div>
                    <div className="text-[11px] font-semibold uppercase text-text-muted">
                      AI Deck
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg border border-border bg-white p-1">
                      <OpponentDeckModeButton
                        mode="current"
                        active={opponentDeckMode === "current"}
                        onSelect={setOpponentDeckMode}
                      >
                        Current
                      </OpponentDeckModeButton>
                      <OpponentDeckModeButton
                        mode="random"
                        active={opponentDeckMode === "random"}
                        onSelect={setOpponentDeckMode}
                      >
                        Random
                      </OpponentDeckModeButton>
                      <OpponentDeckModeButton
                        mode="selected"
                        active={opponentDeckMode === "selected"}
                        onSelect={setOpponentDeckMode}
                      >
                        Choose
                      </OpponentDeckModeButton>
                    </div>
                    <label className="mt-2 flex min-h-10 items-center justify-between gap-3 rounded-lg border border-border bg-white px-3 py-2 text-xs text-text-muted">
                      <span className="font-semibold text-text">
                        Official MTG decks
                      </span>
                      <input
                        type="checkbox"
                        checked={includeOfficialOpponentDecks}
                        onChange={(event) =>
                          setIncludeOfficialOpponentDecks(event.target.checked)
                        }
                        className="h-4 w-4 accent-[color:var(--accent)]"
                      />
                    </label>

                    {opponentDeckMode === "random" && (
                      <div className="mt-2 rounded-lg border border-border bg-surface-subtle px-3 py-2 text-xs text-text-subtle">
                        {randomDecksLoaded
                          ? randomCandidateCount > 0
                            ? `${randomCandidateCount} deck${
                                randomCandidateCount === 1 ? "" : "s"
                              } compatible with ${mageGameModeLabel(gameMode)}`
                            : `No ${mageGameModeLabel(gameMode)} decks available`
                          : "Loading decks"}
                      </div>
                    )}

                    {opponentDeckMode === "selected" && (
                      <div className="mt-2">
                        <input
                          type="search"
                          value={opponentDeckSearch}
                          onChange={(event) =>
                            setOpponentDeckSearch(event.target.value)
                          }
                          placeholder="Search decks"
                          aria-label="Search decks for AI opponent"
                          className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm outline-none focus:border-accent"
                        />
                        <div className="thin-scroll mt-2 max-h-44 overflow-y-auto rounded-lg border border-border bg-white p-1">
                          {!searchDecksLoaded ? (
                            <div className="px-2 py-2 text-xs text-text-subtle">
                              Loading decks
                            </div>
                          ) : filteredOpponentDecks.length === 0 ? (
                            <div className="px-2 py-2 text-xs text-text-subtle">
                              No compatible decks
                            </div>
                          ) : (
                            filteredOpponentDecks.map((candidate) => (
                              <button
                                key={candidate.key}
                                type="button"
                                onClick={() =>
                                  setSelectedOpponentDeckKey(candidate.key)
                                }
                                className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition ${
                                  candidate.key === effectiveSelectedOpponentDeckKey
                                    ? "bg-[image:var(--rainbow-soft)] ring-1 ring-accent/35"
                                    : "hover:bg-surface-subtle"
                                }`}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-semibold text-text">
                                    {candidate.name}
                                  </span>
                                  <span className="block truncate text-[11px] capitalize text-text-subtle">
                                    {candidate.source === "official"
                                      ? "Official"
                                      : "Saved"}{" "}
                                    · {candidate.format} · {candidate.cardCount} cards
                                  </span>
                                </span>
                                {candidate.key === effectiveSelectedOpponentDeckKey && (
                                  <span className="shrink-0 text-[11px] font-semibold text-accent">
                                    Selected
                                  </span>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>

            <section>
              <div className="text-[11px] font-semibold uppercase text-text-muted">
                Game Mode
              </div>
              <div
                role="group"
                aria-label="Game mode"
                className="mt-2 grid grid-cols-2 gap-2"
              >
                {MAGE_GAME_MODES.map((mode) => {
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      aria-pressed={gameMode === mode.id}
                      onClick={() => setGameMode(mode.id)}
                      className={`flex min-h-14 flex-col justify-center rounded-lg border px-3 py-2 text-left transition ${
                        gameMode === mode.id
                          ? "border-accent bg-accent-subtle text-accent shadow-sm"
                          : "border-border bg-white text-text hover:border-border-strong"
                      }`}
                    >
                      <span className="text-sm font-semibold">{mode.label}</span>
                      <span
                        className={`mt-0.5 text-[11px] ${
                          gameMode === mode.id ? "text-accent" : "text-text-subtle"
                        }`}
                      >
                        {opponentType === "human"
                          ? waitingLabelForMode(visibleGatewayStats, mode.id)
                          : "rules check"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          <ValidationSummary validation={currentValidation} gameMode={gameMode} />
        </div>

        <footer className="soft-divider flex shrink-0 flex-wrap items-center justify-between gap-3 bg-surface-raised px-5 py-4">
          <div className="text-xs text-text-subtle">
            {footerStatus}
          </div>
          <button
            type="button"
            disabled={!canStart}
            onClick={startSetupGame}
            className="control-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {starting ? "Starting" : startLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

function SetupChoiceButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 rounded-lg border px-3 text-sm font-medium transition ${
        active
          ? "border-accent bg-accent-subtle text-accent"
          : "border-border bg-white text-text-muted hover:border-border-strong hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function MageServerSelector({
  selectedServerId,
  onSelect,
}: {
  selectedServerId: MageServerId;
  onSelect: (serverId: MageServerId) => void;
}) {
  const publicServers = MAGE_SERVER_OPTIONS.filter((server) => !server.ai);
  return (
    <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg border border-border bg-white p-1">
      {publicServers.map((server) => {
        const active = selectedServerId === server.id;
        return (
          <button
            key={server.id}
            type="button"
            aria-pressed={active}
            title={`${server.host}:${server.port}`}
            onClick={() => onSelect(server.id)}
            className={`min-h-12 rounded-md px-2 text-left transition ${
              active
                ? "bg-accent text-white shadow-sm"
                : "text-text-muted hover:bg-surface-subtle hover:text-text"
            }`}
          >
            <span className="block text-xs font-semibold">{server.label}</span>
            <span
              className={`block truncate text-[10px] ${
                active ? "text-white/80" : "text-text-subtle"
              }`}
            >
              {server.note}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function OpponentDeckModeButton({
  mode,
  active,
  children,
  onSelect,
}: {
  mode: MageOpponentDeckMode;
  active: boolean;
  children: ReactNode;
  onSelect: (mode: MageOpponentDeckMode) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      className={`min-h-8 rounded-md px-2 text-xs font-semibold transition ${
        active
          ? "bg-accent text-white shadow-sm"
          : "text-text-muted hover:bg-surface-subtle hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function setupFooterStatus({
  validation,
  gameMode,
  opponentType,
  opponentDeckMode,
  opponentDecksLoaded,
  randomCandidateCount,
  selectedOpponentDeck,
  serverLabel,
  serverReady,
}: {
  validation: ValidationState;
  gameMode: MageGameMode;
  opponentType: MageOpponentType;
  opponentDeckMode: MageOpponentDeckMode;
  opponentDecksLoaded: boolean;
  randomCandidateCount: number;
  selectedOpponentDeck: OpponentDeckCandidate | null;
  serverLabel: string | null;
  serverReady: boolean;
}) {
  if (validation.status === "checking") {
    return "Verifying deck";
  }
  if (validation.status !== "ready") {
    return "Deck needs changes";
  }
  if (opponentType === "ai") {
    if (!serverReady) return "No playable AI server configured";
    if (opponentDeckMode === "random") {
      if (!opponentDecksLoaded) return "Loading AI decks";
      if (randomCandidateCount === 0) {
        return `No ${mageGameModeLabel(gameMode)} decks for random AI`;
      }
    }
    if (opponentDeckMode === "selected") {
      if (!opponentDecksLoaded) return "Loading AI decks";
      if (!selectedOpponentDeck) {
        return `Select a ${mageGameModeLabel(gameMode)} AI deck`;
      }
    }
    return `${mageGameModeLabel(gameMode)} valid · AI`;
  }
  return `Join or create ${mageGameModeLabel(gameMode)} · ${serverLabel ?? "server"}`;
}

function waitingLabelForMode(
  stats: GatewayStats | null,
  gameMode: MageGameMode
): string {
  if (!stats) return "checking queue";
  const backend = stats.backend;
  const counts = backend?.waitingByFormat;
  if (counts) {
    const count = counts[gameMode];
    return formatWaitingCount(cleanCount(typeof count === "number" ? count : 0));
  }
  if (backend?.ok === false) {
    return backend.error && backend.error !== "Not checked yet"
      ? "server unavailable"
      : "checking queue";
  }
  if (backend?.ok === true) return "restart gateway for queue counts";
  return "checking queue";
}

function totalWaitingCount(stats: GatewayStats | null): number | null {
  const count = stats?.backend?.waiting;
  return typeof count === "number" ? cleanCount(count) : null;
}

function cleanCount(count: number): number {
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

function formatWaitingCount(count: number | null): string {
  if (count === null) return "waiting unavailable";
  return `${count.toLocaleString()} ${
    count === 1 ? "player" : "players"
  } waiting`;
}

function deckCardCount(deck: Deck): number {
  return (
    deck.cardCount ||
    deck.entries.reduce((total, entry) => total + entry.quantity, 0)
  );
}

function savedCandidateKey(deckId: string): string {
  return `saved:${deckId}`;
}

function officialCandidateKey(publicId: string): string {
  return `official:${publicId}`;
}

function initialOpponentDeckCandidateKey(
  config: MagePlaytestConfig | null,
  currentDeckId: string
): string {
  if (config?.opponentDeckSource === "official" && config.opponentDeckPublicId) {
    return officialCandidateKey(config.opponentDeckPublicId);
  }
  return savedCandidateKey(config?.opponentDeckId ?? currentDeckId);
}

function savedOpponentDeckCandidate(deck: Deck): OpponentDeckCandidate {
  return {
    key: savedCandidateKey(deck.id),
    source: "saved",
    id: deck.id,
    name: deck.name,
    format: deck.format,
    cardCount: deckCardCount(deck),
    sideboardCount: deck.sideboardCount,
    deck,
  };
}

function officialOpponentDeckCandidate(
  deck: PublicDeckSummary | PublicDeck
): OpponentDeckCandidate {
  return {
    key: officialCandidateKey(deck.publicId),
    source: "official",
    id: deck.publicId,
    publicId: deck.publicId,
    name: deck.name,
    format: deck.format,
    cardCount: deck.cardCount,
    sideboardCount: deck.sideboardCount,
    officialSummary: "viewCount" in deck ? deck : undefined,
  };
}

function candidateByKey(
  candidates: OpponentDeckCandidate[],
  key: string | null
): OpponentDeckCandidate | null {
  if (!key) return null;
  return candidates.find((candidate) => candidate.key === key) ?? null;
}

function filterOpponentDecks(
  decks: OpponentDeckCandidate[],
  query: string
): OpponentDeckCandidate[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return decks;
  return decks.filter((deck) =>
    [
      deck.name,
      deck.format,
      ...(deck.deck?.entries.slice(0, 12).map((entry) => entry.name) ?? []),
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalized)
  );
}

function isCompatibleOpponentDeck(
  deck: OpponentDeckCandidate,
  gameMode: MageGameMode
): boolean {
  const cardCount = cleanCount(deck.cardCount);
  const sideboardCount = cleanCount(deck.sideboardCount);
  if (gameMode === "freeform") return cardCount > 0;
  if (gameMode === "commander") {
    return normalizedDeckFormat(deck.format) === "commander" && cardCount >= 100;
  }
  if (gameMode === "pauper") {
    return (
      normalizedDeckFormat(deck.format) === "pauper" &&
      cardCount >= 60 &&
      sideboardCount <= 15
    );
  }
  return (
    isConstructedDeckFormatCompatible(deck.format, gameMode) &&
    cardCount >= 60 &&
    sideboardCount <= 15
  );
}

function isConstructedDeckFormatCompatible(
  deckFormat: string,
  gameMode: MageGameMode
): boolean {
  const gameModeIndex = CONSTRUCTED_FORMAT_ORDER.indexOf(gameMode);
  const deckFormatIndex = CONSTRUCTED_FORMAT_ORDER.indexOf(
    normalizedDeckFormat(deckFormat)
  );
  return deckFormatIndex >= 0 && gameModeIndex >= 0 && deckFormatIndex <= gameModeIndex;
}

function normalizedDeckFormat(format: string): string {
  return format.trim().toLowerCase();
}

function randomOpponentDeckCandidates(
  decks: OpponentDeckCandidate[],
  currentDeckId: string
): OpponentDeckCandidate[] {
  const playable = decks.filter((deck) => deck.cardCount > 0);
  const withoutCurrent = playable.filter(
    (deck) => deck.source !== "saved" || deck.id !== currentDeckId
  );
  return withoutCurrent.length > 0 ? withoutCurrent : playable;
}

function preferredOpponentCandidate(
  savedDecks: OpponentDeckCandidate[],
  visibleDecks: OpponentDeckCandidate[],
  currentDeckId: string
): OpponentDeckCandidate | null {
  return (
    savedDecks.find((deck) => deck.id === currentDeckId) ??
    visibleDecks[0] ??
    randomOpponentDeckCandidates(savedDecks, currentDeckId)[0] ??
    null
  );
}

function randomOpponentCandidate(
  candidates: OpponentDeckCandidate[]
): OpponentDeckCandidate | null {
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}

async function resolveConfiguredOpponentDeck(
  config: MagePlaytestConfig,
  decks: Deck[],
  currentDeckId: string,
  getPublicDeck: (publicId: string) => Promise<PublicDeck | null>,
  getOfficialRandomDecks?: () => Promise<PublicDeckSummary[]>
): Promise<ResolvedOpponentDeck | null> {
  if (config.opponentType !== "ai") return null;
  const mode = config.opponentDeckMode ?? DEFAULT_MAGE_OPPONENT_DECK_MODE;
  if (mode === "current") return null;

  if (
    mode === "random" &&
    !config.opponentDeckId &&
    !config.opponentDeckPublicId
  ) {
    const savedCandidates = decks
      .map(savedOpponentDeckCandidate)
      .filter((candidate) => isCompatibleOpponentDeck(candidate, config.gameMode));
    const officialCandidates =
      config.includeOfficialOpponentDecks && getOfficialRandomDecks
        ? (await getOfficialRandomDecks())
            .map(officialOpponentDeckCandidate)
            .filter((candidate) =>
              isCompatibleOpponentDeck(candidate, config.gameMode)
            )
        : [];
    const candidates = randomOpponentDeckCandidates(
      [...savedCandidates, ...officialCandidates],
      currentDeckId
    );
    const candidate = randomOpponentCandidate(candidates);
    return candidate
      ? await resolveOpponentDeckCandidate(candidate, decks, getPublicDeck)
      : null;
  }

  const source: MageOpponentDeckSource =
    config.opponentDeckSource ??
    (config.opponentDeckPublicId ? "official" : "saved");
  if (source === "official") {
    if (!config.opponentDeckPublicId) return null;
    const deck = await getPublicDeck(config.opponentDeckPublicId);
    return deck
      ? { deck, candidate: officialOpponentDeckCandidate(deck) }
      : null;
  }
  if (config.opponentDeckId) {
    const deck = decks.find((candidate) => candidate.id === config.opponentDeckId);
    return deck ? { deck, candidate: savedOpponentDeckCandidate(deck) } : null;
  }
  const candidates = randomOpponentDeckCandidates(
    decks
      .map(savedOpponentDeckCandidate)
      .filter((candidate) => isCompatibleOpponentDeck(candidate, config.gameMode)),
    currentDeckId
  );
  const candidate = randomOpponentCandidate(candidates);
  return candidate
    ? await resolveOpponentDeckCandidate(candidate, decks, getPublicDeck)
    : null;
}

async function resolveOpponentDeckCandidate(
  candidate: OpponentDeckCandidate,
  decks: Deck[],
  getPublicDeck: (publicId: string) => Promise<PublicDeck | null>
): Promise<ResolvedOpponentDeck | null> {
  if (candidate.source === "official") {
    if (!candidate.publicId) return null;
    const deck = await getPublicDeck(candidate.publicId);
    return deck ? { deck, candidate: officialOpponentDeckCandidate(deck) } : null;
  }

  const deck = candidate.deck ?? decks.find((item) => item.id === candidate.id);
  return deck ? { deck, candidate: savedOpponentDeckCandidate(deck) } : null;
}

function rerollableMagePlaytestConfig(
  config: MagePlaytestConfig
): MagePlaytestConfig {
  const mode =
    config.opponentType === "ai"
      ? config.opponentDeckMode ?? DEFAULT_MAGE_OPPONENT_DECK_MODE
      : DEFAULT_MAGE_OPPONENT_DECK_MODE;
  if (mode !== "random") return config;

  return {
    ...config,
    opponentDeckSource: null,
    opponentDeckId: null,
    opponentDeckPublicId: null,
    opponentDeckName: null,
  };
}

function normalizedMagePlaytestConfig(
  config: MagePlaytestConfig
): MagePlaytestConfig {
  return {
    ...config,
    mageServerId: effectiveMageServerId(config),
    playerRating: defaultMagePlayerRating(config.playerRating),
  };
}

function ValidationSummary({
  validation,
  gameMode,
}: {
  validation: ValidationState;
  gameMode: MageGameMode;
}) {
  if (validation.status === "checking") {
    return (
      <section className="mt-4 rounded-xl border border-border bg-white p-3 text-sm text-text-muted">
        Verifying {mageGameModeLabel(gameMode)} legality...
      </section>
    );
  }

  if (validation.status === "error") {
    return (
      <section className="mt-4 rounded-xl border border-[color:var(--danger)]/25 bg-red-50 p-3 text-sm text-[color:var(--danger)]">
        {validation.message}
      </section>
    );
  }

  const { result } = validation;
  return (
    <section
      className={`mt-4 rounded-xl border p-3 ${
        result.valid
          ? "border-emerald-200 bg-emerald-50"
          : "border-[color:var(--danger)]/25 bg-red-50"
      }`}
    >
      <div
        className={`text-sm font-semibold ${
          result.valid ? "text-emerald-700" : "text-[color:var(--danger)]"
        }`}
      >
        {result.valid
          ? `${mageGameModeLabel(gameMode)} deck verified`
          : `${mageGameModeLabel(gameMode)} deck is not valid`}
      </div>
      {(result.errors.length > 0 || result.warnings.length > 0) && (
        <div className="mt-2 flex flex-col gap-1 text-xs">
          {result.errors.slice(0, 8).map((error) => (
            <div key={error} className="text-[color:var(--danger)]">
              {error}
            </div>
          ))}
          {result.warnings.slice(0, 4).map((warning) => (
            <div key={warning} className="text-amber-800">
              {warning}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function storedMageSessionKey(deckId: string): string {
  return `${STORED_MAGE_SESSION_PREFIX}${deckId}`;
}

function readStoredMageSession(deckId: string): StoredMageSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storedMageSessionKey(deckId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredMageSession>;
    if (
      parsed.deckId !== deckId ||
      !parsed.sessionId ||
      !parsed.config ||
      typeof parsed.savedAt !== "number" ||
      Date.now() - parsed.savedAt > STORED_MAGE_SESSION_MAX_AGE_MS
    ) {
      window.localStorage.removeItem(storedMageSessionKey(deckId));
      return null;
    }
    return {
      deckId,
      sessionId: parsed.sessionId,
      config: parsed.config,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

function writeStoredMageSession(
  deckId: string,
  sessionId: string,
  config: MagePlaytestConfig
) {
  if (typeof window === "undefined") return;
  try {
    const stored: StoredMageSession = {
      deckId,
      sessionId,
      config,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(storedMageSessionKey(deckId), JSON.stringify(stored));
  } catch {
    // Storage can be unavailable in private browsing; reconnect just won't persist.
  }
}

function clearStoredMageSession(deckId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storedMageSessionKey(deckId));
  } catch {
    // Ignore storage failures.
  }
}

function defaultSpectatorConfig(deckFormat: string): MagePlaytestConfig {
  return {
    opponentType: "ai",
    gameMode: defaultMageGameMode(deckFormat),
    ai: "COMPUTER_MAD",
    mageServerId: effectiveMageServerId({
      opponentType: "ai",
      mageServerId: undefined,
    }),
  };
}

function currentUrlGameId(): string | null {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get("gameId");
}

function writeUrlGameId(sessionId: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (sessionId) {
    url.searchParams.set("gameId", sessionId);
  } else {
    url.searchParams.delete("gameId");
  }
  window.history.replaceState(window.history.state, "", url.toString());
}

function useMagePlaytest(deck: Deck, initialGameId?: string): UseMagePlaytest {
  const [state, setState] = useState<MageSessionState>(initialSessionState);
  const socketRef = useRef<WebSocket | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef(0);
  const gameIdRef = useRef<string | null>(null);
  const playerIdRef = useRef<string | null>(null);
  const spectatorRef = useRef(false);
  const clientGameViewRef = useRef<MageGameView | null>(null);
  const clientPromptRef = useRef<MageGatewayEvent | null>(null);

  const closeSocket = useCallback(() => {
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      socket.close();
    }
  }, []);

  const recoverClosedEventStream = useCallback(
    async (
      sessionId: string,
      spectator: boolean,
      runId: number,
      closeReason: string
    ) => {
      const history = await fetchMageSessionEvents(sessionId, { spectator });
      if (runRef.current !== runId) return;

      setState((current) => {
        let next = current;
        const seen = new Set(current.events.map(gatewayEventKey));
        for (const event of history?.events ?? []) {
          const key = gatewayEventKey(event);
          if (seen.has(key)) continue;
          seen.add(key);
          next = applyGatewayEvent(next, event);
        }

        if (next.status === "error") return next;
        if (next.prompt?.type === "gameOver") {
          return {
            ...next,
            status: "closed",
            lastMessage: "MAGE game ended",
          };
        }

        const message = closedEventStreamMessage(
          next,
          closeReason,
          history?.terminal === true
        );
        return {
          ...next,
          status: "error",
          error: next.error ?? message,
          lastMessage: message,
        };
      });
    },
    []
  );

  const connectEventStream = useCallback(
    (
      sessionId: string,
      eventUrl: string,
      config: MagePlaytestConfig,
      spectator: boolean,
      runId: number
    ) => {
      setState((current) => ({
        ...current,
        status: "connecting",
        sessionId,
        spectator,
        config,
        lastMessage: spectator
          ? "Connecting spectator view"
          : "Connecting event stream",
      }));

      const socket = new WebSocket(eventUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        if (runRef.current !== runId) return;
        spectatorRef.current = spectator;
        setState((current) => ({
          ...current,
          status: "connected",
          error: null,
          lastMessage: "Connected to MAGE",
        }));
      };

      socket.onmessage = (message) => {
        if (runRef.current !== runId) return;
        try {
          const event = JSON.parse(message.data as string) as MageGatewayEvent;
          if (event.gameId) gameIdRef.current = event.gameId;
          if (event.playerId) playerIdRef.current = event.playerId;
          if (event.gameView) clientGameViewRef.current = event.gameView;
          if (event.type === "prompt" || event.type === "gameOver") {
            clientPromptRef.current = event;
          } else if (event.type === "state") {
            clientPromptRef.current = null;
          }
          if (event.type === "gameOver" && !spectator) {
            clearStoredMageSession(deck.id);
            writeUrlGameId(null);
          }
          setState((current) => applyGatewayEvent(current, event));
        } catch {
          setState((current) => ({
            ...current,
            error: "MAGE gateway sent an unreadable event.",
          }));
        }
      };

      socket.onerror = () => {
        if (runRef.current !== runId) return;
        setState((current) => ({
          ...current,
          status: "error",
          error: "The MAGE event stream failed.",
        }));
      };

      socket.onclose = (event) => {
        if (runRef.current !== runId) return;
        socketRef.current = null;
        void recoverClosedEventStream(
          sessionId,
          spectator,
          runId,
          event.reason.trim()
        );
      };
    },
    [deck.id, recoverClosedEventStream]
  );

  const start = useCallback(async (config: MagePlaytestConfig, opponentDeck?: Deck) => {
    const runId = runRef.current + 1;
    runRef.current = runId;
    abortRef.current?.abort();
    closeSocket();

    const abort = new AbortController();
    abortRef.current = abort;
    gameIdRef.current = null;
    playerIdRef.current = null;
    clientGameViewRef.current = null;
    clientPromptRef.current = null;
    setState({
      ...initialSessionState,
      status: "starting",
      lastMessage: "Starting MAGE playtest",
      spectator: false,
      config,
    });
    spectatorRef.current = false;

    try {
      const response = await startMageGame(deck, config, {
        signal: abort.signal,
        opponentDeck,
      });
      if (runRef.current !== runId) return;
      writeStoredMageSession(deck.id, response.id, config);
      writeUrlGameId(response.id);
      connectEventStream(response.id, response.eventUrl, config, false, runId);
    } catch (error) {
      if (runRef.current !== runId) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setState((current) => ({
        ...current,
        status: "error",
        error: error instanceof Error ? error.message : "Could not start MAGE playtest.",
      }));
    }
  }, [closeSocket, connectEventStream, deck]);

  useEffect(() => {
    const requestedGameId = initialGameId || currentUrlGameId();
    const stored = readStoredMageSession(deck.id);
    const shouldSpectate =
      !!requestedGameId && (!stored || stored.sessionId !== requestedGameId);
    const sessionToRestore = shouldSpectate
      ? {
          deckId: deck.id,
          sessionId: requestedGameId,
          eventUrl: mageGatewayEventUrl(requestedGameId, { spectator: true }),
          config: stored?.config ?? defaultSpectatorConfig(deck.format),
          savedAt: Date.now(),
        }
      : stored
        ? {
            ...stored,
            eventUrl: mageGatewayEventUrl(stored.sessionId),
          }
        : null;
    if (!sessionToRestore) return;

    const runId = runRef.current + 1;
    runRef.current = runId;
    abortRef.current?.abort();
    closeSocket();
    gameIdRef.current = null;
    playerIdRef.current = null;
    clientGameViewRef.current = null;
    clientPromptRef.current = null;
    setState({
      ...initialSessionState,
      status: "connecting",
      sessionId: sessionToRestore.sessionId,
      spectator: shouldSpectate,
      config: sessionToRestore.config,
      lastMessage: shouldSpectate
        ? "Opening spectator view"
        : "Reconnecting to MAGE playtest",
    });
    spectatorRef.current = shouldSpectate;
    if (!shouldSpectate) writeUrlGameId(sessionToRestore.sessionId);
    connectEventStream(
      sessionToRestore.sessionId,
      sessionToRestore.eventUrl ||
        mageGatewayEventUrl(sessionToRestore.sessionId, { spectator: shouldSpectate }),
      sessionToRestore.config,
      shouldSpectate,
      runId
    );
  }, [closeSocket, connectEventStream, deck.format, deck.id, initialGameId]);

  useEffect(() => {
    return () => {
      runRef.current += 1;
      abortRef.current?.abort();
      closeSocket();
    };
  }, [closeSocket]);

  const addManaToPool = useCallback((mana: ManaPoolDelta) => {
    setState((current) => {
      const gameView = addManaToGameView(
        current.gameView,
        playerIdRef.current,
        mana
      );
      if (gameView !== current.gameView) {
        clientGameViewRef.current = gameView;
      }
      return gameView === current.gameView ? current : { ...current, gameView };
    });
  }, []);

  const sendCommand = useCallback((command: MageCommand): boolean => {
    if (spectatorRef.current) {
      setState((current) => ({
        ...current,
        error: "Spectators cannot send game actions.",
      }));
      return false;
    }
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setState((current) => ({
        ...current,
        error: "MAGE is not connected.",
      }));
      return false;
    }
    socket.send(
      JSON.stringify({
        gameId: gameIdRef.current ?? undefined,
        playerId: playerIdRef.current ?? undefined,
        clientGameView: clientGameViewRef.current,
        clientPrompt: clientPromptRef.current,
        ...command,
      })
    );
    return true;
  }, []);

  const disconnect = useCallback(() => {
    if (!state.spectator) {
      sendCommand({ type: "disconnect" });
      clearStoredMageSession(deck.id);
    }
    writeUrlGameId(null);
    runRef.current += 1;
    closeSocket();
    setState((current) => ({
      ...current,
      status: "closed",
      lastMessage: "Disconnected from MAGE",
    }));
  }, [closeSocket, deck.id, sendCommand, state.spectator]);

  return {
    ...state,
    start,
    disconnect,
    chooseUuid: useCallback((id: string) => sendCommand({ type: "chooseUuid", id }), [sendCommand]),
    chooseBoolean: useCallback((value: boolean) => sendCommand({ type: "chooseBoolean", value }), [sendCommand]),
    chooseInteger: useCallback((value: number) => sendCommand({ type: "chooseInteger", value }), [sendCommand]),
    chooseString: useCallback((value: string) => sendCommand({ type: "chooseString", value }), [sendCommand]),
    chooseManaType: useCallback(
      (value: string) => {
        sendCommand({ type: "chooseManaType", value });
      },
      [sendCommand]
    ),
    addManaToPool,
    playerAction: useCallback(
      (action: string, data?: string | number | boolean | null) =>
        sendCommand({ type: "playerAction", action, data: data ?? null }),
      [sendCommand]
    ),
    passPriority: useCallback(
      () => sendCommand({ type: "chooseBoolean", value: false }),
      [sendCommand]
    ),
    passUntilNextTurn: useCallback(
      () => sendCommand({ type: "playerAction", action: PASS_UNTIL_NEXT_TURN_ACTION }),
      [sendCommand]
    ),
    concede: useCallback(() => sendCommand({ type: "concede" }), [sendCommand]),
    sendChatMessage: useCallback(
      (message: string) =>
        sendCommand({
          type: "sendChatMessage",
          chatId: state.chatId ?? undefined,
          message,
        }),
      [sendCommand, state.chatId]
    ),
  };
}

function applyGatewayEvent(
  current: MageSessionState,
  event: MageGatewayEvent
): MageSessionState {
  const isPrompt = event.type === "prompt" || event.type === "gameOver";
  const events = [...current.events, event].slice(-EVENT_LOG_LIMIT);
  const chatMessage = chatMessageFromGatewayEvent(event);
  const chat = chatMessage
    ? [...current.chat, chatMessage].slice(-CHAT_LOG_LIMIT)
    : current.chat;
  const chatId =
    event.chatId ??
    (event.type === "chatReady" || event.type === "chatMessage" || chatMessage
      ? event.objectId ?? chatMessage?.chatId ?? current.chatId
      : current.chatId);
  const nextGameView = event.gameView ?? current.gameView;
  const nextError =
    event.type === "error"
      ? event.message || "MAGE reported an error."
      : current.error;
  return {
    ...current,
    status:
      event.type === "error"
        ? "error"
        : current.status === "connecting"
          ? "connected"
          : current.status,
    sessionId: event.sessionId ?? current.sessionId,
    gameId: event.gameId ?? current.gameId,
    playerId: event.playerId ?? current.playerId,
    chatId,
    gameView: nextGameView,
    prompt: isPrompt ? event : event.type === "state" ? null : current.prompt,
    events,
    chat,
    error: nextError,
    lastMessage:
      event.type === "chatMessage" ? current.lastMessage : event.message ?? current.lastMessage,
  };
}

function chatMessageFromGatewayEvent(
  event: MageGatewayEvent
): MageChatMessage | null {
  const payload = isPlainObject(event.payload) ? event.payload : null;
  const legacyPayloadMessage = payloadString(payload, "message");
  const isTypedChat = event.type === "chatMessage";
  const isLegacyChat =
    event.callbackMethod === "CHATMESSAGE" && legacyPayloadMessage !== null;
  if (!isTypedChat && !isLegacyChat) return null;

  const message =
    (isTypedChat ? event.message : null) ??
    legacyPayloadMessage ??
    payloadString(payload, "message") ??
    "";
  const cleanMessage = plainMageText(message);
  if (!cleanMessage) return null;

  const username =
    event.username ??
    payloadString(payload, "username") ??
    null;
  const messageType =
    event.messageType ??
    payloadString(payload, "messageType") ??
    null;
  if (!isPlayerChatMessage(messageType, username)) return null;

  const chatId =
    event.chatId ??
    event.objectId ??
    payloadString(payload, "chatId") ??
    null;
  const payloadTime = payloadValue(payload, "time");
  const chatTime =
    typeof event.chatTime === "number"
      ? event.chatTime
      : typeof payloadTime === "number"
        ? payloadTime
        : typeof payloadTime === "string"
          ? Date.parse(payloadTime)
          : event.time ?? null;

  return {
    id: `${event.sequence ?? "chat"}:${event.messageId ?? ""}:${chatId ?? ""}:${cleanMessage}`,
    chatId,
    username,
    message: cleanMessage,
    time: typeof chatTime === "number" && Number.isFinite(chatTime) ? chatTime : null,
    turnInfo:
      event.turnInfo ??
      payloadString(payload, "turnInfo") ??
      null,
    color:
      event.color ??
      payloadString(payload, "color") ??
      null,
    messageType,
  };
}

function isPlayerChatMessage(
  messageType: string | null,
  username: string | null
): boolean {
  if (!messageType) return !!username;
  return (
    messageType === "TALK" ||
    messageType === "WHISPER_FROM" ||
    messageType === "WHISPER_TO"
  );
}

function payloadString(
  payload: Record<string, unknown> | null,
  key: string
): string | null {
  const value = payloadValue(payload, key);
  return typeof value === "string" && value.trim() ? value : null;
}

function payloadValue(
  payload: Record<string, unknown> | null,
  key: string
): unknown {
  return payload ? payload[key] : undefined;
}

function gatewayEventKey(event: MageGatewayEvent): string {
  if (typeof event.sequence === "number") return `sequence:${event.sequence}`;
  return [
    event.type,
    event.time,
    event.callbackMethod,
    event.messageId,
    event.message,
  ]
    .filter((part) => part !== undefined && part !== null)
    .join(":");
}

function closedEventStreamMessage(
  current: MageSessionState,
  closeReason: string,
  terminal: boolean
): string {
  if (closeReason) {
    return `MAGE event stream closed: ${closeReason}`;
  }
  if (current.gameView) {
    return "MAGE event stream closed before the game ended. The gateway or MAGE server connection dropped.";
  }
  if (terminal) {
    return "MAGE session ended before the game started, but the gateway did not provide an error event.";
  }
  return "MAGE event stream closed before the game started. Check the event log for the preceding MAGE server error.";
}

function StatusPill({ status, error }: { status: Status; error: string | null }) {
  const style =
    status === "connected"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "error"
        ? "border-[color:var(--danger)]/25 bg-red-50 text-[color:var(--danger)]"
        : "border-border bg-white text-text-muted";
  return (
    <span
      className={`max-w-80 truncate rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize ${style}`}
      title={error ?? status}
    >
      {status === "error" ? error ?? "Error" : status}
    </span>
  );
}

async function readGatewayStats(response: Response): Promise<GatewayStats | null> {
  try {
    return (await response.json()) as GatewayStats;
  } catch {
    return null;
  }
}

function statsForSelectedServer(
  stats: GatewayStats | null,
  server: Pick<MageServerOption, "host" | "port">
): GatewayStats | null {
  if (!stats) return null;
  const backend = stats.backend;
  const responseHost =
    typeof backend?.mageHost === "string"
      ? backend.mageHost.trim().toLowerCase()
      : "";
  const responsePort =
    typeof backend?.magePort === "number" ? backend.magePort : null;
  const selectedHost = server.host.trim().toLowerCase();
  if (responseHost === selectedHost && responsePort === server.port) {
    return stats;
  }

  const error =
    !responseHost && responsePort === null
      ? "Restart the MAGE gateway to enable per-server player counts."
      : `MAGE gateway returned player counts for ${
          responseHost || "unknown host"
        }:${responsePort ?? "unknown port"}, not ${server.host}:${server.port}.`;

  return {
    ...stats,
    backend: {
      mageHost: backend?.mageHost ?? null,
      magePort: backend?.magePort ?? null,
      checkedAt: backend?.checkedAt ?? Date.now(),
      ok: false,
      error,
    },
  };
}

function GatewayHealthPill({
  health,
  stats,
  showPopulation = true,
}: {
  health: GatewayHealth;
  stats: GatewayStats | null;
  showPopulation?: boolean;
}) {
  const backendError =
    stats?.backend?.ok === false &&
    stats.backend.error &&
    stats.backend.error !== "Not checked yet"
      ? stats.backend.error
      : null;
  const style =
    health === "online" && backendError
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : health === "online"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : health === "offline"
        ? "border-[color:var(--danger)]/25 bg-red-50 text-[color:var(--danger)]"
        : "border-border bg-white text-text-muted";
  const onlineUsers =
    typeof stats?.backend?.onlineUsers === "number"
      ? stats.backend.onlineUsers
      : null;
  const waiting = totalWaitingCount(stats);
  const label =
    health === "online"
      ? showPopulation
        ? backendError
          ? "gateway online · server unavailable"
          : onlineUsers === null
          ? waiting === null
            ? "gateway online · counting players"
            : `gateway online · counting players · ${formatWaitingCount(waiting)}`
          : `gateway online · ${onlineUsers.toLocaleString()} players · ${
              waiting === null ? "queue unknown" : formatWaitingCount(waiting)
            }`
        : "gateway online"
      : health === "offline"
        ? "gateway offline"
        : "checking gateway";
  const titleParts = showPopulation
    ? [
        backendError
          ? `MAGE server player count unavailable: ${backendError}`
          : onlineUsers === null
          ? stats?.backend?.error
            ? `MAGE server player count unavailable: ${stats.backend.error}`
            : "MAGE server player count is still loading."
          : `${onlineUsers.toLocaleString()} players are connected to the MAGE server.`,
        waiting === null
          ? "MAGE server waiting table count is unavailable."
          : `${waiting.toLocaleString()} human players are seated at public MAGE tables waiting for another human.`,
      ]
    : ["MAGE gateway status."];
  return (
    <span
      className={`max-w-72 shrink-0 truncate rounded-full border px-2.5 py-1 text-[11px] font-semibold ${style}`}
      title={titleParts.join(" ")}
    >
      {label}
    </span>
  );
}

function GameStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-1.5 rounded-lg border border-border bg-white px-2 text-xs">
      <span className="text-text-subtle">{label}</span>
      <span className="max-w-32 truncate font-semibold text-text">{value}</span>
    </div>
  );
}

function PhaseStepStat({ game }: { game: MageGameView | null }) {
  const style = phaseStepStyleForGame(game);
  const value = formatStep(game);
  return (
    <div
      className={`flex min-h-8 items-center gap-1.5 rounded-lg border px-2 text-xs ${style.statBorder} ${style.statBg}`}
    >
      <span className={style.textMuted}>Step</span>
      <span className={`max-w-36 truncate font-semibold ${style.text}`}>{value}</span>
    </div>
  );
}

function formatPlayerRating(player?: MagePlayerView): string {
  const rating = playerRatingValue(player);
  return rating === null ? "—" : rating.toLocaleString();
}

function playerRatingValue(player?: MagePlayerView): number | null {
  const userData = player?.userData;
  const candidates = [
    userData?.constructedRating,
    userData?.generalRating,
    userData?.limitedRating,
  ];
  for (const rating of candidates) {
    if (typeof rating === "number" && Number.isFinite(rating) && rating > 0) {
      return Math.round(rating);
    }
  }
  return null;
}

function ManaPoolStat({
  pool,
  payingMana,
  canAct,
  onSpend,
  onBlocked,
}: {
  pool: ManaPoolCounts;
  payingMana?: boolean;
  canAct?: boolean;
  onSpend?: (manaType: string) => void;
  onBlocked?: (message: string) => void;
}) {
  return (
    <div
      className={`flex min-h-8 items-center gap-2 rounded-lg border bg-white px-2 text-xs ${
        payingMana
          ? "border-accent ring-2 ring-accent/25"
          : "border-border"
      }`}
      title={
        payingMana
          ? "Pay mana — click a color to spend from your pool"
          : "Your mana pool — click a color when paying costs"
      }
    >
      <span className="text-text-subtle">Mana</span>
      <div className="flex items-center gap-1.5">
        {MANA_POOL_TYPES.map((mana) => {
          const count = pool[mana.key];
          const spendable = count > 0;
          const canSpend = spendable && !!payingMana && !!canAct;
          const manaType = POOL_KEY_TO_MANA_TYPE[mana.key];
          return (
            <button
              key={mana.key}
              type="button"
              disabled={!canAct}
              onClick={() => {
                if (!canAct) {
                  onBlocked?.("Connect to MAGE before spending mana.");
                  return;
                }
                if (!spendable) {
                  onBlocked?.(`No ${mana.label} mana in your pool.`);
                  return;
                }
                if (!payingMana) {
                  onBlocked?.(
                    "Play a spell or ability first. When the game asks you to pay mana, click a color here."
                  );
                  return;
                }
                onSpend?.(manaType);
              }}
              className={`flex items-center gap-1 rounded-md px-1 py-0.5 tabular-nums transition ${
                canSpend
                  ? "cursor-pointer bg-accent-subtle ring-1 ring-accent/40 hover:bg-accent-subtle"
                  : spendable
                    ? "cursor-pointer hover:bg-surface-subtle"
                    : "cursor-default opacity-50"
              }`}
              title={
                spendable
                  ? `Spend ${mana.label} mana (${count} available)`
                  : `No ${mana.label} mana`
              }
              aria-label={`${mana.label} mana: ${count}`}
            >
              <ManaPip symbol={mana.label} size={20} />
              <span className="min-w-[1ch] font-semibold tabular-nums text-text">
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TurnOwnerPill({
  self,
  game,
}: {
  self?: MagePlayerView;
  game?: MageGameView | null;
}) {
  const yours = isSelfActivePlayer(self, game ?? null);
  const ready = !!game?.activePlayerName || !!game?.activePlayerId;
  const label = !ready ? "Turn —" : yours ? "Your Turn" : "Opponent Turn";
  const style = !ready
    ? "border-border bg-white text-text-muted"
    : yours
      ? "border-blue-200 bg-blue-50 text-blue-700"
      : "border-red-200 bg-red-50 text-red-700";

  return (
    <span
      className={`flex min-h-8 items-center rounded-lg border px-2 text-xs font-semibold ${style}`}
    >
      {label}
    </span>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  disabledReason,
  onBlocked,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
  onBlocked?: (message: string) => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-disabled={disabled ? true : undefined}
      onClick={() => {
        if (disabled) {
          onBlocked?.(disabledReason ?? "That action is not available right now.");
          return;
        }
        onClick();
      }}
      className={`min-h-8 rounded-lg border px-2.5 py-1 text-xs transition ${
        danger
          ? "border-border bg-white text-text-muted hover:border-[color:var(--danger)] hover:text-[color:var(--danger)]"
          : "border-border bg-white text-text-muted hover:border-border-strong hover:text-text"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      {children}
    </button>
  );
}

function PlaytestToastOverlay({
  toast,
  onClose,
}: {
  toast: PlaytestToastState | null;
  onClose: () => void;
}) {
  if (!toast) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2"
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto flex items-start justify-between gap-3 rounded-lg border border-border bg-text px-3 py-2 text-sm text-white shadow-xl">
        <span className="min-w-0">{toast.message}</span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md px-1 text-xs text-white/70 hover:text-white"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function EventLogButton({
  eventCount,
  onOpen,
}: {
  eventCount: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-auto flex min-h-16 w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised px-3 py-2 text-left transition hover:border-border-strong hover:bg-white"
    >
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase text-text-muted">
          Event Log
        </div>
        <div className="mt-1 truncate text-sm font-semibold text-text">
          {eventCount > 0 ? `${eventCount} gateway events` : "No events yet"}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-[11px] text-text-subtle">
        <span className="rounded-full border border-border bg-white px-2 py-0.5 tabular-nums">
          {eventCount}
        </span>
        <span>Open</span>
      </div>
    </button>
  );
}

function EventLogPopup({
  open,
  onClose,
  events,
}: {
  open: boolean;
  onClose: () => void;
  events: MageGatewayEvent[];
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-end bg-black/20 p-3">
      <button
        type="button"
        aria-label="Close event log"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <section className="workspace-panel relative z-10 flex max-h-[min(42rem,calc(100vh-2rem))] w-full max-w-[34rem] flex-col gap-3 overflow-hidden rounded-lg bg-surface p-3 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase text-text-muted">
              Event Log
            </div>
            <div className="mt-0.5 text-xs text-text-subtle">
              {events.length} gateway events
            </div>
          </div>
          <ActionButton onClick={onClose}>Close</ActionButton>
        </div>

        <EventLog events={events} />
      </section>
    </div>
  );
}

function ConfirmPassTurnDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <button
        type="button"
        aria-label="Cancel passing the turn"
        className="absolute inset-0 cursor-default"
        onClick={onCancel}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-pass-turn-title"
        className="relative z-10 w-full max-w-sm rounded-xl border border-border bg-surface p-4 shadow-2xl"
      >
        <h2 id="confirm-pass-turn-title" className="text-base font-semibold">
          Pass the rest of your turn?
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          You will pass priority until the next turn starts.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <ActionButton onClick={onCancel}>Cancel</ActionButton>
          <button type="button" className="control-primary" onClick={onConfirm}>
            Pass Turn
          </button>
        </div>
      </section>
    </div>
  );
}

function PlayerZone({
  label,
  player,
  compact,
  combatRoles,
  playableIds,
  acceptsHandDrops,
  imageFor,
  interactiveIds,
  selectablePlayerIds,
  targetedIds,
  castingIds,
  canChooseCards,
  spectator,
  onCardActivate,
  onPlayCardFromHand,
  onPlayerSelect,
  onBlocked,
  onHover,
  onOpenZone,
}: {
  label: string;
  player?: MagePlayerView;
  compact?: boolean;
  combatRoles?: CombatRoles;
  playableIds?: Set<string>;
  acceptsHandDrops?: boolean;
  imageFor: (card: MageCardView) => string | undefined;
  interactiveIds: Set<string>;
  selectablePlayerIds: Set<string>;
  targetedIds: Set<string>;
  castingIds: Set<string>;
  canChooseCards: boolean;
  spectator: boolean;
  onCardActivate: (card: MageCardView) => void;
  onPlayCardFromHand?: (card: MageCardView) => boolean;
  onPlayerSelect?: (playerId: string) => void;
  onBlocked: (card: MageCardView) => void;
  onHover: (src: string | undefined, x: number, y: number) => void;
  onOpenZone: (state: ZoneViewerState) => void;
}) {
  const battlefield = cardsFromView(player?.battlefield);
  const layout = battlefieldLayout(battlefield);
  const lands = layout.roots.filter(isLandCard);
  const nonlands = layout.roots.filter((card) => !isLandCard(card));
  const graveyard = cardsFromView(player?.graveyard);
  const exile = cardsFromView(player?.exile);
  const sideboard = cardsFromView(player?.sideboard);
  const commanders = commanderCards(player);
  const name = player?.name ?? "Waiting for player";
  const playerSelectable =
    !spectator &&
    !!player?.playerId &&
    idInInteractiveSet(selectablePlayerIds, player.playerId);
  const playerTargeted =
    !!player?.playerId && idInInteractiveSet(targetedIds, player.playerId);

  const openZone = (
    title: string,
    cards: MageCardView[]
  ) => onOpenZone({ title: `${name} — ${title}`, cards });

  return (
    <section className="workspace-panel flex min-h-0 flex-col gap-2 overflow-hidden rounded-lg bg-surface p-2">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          {playerSelectable && player?.playerId && onPlayerSelect ? (
            <button
              type="button"
              onClick={() => onPlayerSelect(player.playerId!)}
              className={`flex min-w-0 max-w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left ring-2 ring-accent/70 transition hover:bg-accent-subtle ${
                playerTargeted ? "playtest-target-pulse" : ""
              }`}
              title={`Choose ${name}`}
            >
              <PlayerAvatar player={player} highlighted />
              <ZoneHeader label={label} count={battlefield.length} />
              <span className="max-w-52 truncate text-sm font-semibold text-accent">
                {name}
              </span>
            </button>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <PlayerAvatar player={player} />
              <ZoneHeader label={label} count={battlefield.length} />
              <span className="max-w-52 truncate text-sm font-semibold">{name}</span>
            </div>
          )}
          <PlayerStatusBar
            player={player}
            graveyard={graveyard}
            exile={exile}
            sideboard={sideboard}
            onOpenZone={openZone}
          />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-[11px]">
          <div className="flex flex-wrap justify-end gap-1">
            {player?.isActive && (
              <span className="rounded-full border border-accent/25 bg-accent-subtle px-2 py-0.5 font-medium text-accent">
                Active
              </span>
            )}
            {player?.hasPriority && (
              <span className="rounded-full border border-gold/25 bg-gold-subtle px-2 py-0.5 font-medium text-gold">
                Priority
              </span>
            )}
            <PlayerPassBadge player={player} />
          </div>
          <PlayerTimer player={player} />
        </div>
      </div>

      {commanders.length > 0 && (
        <CommandZoneRail
          commanders={commanders}
          imageFor={imageFor}
          interactiveIds={interactiveIds}
          playableIds={playableIds}
          targetedIds={targetedIds}
          castingIds={castingIds}
          canChooseCards={canChooseCards}
          spectator={spectator}
          combatRoles={combatRoles}
          onCardActivate={onCardActivate}
          onBlocked={onBlocked}
          onHover={onHover}
        />
      )}

      <MageDropZone
        enabled={acceptsHandDrops && !spectator}
        onDropCard={onPlayCardFromHand}
        className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(4.75rem,auto)] gap-2 overflow-hidden"
      >
        <CardRail
          cards={nonlands}
          emptyLabel={compact ? "No nonlands" : "No nonland permanents"}
          imageFor={imageFor}
          interactiveIds={interactiveIds}
          playableIds={playableIds}
          targetedIds={targetedIds}
          castingIds={castingIds}
          canChooseCards={canChooseCards}
          attachmentsByHost={layout.attachmentsByHost}
          combatRoles={combatRoles}
          cardContext="battlefield"
          spectator={spectator}
          onCardActivate={onCardActivate}
          onBlocked={onBlocked}
          onHover={onHover}
          cardWidth={compact ? 66 : CARD_WIDTH}
          className="h-full"
        />

        <div className="min-h-0 rounded-lg bg-surface-raised p-2 ring-1 ring-border/70">
          <ZoneHeader label="Lands" count={lands.length} />
          <CardRail
            cards={lands}
            emptyLabel="No lands"
            imageFor={imageFor}
            interactiveIds={interactiveIds}
            playableIds={playableIds}
            targetedIds={targetedIds}
            castingIds={castingIds}
            canChooseCards={canChooseCards}
            attachmentsByHost={layout.attachmentsByHost}
            combatRoles={combatRoles}
            cardContext="battlefield"
            spectator={spectator}
            onCardActivate={onCardActivate}
            onBlocked={onBlocked}
            onHover={onHover}
            cardWidth={compact ? 62 : 68}
            className="mt-1 max-h-[7.5rem] min-h-[4.75rem]"
          />
        </div>
      </MageDropZone>
    </section>
  );
}

function PlayerAvatar({
  player,
  highlighted,
}: {
  player?: MagePlayerView;
  highlighted?: boolean;
}) {
  const initial = (player?.name ?? "?").trim().charAt(0).toUpperCase() || "?";
  const flag = player?.userData?.flagName;
  return (
    <span
      ref={useRegisterAvatar(player?.playerId)}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-bold ${
        highlighted
          ? "border-accent bg-accent-subtle text-accent shadow-sm"
          : player?.controlled
            ? "border-accent/40 bg-accent-subtle text-accent"
            : "border-border bg-surface-raised text-text-muted"
      }`}
      title={flag ? `${player?.name} (${flag})` : player?.name}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

function useRegisterAvatar(playerId?: string) {
  const board = use(BoardContext);
  return useCallback(
    (el: HTMLElement | null) => {
      if (!playerId || !board) return;
      board.register(playerId, el);
    },
    [board, playerId]
  );
}

function PlayerStatusBar({
  player,
  graveyard,
  exile,
  sideboard,
  onOpenZone,
}: {
  player?: MagePlayerView;
  graveyard: MageCardView[];
  exile: MageCardView[];
  sideboard: MageCardView[];
  onOpenZone: (title: string, cards: MageCardView[]) => void;
}) {
  const counters = notableCounters(player);
  const pool = manaPoolFromView(player?.manaPool);
  const poolTotal = manaPoolTotal(pool);
  const matchScore =
    typeof player?.wins === "number" && typeof player?.winsNeeded === "number"
      ? `${player.wins}/${player.winsNeeded}`
      : null;
  const rating = playerRatingValue(player);

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-text-subtle">
      <span className="rounded-full border border-border bg-white px-1.5 py-0.5 font-semibold text-text">
        ♥ {player?.life ?? "—"}
      </span>
      {rating !== null && (
        <span
          className="rounded-full border border-border bg-white px-1.5 py-0.5 font-semibold text-text"
          title="MAGE constructed rating"
        >
          ELO {rating.toLocaleString()}
        </span>
      )}
      <span>Hand {player?.handCount ?? "—"}</span>
      <span>Library {player?.libraryCount ?? "—"}</span>
      <ZoneChip label="Grave" count={graveyard.length} onClick={() => onOpenZone("Graveyard", graveyard)} />
      <ZoneChip label="Exile" count={exile.length} onClick={() => onOpenZone("Exile", exile)} />
      {sideboard.length > 0 && (
        <ZoneChip
          label="Sideboard"
          count={sideboard.length}
          onClick={() => onOpenZone("Sideboard", sideboard)}
        />
      )}
      {matchScore && <span title="Match wins">🏆 {matchScore}</span>}
      {player?.monarch && (
        <span className="rounded-full border border-gold/30 bg-gold-subtle px-1.5 py-0.5 font-semibold text-gold">
          Monarch
        </span>
      )}
      {player?.initiative && (
        <span className="rounded-full border border-violet-300 bg-violet-50 px-1.5 py-0.5 font-semibold text-violet-700">
          Initiative
        </span>
      )}
      {counters.map((counter) => (
        <span
          key={`${counter.name}-${counter.count}`}
          className={`rounded-full border px-1.5 py-0.5 font-semibold capitalize ${counterStyle(
            counter.name
          )}`}
          title={`${counter.name} counters`}
        >
          {counter.name} {counter.count}
        </span>
      ))}
      {(player?.designationNames ?? []).map((designation) => (
        <span
          key={designation}
          className="rounded-full border border-border bg-white px-1.5 py-0.5 font-medium text-text-muted"
        >
          {designation}
        </span>
      ))}
      {poolTotal > 0 && <InlineManaPool pool={pool} />}
    </div>
  );
}

function ZoneChip({
  label,
  count,
  onClick,
}: {
  label: string;
  count: number;
  onClick: () => void;
}) {
  const disabled = count === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full border px-1.5 py-0.5 font-medium transition ${
        disabled
          ? "cursor-default border-border bg-white text-text-subtle"
          : "border-border bg-white text-text-muted hover:border-border-strong hover:text-text"
      }`}
      title={disabled ? `${label} is empty` : `View ${label.toLowerCase()} (${count})`}
    >
      {label} {count}
    </button>
  );
}

function InlineManaPool({ pool }: { pool: ManaPoolCounts }) {
  return (
    <span className="flex items-center gap-1" title="Mana pool">
      {MANA_POOL_TYPES.filter((mana) => pool[mana.key] > 0).map((mana) => (
        <span key={mana.key} className="flex items-center gap-0.5 tabular-nums">
          <span
            className="grid h-4 w-4 place-items-center rounded-full border border-black/15 text-[9px] font-bold text-stone-950"
            style={{ background: mana.color }}
            aria-hidden="true"
          >
            {mana.label}
          </span>
          <span className="font-semibold text-text">{pool[mana.key]}</span>
        </span>
      ))}
    </span>
  );
}

function PlayerTimer({ player }: { player?: MagePlayerView }) {
  if (!player?.timerActive || typeof player.priorityTimeLeftSecs !== "number") {
    return null;
  }
  const low = player.priorityTimeLeftSecs <= 30;
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
        low
          ? "border-[color:var(--danger)]/30 bg-red-50 text-[color:var(--danger)]"
          : "border-border bg-white text-text-muted"
      }`}
      title="Priority time remaining"
    >
      ⏱ {formatTimer(player.priorityTimeLeftSecs)}
    </span>
  );
}

function PlayerPassBadge({ player }: { player?: MagePlayerView }) {
  const skipping =
    player?.passedAllTurns ||
    player?.passedTurn ||
    player?.passedUntilEndOfTurn ||
    player?.passedUntilNextMain ||
    player?.passedUntilStackResolved ||
    player?.passedUntilEndStepBeforeMyTurn;
  if (!skipping) return null;
  return (
    <span
      className="rounded-full border border-border bg-surface-subtle px-2 py-0.5 font-medium text-text-subtle"
      title="This player is skipping priority"
    >
      Skipping
    </span>
  );
}

function CommandZoneRail({
  commanders,
  imageFor,
  interactiveIds,
  playableIds,
  targetedIds,
  castingIds,
  canChooseCards,
  spectator,
  combatRoles,
  onCardActivate,
  onBlocked,
  onHover,
}: {
  commanders: MageCardView[];
  imageFor: (card: MageCardView) => string | undefined;
  interactiveIds: Set<string>;
  playableIds?: Set<string>;
  targetedIds: Set<string>;
  castingIds: Set<string>;
  canChooseCards: boolean;
  spectator: boolean;
  combatRoles?: CombatRoles;
  onCardActivate: (card: MageCardView) => void;
  onBlocked: (card: MageCardView) => void;
  onHover: (src: string | undefined, x: number, y: number) => void;
}) {
  return (
    <div className="shrink-0 rounded-lg border border-gold/30 bg-gold-subtle/40 p-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase text-gold">Command</span>
        <CardRail
          cards={commanders}
          emptyLabel="Command zone empty"
          imageFor={imageFor}
          interactiveIds={interactiveIds}
          playableIds={playableIds}
          targetedIds={targetedIds}
          castingIds={castingIds}
          canChooseCards={canChooseCards}
          combatRoles={combatRoles}
          cardContext="command"
          spectator={spectator}
          onCardActivate={onCardActivate}
          onBlocked={onBlocked}
          onHover={onHover}
          cardWidth={52}
          wrap={false}
          className="max-h-[5rem] bg-transparent p-0"
        />
      </div>
    </div>
  );
}

function StackZone({
  cards,
  imageFor,
  interactiveIds,
  playableIds,
  targetedIds,
  castingIds,
  canChooseCards,
  spectator,
  onCardActivate,
  onBlocked,
  onHover,
}: {
  cards: MageCardView[];
  imageFor: (card: MageCardView) => string | undefined;
  interactiveIds: Set<string>;
  playableIds?: Set<string>;
  targetedIds: Set<string>;
  castingIds: Set<string>;
  canChooseCards: boolean;
  spectator: boolean;
  onCardActivate: (card: MageCardView) => void;
  onBlocked: (card: MageCardView) => void;
  onHover: (src: string | undefined, x: number, y: number) => void;
}) {
  return (
    <section className="shrink-0 rounded-lg border border-border bg-surface-raised p-2">
      <div className="flex min-h-10 items-center justify-between gap-3">
        <ZoneHeader label="Stack" count={cards.length} />
        {cards.length === 0 && (
          <span className="text-xs text-text-subtle">Stack empty</span>
        )}
      </div>
      {cards.length > 0 && (
        <CardRail
          cards={cards}
          emptyLabel="Stack empty"
          imageFor={imageFor}
          interactiveIds={interactiveIds}
          playableIds={playableIds}
          targetedIds={targetedIds}
          castingIds={castingIds}
          canChooseCards={canChooseCards}
          cardContext="stack"
          spectator={spectator}
          onCardActivate={onCardActivate}
          onBlocked={onBlocked}
          onHover={onHover}
          cardWidth={72}
          wrap={false}
          className="max-h-[7.25rem]"
        />
      )}
    </section>
  );
}

function ExileZone({
  cards,
  imageFor,
  interactiveIds,
  playableIds,
  targetedIds,
  castingIds,
  canChooseCards,
  spectator,
  onCardActivate,
  onBlocked,
  onHover,
}: {
  cards: ExileCardView[];
  imageFor: (card: MageCardView) => string | undefined;
  interactiveIds: Set<string>;
  playableIds?: Set<string>;
  targetedIds: Set<string>;
  castingIds: Set<string>;
  canChooseCards: boolean;
  spectator: boolean;
  onCardActivate: (card: MageCardView) => void;
  onBlocked: (card: MageCardView) => void;
  onHover: (src: string | undefined, x: number, y: number) => void;
}) {
  return (
    <section className="mt-2 shrink-0 rounded-lg border border-border bg-surface-raised p-2">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <ZoneHeader label="Exile" count={cards.length} />
        {cards.length === 0 && (
          <span className="text-xs text-text-subtle">No exiled cards</span>
        )}
      </div>
      {cards.length > 0 && (
        <CardRail
          cards={cards}
          emptyLabel="No exiled cards"
          imageFor={imageFor}
          interactiveIds={interactiveIds}
          playableIds={playableIds}
          targetedIds={targetedIds}
          castingIds={castingIds}
          canChooseCards={canChooseCards}
          spectator={spectator}
          onCardActivate={onCardActivate}
          onBlocked={onBlocked}
          onHover={onHover}
          cardWidth={58}
          wrap={false}
          className="max-h-[6rem]"
        />
      )}
    </section>
  );
}

function HandZone({
  hands,
  activeHandKey,
  onActiveHandChange,
  status,
  imageFor,
  interactiveIds,
  playableIds,
  targetedIds,
  castingIds,
  canChooseCards,
  spectator,
  onCardActivate,
  onBlocked,
  onHover,
}: {
  hands: VisibleHandView[];
  activeHandKey: string;
  onActiveHandChange: (key: string) => void;
  status: Status;
  imageFor: (card: MageCardView) => string | undefined;
  interactiveIds: Set<string>;
  playableIds?: Set<string>;
  targetedIds: Set<string>;
  castingIds: Set<string>;
  canChooseCards: boolean;
  spectator: boolean;
  onCardActivate: (card: MageCardView) => void;
  onBlocked: (card: MageCardView) => void;
  onHover: (src: string | undefined, x: number, y: number) => void;
}) {
  const activeHand =
    hands.find((hand) => hand.key === activeHandKey) ?? hands[0];
  const cards = activeHand?.cards ?? [];
  const isOwnHand = activeHand?.isOwnHand ?? false;
  const canSwitch = hands.length > 1;

  return (
    <section className="workspace-panel flex min-h-0 flex-col gap-2 overflow-hidden rounded-lg bg-surface p-2">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <ZoneHeader
            label={activeHand?.shortLabel ?? "Hand"}
            count={cards.length}
          />
          <span className="truncate text-[11px] text-text-subtle">
            {spectator
              ? "Watching revealed hands."
              : isOwnHand
                ? "Playable cards and valid choices are highlighted."
                : "Revealed hand — use Switch Hand to return to yours."}
          </span>
        </div>
        {canSwitch && (
          <div className="flex flex-wrap gap-1.5">
            {hands.map((hand) => {
              const active = hand.key === activeHandKey;
              return (
                <button
                  key={hand.key}
                  type="button"
                  onClick={() => onActiveHandChange(hand.key)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                    active
                      ? "border-accent bg-accent-subtle text-accent"
                      : "border-border bg-white text-text-muted hover:border-accent/40 hover:text-text"
                  }`}
                  title={hand.label}
                >
                  {hand.shortLabel}
                  <span className="ml-1 tabular-nums text-text-subtle">
                    ({hand.cards.length})
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <CardRail
        cards={cards}
        emptyLabel={
          status === "connected"
            ? spectator && hands.length === 0
              ? "No hands to display."
              : isOwnHand
                ? "Your hand is empty."
                : "This hand is empty."
            : "Start a MAGE game to see your hand."
        }
        imageFor={imageFor}
        interactiveIds={interactiveIds}
        playableIds={isOwnHand ? playableIds : undefined}
        targetedIds={targetedIds}
        castingIds={castingIds}
        canChooseCards={canChooseCards}
        cardContext={isOwnHand ? "hand" : "zone"}
        spectator={spectator}
        onCardActivate={onCardActivate}
        onBlocked={onBlocked}
        onHover={onHover}
        cardWidth={HAND_CARD_WIDTH}
        wrap={false}
        className="h-full"
        draggableFromHand={isOwnHand && !spectator}
      />
    </section>
  );
}

function MageDropZone({
  enabled,
  onDropCard,
  className,
  children,
}: {
  enabled?: boolean;
  onDropCard?: (card: MageCardView) => boolean;
  className?: string;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const depthRef = useRef(0);

  if (!enabled || !onDropCard) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      className={`${className ?? ""} ${
        over ? "outline outline-2 outline-accent/70 outline-offset-2" : ""
      }`}
      onDragEnter={(event) => {
        event.preventDefault();
        depthRef.current += 1;
        setOver(true);
      }}
      onDragLeave={() => {
        depthRef.current = Math.max(0, depthRef.current - 1);
        if (depthRef.current === 0) setOver(false);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        depthRef.current = 0;
        setOver(false);
        const raw = event.dataTransfer.getData(MAGE_CARD_DRAG_TYPE);
        if (!raw) return;
        try {
          const payload = JSON.parse(raw) as MageCardDragPayload;
          if (payload.from !== "hand" || !payload.id) return;
          onDropCard({ id: payload.id, name: payload.id });
        } catch {
          // ignore malformed drops
        }
      }}
    >
      {children}
    </div>
  );
}

function CardRail({
  cards,
  emptyLabel,
  imageFor,
  interactiveIds,
  playableIds,
  targetedIds,
  castingIds,
  canChooseCards,
  attachmentsByHost,
  combatRoles,
  cardContext = "zone",
  spectator,
  onCardActivate,
  onBlocked,
  onHover,
  cardWidth = CARD_WIDTH,
  wrap = true,
  draggableFromHand = false,
  className = "",
}: {
  cards: MageCardView[];
  emptyLabel: string;
  imageFor: (card: MageCardView) => string | undefined;
  interactiveIds: Set<string>;
  playableIds?: Set<string>;
  targetedIds: Set<string>;
  castingIds: Set<string>;
  canChooseCards: boolean;
  attachmentsByHost?: Map<string, MageCardView[]>;
  combatRoles?: CombatRoles;
  cardContext?: CardActionContext;
  spectator: boolean;
  onCardActivate: (card: MageCardView) => void;
  onBlocked: (card: MageCardView) => void;
  onHover: (src: string | undefined, x: number, y: number) => void;
  cardWidth?: number;
  wrap?: boolean;
  draggableFromHand?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`thin-scroll min-h-0 overflow-auto rounded-lg bg-surface-raised p-2 ${className}`}
    >
      {cards.length > 0 ? (
        <div
          className={`min-h-full gap-2 ${
            wrap ? "flex flex-wrap content-start items-start" : "flex"
          }`}
        >
          {cards.map((card) => {
            const cardId = card.id ?? "";
            const highlighted = cardId ? idInInteractiveSet(interactiveIds, cardId) : false;
            const targeted = targetedIds.has(cardId);
            const casting = castingIds.has(cardId);
            const attachments = cardId ? attachmentsByHost?.get(cardId) : undefined;
            const playable =
              !!cardId && !!playableIds && idInInteractiveSet(playableIds, cardId);
            const possibleAttacker =
              !!cardId &&
              !!combatRoles?.possibleAttackers &&
              idInInteractiveSet(combatRoles.possibleAttackers, cardId);
            const possibleBlocker =
              !!cardId &&
              !!combatRoles?.possibleBlockers &&
              idInInteractiveSet(combatRoles.possibleBlockers, cardId);
            const interactive =
              !spectator &&
              (highlighted ||
                playable ||
                possibleAttacker ||
                possibleBlocker ||
                (canChooseCards && interactiveIds.size === 0));
            const draggable =
              !spectator &&
              !!cardId &&
              draggableFromHand &&
              cardContext === "hand" &&
              playable;
            return (
              <MageCardTile
                key={card.id ?? card.name}
                card={card}
                context={cardContext}
                attachments={attachments}
                attachmentImages={attachments?.map((attachment) => imageFor(attachment))}
                width={cardWidth}
                image={imageFor(card)}
                sourceImage={
                  "exiledBy" in card && card.exiledBy
                    ? imageFor(card.exiledBy)
                    : undefined
                }
                interactive={interactive}
                playable={playable}
                highlighted={highlighted}
                targeted={targeted}
                casting={casting}
                draggable={draggable}
                attacking={
                  !!cardId &&
                  !!combatRoles &&
                  idInInteractiveSet(combatRoles.attackers, cardId)
                }
                blocking={
                  !!cardId &&
                  !!combatRoles &&
                  idInInteractiveSet(combatRoles.blockers, cardId)
                }
                possibleAttacker={possibleAttacker}
                possibleBlocker={possibleBlocker}
                onActivate={onCardActivate}
                onBlocked={onBlocked}
                onHover={onHover}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex h-full min-h-12 items-center px-2 text-xs text-text-subtle">
          {emptyLabel}
        </div>
      )}
    </div>
  );
}

function MageCardTile({
  card,
  context = "zone",
  attachments,
  attachmentImages,
  width,
  image,
  sourceImage,
  interactive,
  playable,
  highlighted,
  targeted,
  casting,
  draggable: draggableCard,
  attacking,
  blocking,
  possibleAttacker,
  possibleBlocker,
  onActivate,
  onBlocked,
  onHover,
}: {
  card: MageCardView;
  context?: CardActionContext;
  attachments?: MageCardView[];
  attachmentImages?: Array<string | undefined>;
  width: number;
  image?: string;
  sourceImage?: string;
  interactive: boolean;
  playable?: boolean;
  highlighted: boolean;
  targeted: boolean;
  casting: boolean;
  draggable?: boolean;
  attacking?: boolean;
  blocking?: boolean;
  possibleAttacker?: boolean;
  possibleBlocker?: boolean;
  onActivate: (card: MageCardView) => void;
  onBlocked: (card: MageCardView) => void;
  onHover: (src: string | undefined, x: number, y: number) => void;
}) {
  const board = use(BoardContext);
  const finePointer = useFinePointer();
  const height = Math.round(width * 1.4);
  const tapped = card.tapped === true || card.rotate === true;
  const slotW = tapped ? height : width;
  const slotH = tapped ? width : height;
  const name = cardName(card);
  const abilityOnStack = context === "stack" && isMageAbility(card);
  const attachmentCount = attachments?.length ?? 0;
  const attachmentOffset = Math.min(attachmentCount, 3) * 8;
  const isPermanent = context === "battlefield" || context === "command";
  const pt = isPermanent ? powerToughness(card) : "";
  const damage = typeof card.damage === "number" ? card.damage : 0;
  const summoningSick = isPermanent && card.summoningSickness === true;

  const registerRef = useCallback(
    (el: HTMLElement | null) => {
      if (!board || !card.id) return;
      board.register(card.id, el);
    },
    [board, card.id]
  );

  const onContextMenu = (event: React.MouseEvent) => {
    if (!board) return;
    event.preventDefault();
    board.inspect(card);
    board.openContextMenu(card, context, event.clientX, event.clientY);
  };

  const combatClass = attacking
    ? "playtest-attacker"
    : blocking
      ? "playtest-blocker"
      : possibleAttacker
        ? "playtest-possible-attacker-pulse"
        : possibleBlocker
          ? "playtest-possible-blocker-pulse"
          : "";

  const onDragStart = (event: React.DragEvent) => {
    if (!draggableCard || !card.id) return;
    event.dataTransfer.effectAllowed = "move";
    const payload: MageCardDragPayload = { id: card.id, from: context };
    event.dataTransfer.setData(MAGE_CARD_DRAG_TYPE, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", card.id);
  };

  return (
    <div
      ref={registerRef}
      data-card-id={card.id ?? undefined}
      className="relative shrink-0"
      style={{ width: slotW + attachmentOffset, height: slotH + attachmentOffset }}
      onMouseLeave={() => onHover(undefined, 0, 0)}
    >
      {attachments?.slice(0, 3).map((attachment, index) => (
        <MiniAttachedCard
          key={attachment.id ?? `${attachment.name}-${index}`}
          card={attachment}
          image={attachmentImages?.[index]}
          width={width}
          height={height}
          offset={(index + 1) * 8}
          onHover={onHover}
        />
      ))}
      <div
        role="button"
        tabIndex={interactive ? 0 : -1}
        aria-disabled={!interactive}
        draggable={draggableCard && finePointer}
        onDragStart={onDragStart}
        title={name}
        onMouseEnter={(event) => onHover(image, event.clientX, event.clientY)}
        onMouseMove={(event) => onHover(image, event.clientX, event.clientY)}
        onContextMenu={onContextMenu}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          board?.inspect(card);
          if (interactive) {
            onActivate(card);
            return;
          }
          onBlocked(card);
        }}
        onClick={() => {
          board?.inspect(card);
          if (interactive) {
            onActivate(card);
            return;
          }
          onBlocked(card);
        }}
        className={`absolute left-0 top-0 z-10 select-none text-left transition ${
          draggableCard && finePointer
            ? "cursor-grab active:cursor-grabbing"
            : interactive
              ? "cursor-pointer"
              : "cursor-default"
        } ${targeted ? "playtest-target-pulse" : ""} ${
          casting ? "playtest-cast-pulse" : ""
        }`}
        style={{
          width,
          height,
          transformOrigin: `${width / 2}px ${height / 2}px`,
          transform: tapped
            ? `translate(${(height - width) / 2}px, ${(width - height) / 2}px) rotate(90deg)`
            : "rotate(0deg)",
        }}
      >
        {image ? (
          <img
            src={image}
            alt={name}
            draggable={false}
            className={`h-full w-full rounded-lg object-cover shadow-sm ring-1 ring-black/20 ${
              playable
                ? "ring-2 ring-emerald-400 playtest-playable-outline"
                : highlighted
                  ? "ring-2 ring-accent"
                  : ""
            } ${combatClass}`}
          />
        ) : (
          <div
            className={`flex h-full w-full flex-col justify-between rounded-lg bg-surface-subtle p-2 text-[10px] text-text-muted shadow-sm ring-1 ring-black/20 ${
              playable
                ? "ring-2 ring-emerald-400 playtest-playable-outline"
                : highlighted
                  ? "ring-2 ring-accent"
                  : ""
            } ${combatClass}`}
          >
            <div>
              <div className="font-semibold text-text">{name}</div>
              <div className="mt-1 line-clamp-4">{typeLine(card)}</div>
            </div>
            <div className="flex items-center justify-between gap-1 text-[10px]">
              <ManaCost cost={manaCost(card)} size={10} />
              {pt ? <span>{pt}</span> : null}
            </div>
          </div>
        )}
      </div>

      {abilityOnStack && image && (
        <span
          className="pointer-events-none absolute left-1 top-1 z-20 rounded bg-black/75 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white"
          title="Stacked ability"
        >
          Ability
        </span>
      )}

      {summoningSick && (
        <span
          className="pointer-events-none absolute right-1 top-1 z-20 grid h-4 w-4 place-items-center rounded-full bg-black/70 text-[10px] text-white"
          title="Summoning sickness"
          aria-hidden="true"
        >
          ✦
        </span>
      )}

      {(attacking || blocking) && (
        <span
          className={`pointer-events-none absolute left-1 bottom-1 z-20 rounded px-1 py-0.5 text-[9px] font-bold uppercase text-white ${
            attacking ? "bg-[color:var(--danger)]" : "bg-blue-600"
          }`}
        >
          {attacking ? "ATK" : "BLK"}
        </span>
      )}

      {isPermanent && pt && (
        <span
          className={`pointer-events-none absolute bottom-1 right-1 z-20 rounded-md px-1 py-0.5 text-[10px] font-bold tabular-nums shadow ${
            damage > 0
              ? "bg-[color:var(--danger)] text-white"
              : "bg-black/80 text-white"
          }`}
          title={damage > 0 ? `${pt} (${damage} damage marked)` : pt}
        >
          {damage > 0 ? `${pt} −${damage}` : pt}
        </span>
      )}

      {sourceImage && (
        <img
          src={sourceImage}
          alt="Exiled by"
          draggable={false}
          className="pointer-events-none absolute bottom-1 right-1 z-10 h-[42%] rounded shadow-md ring-1 ring-black/30"
        />
      )}
      {card.counters && card.counters.length > 0 && (
        <div className="pointer-events-none absolute left-1 top-1 z-20 flex flex-col gap-0.5">
          {card.counters.slice(0, 3).map((counter) => (
            <span
              key={`${counter.name}-${counter.count}`}
              className="rounded-full bg-black/80 px-1.5 py-0.5 text-[10px] font-semibold text-white"
            >
              {counter.name} {counter.count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const ATTACHMENT_HOVER_Y_OFFSET = 100;

function MiniAttachedCard({
  card,
  image,
  width,
  height,
  offset,
  onHover,
}: {
  card: MageCardView;
  image?: string;
  width: number;
  height: number;
  offset: number;
  onHover: (src: string | undefined, x: number, y: number) => void;
}) {
  const name = cardName(card);
  const showHover = (event: React.MouseEvent) => {
    if (!image) return;
    onHover(image, event.clientX, event.clientY - ATTACHMENT_HOVER_Y_OFFSET);
  };
  return (
    <div
      className="pointer-events-auto absolute rounded-lg bg-surface-subtle shadow-sm ring-1 ring-black/20"
      style={{
        left: offset,
        top: offset,
        width,
        height,
        zIndex: 1,
      }}
      title={name}
      onMouseEnter={showHover}
      onMouseMove={showHover}
    >
      {image ? (
        <img
          src={image}
          alt={name}
          draggable={false}
          className="h-full w-full rounded-lg object-cover opacity-80"
        />
      ) : (
        <div className="flex h-full w-full items-end rounded-lg p-1 text-[9px] font-semibold text-text-muted opacity-80">
          <span className="line-clamp-2">{name}</span>
        </div>
      )}
    </div>
  );
}

type ManaPaymentParse = {
  totalSymbols: string[];
  remainingSymbols: string[];
  cardTitle: string;
  totalCost: string;
  remainingCost: string;
};

const MANA_PIP_SIZE = 24;
const MANA_PIP_SIZE_SM = 20;

function promptPanelKey(prompt: MageGatewayEvent | null): string {
  if (!prompt) return "idle";
  const method = prompt.callbackMethod ?? prompt.type ?? "";
  if (method === "GAME_PLAY_MANA" || method === "GAME_PLAY_XMANA") {
    return `mana:${prompt.messageId ?? "payment"}`;
  }
  return `${prompt.messageId ?? ""}:${prompt.sequence ?? ""}`;
}

/** One generic mana pip when expanding costs like {2} → two units. */
const GENERIC_MANA_UNIT = "{@}";

function expandManaPaymentSymbols(symbols: string[]): string[] {
  const expanded: string[] = [];
  for (const symbol of symbols) {
    const inner = manaSymbolInner(symbol);
    if (/^\d+$/.test(inner)) {
      const count = Number.parseInt(inner, 10);
      for (let i = 0; i < count; i++) expanded.push(GENERIC_MANA_UNIT);
      continue;
    }
    expanded.push(symbol);
  }
  return expanded;
}

function collapseManaPaymentSymbols(symbols: string[]): string[] {
  const collapsed: string[] = [];
  let genericCount = 0;

  const flushGeneric = () => {
    if (genericCount <= 0) return;
    collapsed.push(`{${genericCount}}`);
    genericCount = 0;
  };

  for (const symbol of symbols) {
    if (symbol === GENERIC_MANA_UNIT) {
      genericCount += 1;
      continue;
    }
    flushGeneric();
    collapsed.push(symbol);
  }
  flushGeneric();
  return collapsed;
}

function manaPaymentWeight(symbols: string[]): number {
  return expandManaPaymentSymbols(symbols).length;
}

function useManaPaymentTotal(prompt: MageGatewayEvent | null): string[] {
  const [totalSymbols, setTotalSymbols] = useState<string[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const method = prompt?.callbackMethod ?? prompt?.type;
      if (method !== "GAME_PLAY_MANA") {
        setTotalSymbols([]);
      }
      const parsed = parseManaPaymentMessage(plainMageText(prompt?.message));
      if (!parsed || parsed.totalSymbols.length === 0) return;

      setTotalSymbols((prev) => {
        if (prev.length === 0) return [...parsed.totalSymbols];
        if (manaPaymentWeight(parsed.totalSymbols) > manaPaymentWeight(prev)) {
          return [...parsed.totalSymbols];
        }
        return prev;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [prompt?.callbackMethod, prompt?.message, prompt?.messageId, prompt?.type]);

  return totalSymbols;
}

function parseManaPaymentMessage(message: string): ManaPaymentParse | null {
  const text = plainMageText(message);
  const payMatch = text.match(/^Pay\s+((?:\{[^}]+\})+)/i);
  if (!payMatch) return null;

  const totalCost = payMatch[1];
  const totalSymbols = totalCost.match(/\{[^}]+\}/g) ?? [];
  if (totalSymbols.length === 0) return null;

  const cardTitle = stripMageCardId(text.slice(payMatch[0].length).trim());
  return {
    totalSymbols,
    remainingSymbols: [...totalSymbols],
    cardTitle,
    totalCost,
    remainingCost: totalCost,
  };
}

function stripMageCardId(title: string): string {
  return title.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
}

function diffManaSymbolMultiset(
  total: string[],
  remaining: string[]
): { paid: string[]; stillOwed: string[] } {
  const remCounts = new Map<string, number>();
  for (const symbol of remaining) {
    remCounts.set(symbol, (remCounts.get(symbol) ?? 0) + 1);
  }
  const paid: string[] = [];
  const stillOwed: string[] = [];
  for (const symbol of total) {
    const left = remCounts.get(symbol) ?? 0;
    if (left > 0) {
      remCounts.set(symbol, left - 1);
      stillOwed.push(symbol);
    } else {
      paid.push(symbol);
    }
  }
  return { paid, stillOwed };
}

function manaSymbolInner(symbol: string): string {
  return symbol.replace(/^\{|\}$/g, "").toUpperCase();
}

function isGenericManaSymbol(symbol: string): boolean {
  if (symbol === GENERIC_MANA_UNIT) return true;
  const inner = manaSymbolInner(symbol);
  return /^\d+$/.test(inner) || inner === "X";
}

function poolKeyForManaSymbol(symbol: string): keyof ManaPoolCounts | null {
  const inner = manaSymbolInner(symbol);
  if (inner === "W") return "white";
  if (inner === "U") return "blue";
  if (inner === "B") return "black";
  if (inner === "R") return "red";
  if (inner === "G") return "green";
  if (inner === "C") return "colorless";
  return null;
}

function remainingNeedsPoolKey(
  remainingSymbols: string[],
  key: keyof ManaPoolCounts
): boolean {
  if (remainingSymbols.some(isGenericManaSymbol)) return true;
  for (const symbol of remainingSymbols) {
    if (poolKeyForManaSymbol(symbol) === key) return true;
  }
  return false;
}

const POOL_KEY_TO_PIP: Record<keyof ManaPoolCounts, string> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
  colorless: "C",
};

function removeOneManaPayment(
  remaining: string[],
  manaType: string
): string[] {
  const expanded = expandManaPaymentSymbols(remaining);
  const key = MANA_TYPE_TO_POOL_KEY[manaType.toUpperCase()];
  if (!key) return remaining;
  const pip = POOL_KEY_TO_PIP[key];

  const coloredIndex = expanded.findIndex(
    (symbol) =>
      symbol !== GENERIC_MANA_UNIT && manaSymbolInner(symbol) === pip
  );
  if (coloredIndex >= 0) {
    return collapseManaPaymentSymbols(
      expanded.filter((_, index) => index !== coloredIndex)
    );
  }

  const genericIndex = expanded.findIndex((symbol) => symbol === GENERIC_MANA_UNIT);
  if (genericIndex >= 0) {
    return collapseManaPaymentSymbols(
      expanded.filter((_, index) => index !== genericIndex)
    );
  }

  return remaining;
}

function ManaSymbolRow({
  symbols,
  size = MANA_PIP_SIZE,
  paid = false,
}: {
  symbols: string[];
  size?: number;
  paid?: boolean;
}) {
  if (symbols.length === 0) {
    return <span className="text-xs text-text-muted">—</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-0.5">
      {symbols.map((symbol, index) => (
        <span
          key={`${symbol}-${index}`}
          className={paid ? "opacity-40 grayscale" : ""}
          title={symbol}
        >
          <ManaPip
            symbol={
              symbol === GENERIC_MANA_UNIT ? "C" : manaSymbolInner(symbol)
            }
            size={size}
          />
        </span>
      ))}
    </span>
  );
}

function ManaPaymentPanel({
  prompt,
  pool,
  frozenTotalSymbols,
  canAct,
  onSpend,
  onBlocked,
  onDone,
}: {
  prompt: MageGatewayEvent;
  pool: ManaPoolCounts;
  frozenTotalSymbols: string[];
  canAct: boolean;
  onSpend: (manaType: string) => void;
  onBlocked: (message: string) => void;
  onDone: () => void;
}) {
  const paymentId = String(prompt.messageId ?? "payment");
  const [remainingSymbols, setRemainingSymbols] = useState<string[]>([]);
  const initializedPaymentRef = useRef<string | null>(null);

  const currentParse = useMemo(
    () => parseManaPaymentMessage(plainMageText(prompt.message)),
    [prompt.message]
  );

  useEffect(() => {
    if (!currentParse) return;
    const serverRemaining = currentParse.remainingSymbols;

    if (initializedPaymentRef.current !== paymentId) {
      initializedPaymentRef.current = paymentId;
      setRemainingSymbols([...serverRemaining]);
      return;
    }

    setRemainingSymbols((prev) => {
      if (manaPaymentWeight(serverRemaining) < manaPaymentWeight(prev)) {
        return [...serverRemaining];
      }
      return prev;
    });
  }, [currentParse, paymentId]);

  const baseline =
    frozenTotalSymbols.length > 0
      ? frozenTotalSymbols
      : currentParse?.totalSymbols ?? [];
  const baselineExpanded = useMemo(
    () => expandManaPaymentSymbols(baseline),
    [baseline]
  );
  const remainingExpanded = useMemo(
    () => expandManaPaymentSymbols(remainingSymbols),
    [remainingSymbols]
  );
  const { paid: paidExpanded, stillOwed: stillOwedExpanded } = diffManaSymbolMultiset(
    baselineExpanded,
    remainingExpanded
  );
  const paid = collapseManaPaymentSymbols(paidExpanded);
  const stillOwed = collapseManaPaymentSymbols(stillOwedExpanded);

  const handleSpend = (manaType: string) => {
    onSpend(manaType);
    setRemainingSymbols((prev) => removeOneManaPayment(prev, manaType));
  };
  const cardTitle = currentParse?.cardTitle ?? "";
  const fallbackCost =
    baseline.length > 0
      ? baseline.join("")
      : currentParse?.totalCost ?? plainMageText(prompt.message);
  const allPaid =
    baseline.length > 0 && manaPaymentWeight(remainingSymbols) === 0;

  return (
    <div className="mt-3 w-full space-y-3">
      {cardTitle ? (
        <div className="text-sm font-semibold leading-snug text-text">{cardTitle}</div>
      ) : null}

      <div className="rounded-lg border border-border bg-white p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
          Total cost
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {baseline.length > 0 ? (
            <ManaSymbolRow symbols={baseline} size={MANA_PIP_SIZE} />
          ) : (
            <ManaCost cost={fallbackCost} size={MANA_PIP_SIZE} />
          )}
        </div>

        {paid.length > 0 ? (
          <div className="mt-3">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              Paid
            </div>
            <div className="mt-1.5">
              <ManaSymbolRow symbols={paid} size={MANA_PIP_SIZE_SM} paid />
            </div>
          </div>
        ) : null}

        <div className="mt-3 border-t border-border/80 pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              Remaining
            </div>
            {allPaid ? (
              <span className="text-[10px] font-semibold text-emerald-700">Paid</span>
            ) : null}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {stillOwed.length > 0 ? (
              <ManaSymbolRow symbols={stillOwed} size={MANA_PIP_SIZE} />
            ) : (
              <span className="text-xs text-emerald-700">Nothing left — finish below</span>
            )}
          </div>
        </div>
      </div>

      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
          Spend from pool
        </div>
        <p className="mt-1 text-xs text-text-muted">
          Tap lands on the battlefield, then click a mana symbol you have in your pool.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {MANA_POOL_TYPES.map((mana) => {
            const count = pool[mana.key];
            const needed = remainingNeedsPoolKey(remainingSymbols, mana.key);
            const spendable = count > 0 && canAct;
            const manaType = POOL_KEY_TO_MANA_TYPE[mana.key];
            return (
              <button
                key={mana.key}
                type="button"
                disabled={!canAct}
                onClick={() => {
                  if (!canAct) {
                    onBlocked("Connect to MAGE before spending mana.");
                    return;
                  }
                  if (count <= 0) {
                    onBlocked(`No ${mana.label} mana in your pool. Tap lands first.`);
                    return;
                  }
                  handleSpend(manaType);
                }}
                className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 transition ${
                  spendable && needed
                    ? "cursor-pointer border-accent/50 bg-accent-subtle ring-1 ring-accent/30 hover:bg-accent-subtle"
                    : spendable
                      ? "cursor-pointer border-border bg-white hover:bg-surface-subtle"
                      : "cursor-default border-border/60 bg-surface-subtle opacity-50"
                }`}
                title={
                  count > 0
                    ? `Spend ${mana.label} (${count} in pool)`
                    : `No ${mana.label} in pool`
                }
              >
                <ManaPip symbol={mana.label} size={MANA_PIP_SIZE_SM} />
                <span className="min-w-[1ch] text-sm font-bold tabular-nums text-text">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <ActionButton onClick={onDone}>Done paying</ActionButton>
      </div>
    </div>
  );
}

type PromptChoiceZone = {
  title: string;
  cards: MageCardView[];
};

function PromptChoiceCards({
  zones,
  imageFor,
  interactiveIds,
  selectedIds,
  isCardChoice,
  spectator,
  onChooseCard,
}: {
  zones: PromptChoiceZone[];
  imageFor: (card: MageCardView) => string | undefined;
  interactiveIds: Set<string>;
  selectedIds: Set<string>;
  isCardChoice: boolean;
  spectator: boolean;
  onChooseCard: (card: MageCardView) => boolean;
}) {
  const requireTarget =
    isCardChoice && interactiveIds.size > 0;

  return (
    <div className="mt-3 rounded-lg border border-accent/30 bg-white p-2 ring-1 ring-accent/15">
      <div className="text-[11px] font-semibold uppercase text-text-muted">
        {isCardChoice ? "Choose a card" : "Cards"}
      </div>
      {requireTarget && (
        <p className="mt-1 text-xs text-text-muted">
          Highlighted cards are valid choices. Gray cards are shown for context only.
        </p>
      )}
      <div className="thin-scroll mt-2 max-h-72 space-y-3 overflow-auto pr-0.5">
        {zones.map((zone) => (
          <div key={zone.title}>
            <div className="text-[11px] font-medium text-text-subtle">{zone.title}</div>
            <div className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {zone.cards.map((card) => {
                const image = imageFor(card);
                const cardId = card.id ?? "";
                const highlighted =
                  !!cardId && idInInteractiveSet(interactiveIds, cardId);
                const selected =
                  !!cardId && idInInteractiveSet(selectedIds, cardId);
                const selectable =
                  !spectator &&
                  !!cardId &&
                  (!requireTarget || highlighted);
                return (
                  <button
                    key={`${zone.title}-${cardId || card.name}`}
                    type="button"
                    disabled={!selectable}
                    onClick={() => onChooseCard(card)}
                    title={cardName(card)}
                    className={`group relative overflow-hidden rounded-md ring-1 transition ${
                      selected
                        ? "ring-2 ring-accent playtest-target-pulse"
                        : highlighted
                        ? "ring-2 ring-accent"
                        : "ring-black/15"
                    } ${
                      selectable
                        ? "cursor-pointer hover:ring-2 hover:ring-accent"
                        : "cursor-default opacity-55"
                    }`}
                  >
                    {image ? (
                      <img
                        src={image}
                        alt={cardName(card)}
                        draggable={false}
                        className="aspect-[5/7] w-full object-cover"
                      />
                    ) : (
                      <div className="flex aspect-[5/7] w-full items-center justify-center bg-surface-subtle p-1 text-center text-[10px] font-semibold text-text-muted">
                        {cardName(card)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PromptPanel({
  session,
  game,
  imageFor,
  manaPool,
  manaPaymentTotal,
  canAct,
  selectablePlayers,
  promptChoiceZones,
  interactiveIds,
  selectedIds,
  onSpendMana,
  onChoosePlayer,
  onChooseCard,
  onBlocked,
  onPassUntilNextTurn,
}: {
  session: UseMagePlaytest;
  game: MageGameView | null;
  imageFor: (card: MageCardView) => string | undefined;
  manaPool: ManaPoolCounts;
  manaPaymentTotal: string[];
  canAct: boolean;
  selectablePlayers: MagePlayerView[];
  promptChoiceZones: PromptChoiceZone[];
  interactiveIds: Set<string>;
  selectedIds: Set<string>;
  onSpendMana: (manaType: string) => void;
  onChoosePlayer: (playerId: string) => void;
  onChooseCard: (card: MageCardView) => boolean;
  onBlocked: (message: string) => void;
  onPassUntilNextTurn: () => void;
}) {
  const prompt = session.prompt;

  return (
    <PromptPanelContent
      key={promptPanelKey(prompt)}
      session={session}
      game={game}
      imageFor={imageFor}
      manaPool={manaPool}
      manaPaymentTotal={manaPaymentTotal}
      canAct={canAct}
      selectablePlayers={selectablePlayers}
      promptChoiceZones={promptChoiceZones}
      interactiveIds={interactiveIds}
      selectedIds={selectedIds}
      onSpendMana={onSpendMana}
      onChoosePlayer={onChoosePlayer}
      onChooseCard={onChooseCard}
      onBlocked={onBlocked}
      onPassUntilNextTurn={onPassUntilNextTurn}
    />
  );
}

function PromptPanelContent({
  session,
  game,
  imageFor,
  manaPool,
  manaPaymentTotal,
  canAct,
  selectablePlayers,
  promptChoiceZones,
  interactiveIds,
  selectedIds,
  onSpendMana,
  onChoosePlayer,
  onChooseCard,
  onBlocked,
  onPassUntilNextTurn,
}: {
  session: UseMagePlaytest;
  game: MageGameView | null;
  imageFor: (card: MageCardView) => string | undefined;
  manaPool: ManaPoolCounts;
  manaPaymentTotal: string[];
  canAct: boolean;
  selectablePlayers: MagePlayerView[];
  promptChoiceZones: PromptChoiceZone[];
  interactiveIds: Set<string>;
  selectedIds: Set<string>;
  onSpendMana: (manaType: string) => void;
  onChoosePlayer: (playerId: string) => void;
  onChooseCard: (card: MageCardView) => boolean;
  onBlocked: (message: string) => void;
  onPassUntilNextTurn: () => void;
}) {
  const prompt = session.prompt;
  const [amount, setAmount] = useState(() => String(prompt?.min ?? 0));
  const phaseStyle = phaseStepStyleForGame(game);
  const { phase, step } = activeStepKeys(game);

  if (!prompt) {
    return (
      <section
        className={`mb-3 rounded-xl border p-3 ${phaseStyle.statBorder} ${phaseStyle.statBg}`}
      >
        <div className={`text-[11px] font-semibold uppercase ${phaseStyle.textMuted}`}>
          {formatStep(game)}
        </div>
        <div className={`mt-1 text-sm font-semibold ${phaseStyle.text}`}>
          Waiting for MAGE
        </div>
        <CompactPhaseStages phase={phase} step={step} className="mt-2" />
        <div className="mt-2 text-sm text-text-muted">
          <ManaText
            text={
              plainMageText(session.error ?? session.lastMessage) ||
              "Start a game to receive MAGE prompts."
            }
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <ActionButton
            disabled={!canAct}
            disabledReason={
              session.spectator
                ? "Spectators cannot pass priority."
                : "Connect to MAGE before passing priority."
            }
            onBlocked={onBlocked}
            onClick={onPassUntilNextTurn}
          >
            Pass
          </ActionButton>
        </div>
      </section>
    );
  }

  const method = prompt.callbackMethod ?? prompt.type ?? "prompt";
  const isManaPayment = method === "GAME_PLAY_MANA";
  const choiceOptions = optionsForChoice(prompt);
  const abilityChoices = Object.entries(prompt.choices ?? {});
  const isCardChoice =
    method === "GAME_SELECT" || method === "GAME_TARGET";
  const promptMessage =
    plainMageText(prompt.message || prompt.choice?.message) || "Choose an action";
  const promptSubMessage = plainMageText(prompt.choice?.subMessage);
  const yesLabel = optionText(prompt.options, "UI.left.btn.text", "Yes");
  const noLabel = optionText(prompt.options, "UI.right.btn.text", "No");

  return (
    <section
      className={`mb-3 rounded-xl border bg-surface-raised p-3 ${
        isManaPayment
          ? "border-accent/40 ring-1 ring-accent/20"
          : `${phaseStyle.statBorder} ${phaseStyle.statBg}`
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div
            className={`text-[11px] font-semibold uppercase ${
              isManaPayment ? "text-text-muted" : phaseStyle.textMuted
            }`}
          >
            {isManaPayment ? "Pay mana" : formatStep(game)}
          </div>
          {!isManaPayment && (
            <div className={`mt-1 text-sm font-semibold ${phaseStyle.text}`}>
              <ManaTextBlock text={promptMessage} />
            </div>
          )}
          {!isManaPayment && promptSubMessage && (
            <div className="mt-1 text-xs text-text-muted">
              <ManaTextBlock text={promptSubMessage} />
            </div>
          )}
        </div>
        <span className="rounded-full border border-border bg-white px-2 py-0.5 text-[11px] text-text-subtle">
          #{prompt.messageId ?? prompt.sequence ?? "—"}
        </span>
      </div>

      {!isManaPayment && <CompactPhaseStages phase={phase} step={step} className="mt-2" />}

      {session.spectator ? (
        <div className="mt-3 rounded-lg border border-border bg-white px-3 py-2 text-xs text-text-muted">
          Spectator mode. Choices are visible but actions are disabled.
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {method === "GAME_ASK" && (
            <>
              <ActionButton onClick={() => session.chooseBoolean(true)}>
                {yesLabel}
              </ActionButton>
              <ActionButton onClick={() => session.chooseBoolean(false)}>
                {noLabel}
              </ActionButton>
            </>
          )}

          {method === "GAME_CHOOSE_ABILITY" &&
            abilityChoices.map(([id, label]) => (
              <ActionButton key={id} onClick={() => session.chooseUuid(id)}>
                <ManaText text={label} size={12} />
              </ActionButton>
            ))}

          {method === "GAME_CHOOSE_CHOICE" &&
            choiceOptions.map((option) => (
              <ActionButton
                key={`${option.value}-${option.label}`}
                onClick={() => {
                  if (option.sendAsUuid) {
                    session.chooseUuid(option.value);
                  } else {
                    session.chooseString(option.value);
                  }
                }}
              >
                <ManaText text={option.label} size={12} />
              </ActionButton>
            ))}

          {method === "GAME_CHOOSE_PILE" && (
            <>
              <ActionButton onClick={() => session.chooseBoolean(true)}>
                Pile 1
              </ActionButton>
              <ActionButton onClick={() => session.chooseBoolean(false)}>
                Pile 2
              </ActionButton>
            </>
          )}

          {method === "GAME_GET_AMOUNT" && (
            <AmountControls
              value={amount}
              min={prompt.min ?? 0}
              max={prompt.max ?? 99}
              onChange={setAmount}
              onConfirm={() => session.chooseInteger(Number(amount) || 0)}
              onCancel={() => session.chooseBoolean(false)}
            />
          )}

          {method === "GAME_GET_MULTI_AMOUNT" && (
            <MultiAmountControls
              messages={multiAmountMessages(prompt.messages)}
              onConfirm={(value) => session.chooseString(value)}
              onCancel={() => session.chooseBoolean(false)}
            />
          )}

          {method === "GAME_PLAY_MANA" && (
            <div className="w-full basis-full">
              <ManaPaymentPanel
                prompt={prompt}
                pool={manaPool}
                frozenTotalSymbols={manaPaymentTotal}
                canAct={canAct && !session.spectator}
                onSpend={onSpendMana}
                onBlocked={onBlocked}
                onDone={() => session.chooseBoolean(false)}
              />
            </div>
          )}

          {method === "GAME_PLAY_XMANA" && (
            <>
              <ActionButton onClick={() => session.chooseBoolean(true)}>
                Confirm
              </ActionButton>
              <ActionButton onClick={() => session.chooseBoolean(false)}>
                Cancel
              </ActionButton>
            </>
          )}

          {(method === "GAME_SELECT" || method === "GAME_TARGET") && (
            <>
              {selectablePlayers.map((player) => (
                <ActionButton
                  key={player.playerId ?? player.name}
                  onClick={() => player.playerId && onChoosePlayer(player.playerId)}
                >
                  {player.name ?? "Player"}
                </ActionButton>
              ))}
              <ActionButton onClick={session.passPriority}>Pass Priority</ActionButton>
              <ActionButton onClick={() => session.chooseBoolean(false)}>
                Cancel
              </ActionButton>
            </>
          )}

          {(method === "GAME_UPDATE" || method === "GAME_UPDATE_AND_INFORM") && (
            <ActionButton onClick={onPassUntilNextTurn}>Pass</ActionButton>
          )}

          {prompt.gameView?.special && (
            <ActionButton onClick={() => session.chooseString("special")}>
              Special
            </ActionButton>
          )}

          {prompt.type === "gameOver" && (
            <ActionButton onClick={session.disconnect}>Close</ActionButton>
          )}
        </div>
      )}

      {promptChoiceZones.length > 0 && (
        <PromptChoiceCards
          zones={promptChoiceZones}
          imageFor={imageFor}
          interactiveIds={interactiveIds}
          selectedIds={selectedIds}
          isCardChoice={isCardChoice}
          spectator={session.spectator}
          onChooseCard={onChooseCard}
        />
      )}
    </section>
  );
}

function MultiAmountControls({
  messages,
  onConfirm,
  onCancel,
}: {
  messages: MageMultiAmountMessage[];
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<string[]>(() =>
    messages.map((message) => String(message.defaultValue ?? message.min ?? 0))
  );

  if (messages.length === 0) {
    return (
      <>
        <ActionButton onClick={() => onConfirm("")}>Confirm</ActionButton>
        <ActionButton onClick={onCancel}>Cancel</ActionButton>
      </>
    );
  }

  const setValue = (index: number, next: string) => {
    setValues((current) => current.map((value, i) => (i === index ? next : value)));
  };

  const confirm = () => {
    const normalized = messages.map((message, index) => {
      const min = message.min ?? 0;
      const max = message.max ?? 99;
      const parsed = Math.round(Number(values[index]));
      const clamped = Number.isFinite(parsed)
        ? Math.min(max, Math.max(min, parsed))
        : min;
      return clamped;
    });
    onConfirm(normalized.join(" "));
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        {messages.map((message, index) => (
          <label
            key={`${message.message ?? "amount"}-${index}`}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span className="min-w-0 flex-1 truncate text-text-muted">
              <ManaText
                text={plainMageText(message.message) || `Amount ${index + 1}`}
                size={12}
              />
            </span>
            <input
              type="number"
              min={message.min ?? 0}
              max={message.max ?? 99}
              value={values[index]}
              onChange={(event) => setValue(index, event.target.value)}
              className="h-8 w-20 rounded-lg border border-border bg-white px-2 text-sm outline-none focus:border-accent"
            />
          </label>
        ))}
      </div>
      <div className="flex gap-1.5">
        <ActionButton onClick={confirm}>Confirm</ActionButton>
        <ActionButton onClick={onCancel}>Cancel</ActionButton>
      </div>
    </div>
  );
}

function multiAmountMessages(raw: unknown): MageMultiAmountMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is MageMultiAmountMessage => isPlainObject(entry));
}

function SkipActionsMenu({
  disabled,
  disabledReason,
  onBlocked,
  onAction,
}: {
  disabled: boolean;
  disabledReason: string;
  onBlocked: (message: string) => void;
  onAction: (action: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <ActionButton
        disabled={disabled}
        disabledReason={disabledReason}
        onBlocked={onBlocked}
        onClick={() => setOpen((value) => !value)}
      >
        Skip ▾
      </ActionButton>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-52 rounded-lg border border-border bg-surface-raised p-1 shadow-lg">
          {SKIP_ACTIONS.map((item) => (
            <button
              key={item.action}
              type="button"
              title={item.title}
              onClick={() => {
                setOpen(false);
                onAction(item.action);
              }}
              className="block w-full rounded-md px-2 py-1.5 text-left text-xs text-text-muted transition hover:bg-surface-subtle hover:text-text"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CompactPhaseStages({
  phase,
  step,
  className = "",
}: {
  phase: string;
  step: string;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-1 ${className}`}>
      {PHASE_TRACK.map((entry) => {
        const phaseActive = entry.phase === phase;
        const phaseStyle = resolvePhaseStepStyle(entry.phase, step);
        return (
          <div
            key={entry.phase}
            className={`flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 ${
              phaseActive ? `${phaseStyle.bg} ring-1 ${phaseStyle.ring}` : ""
            }`}
          >
            <span
              className={`text-[9px] font-semibold uppercase ${
                phaseActive ? phaseStyle.text : "text-text-subtle"
              }`}
            >
              {entry.label}
            </span>
            <div className="flex items-center gap-0.5">
              {entry.steps.map((stepEntry) => {
                const active = stepEntry.key === step;
                const stepStyle = stepStyleForKey(stepEntry.key, entry.phase);
                return (
                  <span
                    key={stepEntry.key}
                    title={stepEntry.label}
                    className={`rounded-full transition ${
                      active
                        ? `h-2 w-2 ${stepStyle.dot} ring-2 ${stepStyle.dotRing}`
                        : phaseActive
                          ? `h-1.5 w-1.5 ${stepStyle.dotMuted}`
                          : "h-1.5 w-1.5 bg-border"
                    }`}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PhaseTrack({
  game,
  self,
}: {
  game: MageGameView | null;
  self?: MagePlayerView;
}) {
  const { phase, step } = activeStepKeys(game);
  const myTurn = isSelfActivePlayer(self, game);
  const currentStyle = phaseStepStyleForGame(game);

  return (
    <div className="mt-2 flex min-w-0 items-stretch gap-1 overflow-x-auto">
      <span
        className={`flex shrink-0 items-center rounded-md px-2 text-[10px] font-semibold uppercase ${
          myTurn
            ? "bg-accent-subtle text-accent"
            : "bg-surface-subtle text-text-subtle"
        }`}
        title={myTurn ? "Your turn" : "Opponent's turn"}
      >
        {myTurn ? "Your turn" : "Opp turn"}
      </span>
      <span
        className={`flex shrink-0 items-center rounded-md border px-2 text-[10px] font-semibold uppercase ${currentStyle.statBorder} ${currentStyle.statBg} ${currentStyle.text}`}
        title={formatStep(game)}
      >
        {formatStep(game)}
      </span>
      <CompactPhaseStages phase={phase} step={step} />
    </div>
  );
}

function BigCardPanel({
  card,
  imageFor,
}: {
  card: MageCardView | null;
  imageFor: (card: MageCardView) => string | undefined;
}) {
  if (!card) {
    return (
      <section className="shrink-0 rounded-lg border border-border bg-surface-raised p-3 text-xs text-text-subtle">
        Click or right-click a card to inspect it here.
      </section>
    );
  }

  const image = imageFor(card);
  const rules = (card.rules ?? [])
    .map((rule) => plainMageText(rule))
    .filter((rule) => rule.length > 0);
  const pt = powerToughness(card);

  return (
    <section className="shrink-0 rounded-lg border border-border bg-surface-raised p-2">
      <div className="flex gap-2">
        {image ? (
          <img
            src={image}
            alt={cardName(card)}
            draggable={false}
            className="h-36 w-auto shrink-0 rounded-md object-contain ring-1 ring-black/15"
          />
        ) : (
          <div className="flex h-36 w-[6.4rem] shrink-0 items-center justify-center rounded-md bg-surface-subtle p-2 text-center text-[11px] font-semibold text-text-muted">
            {cardName(card)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-semibold text-text">
              {cardName(card)}
            </span>
            <ManaCost cost={manaCost(card)} size={12} />
          </div>
          <div className="mt-0.5 text-[11px] text-text-muted">{typeLine(card)}</div>
          {pt && (
            <div className="mt-0.5 text-[11px] font-semibold text-text">{pt}</div>
          )}
          {rules.length > 0 && (
            <div className="thin-scroll mt-1.5 max-h-24 space-y-1 overflow-auto pr-0.5 text-[11px] leading-snug text-text-muted">
              {rules.map((rule, index) => (
                <p key={index}>
                  <ManaTextBlock text={rule} size={12} />
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CombatSummaryPanel({
  groups,
  players,
  imageFor,
}: {
  groups: MageCombatGroupView[];
  players: MagePlayerView[];
  imageFor: (card: MageCardView) => string | undefined;
}) {
  const nameForPlayer = (id?: string) =>
    players.find((player) => player.playerId === id)?.name;

  return (
    <section className="shrink-0 rounded-lg border border-[color:var(--danger)]/30 bg-red-50/60 p-2">
      <ZoneHeader label="Combat" count={groups.length} />
      <div className="mt-2 flex flex-col gap-2">
        {groups.map((group, index) => {
          const attackers = cardsFromView(group.attackers);
          const blockers = cardsFromView(group.blockers);
          const defender =
            group.defenderName || nameForPlayer(group.defenderId) || "Defender";
          return (
            <div
              key={index}
              className="rounded-md border border-border bg-white p-2 text-[11px]"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-semibold text-[color:var(--danger)]">
                  Attacking {defender}
                </span>
                {group.isBlocked && (
                  <span className="rounded-full border border-blue-300 bg-blue-50 px-1.5 py-0.5 font-medium text-blue-700">
                    Blocked
                  </span>
                )}
              </div>
              <CombatCardRow label="Attackers" cards={attackers} imageFor={imageFor} accent="danger" />
              {blockers.length > 0 && (
                <CombatCardRow label="Blockers" cards={blockers} imageFor={imageFor} accent="blue" />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CombatCardRow({
  label,
  cards,
  imageFor,
  accent,
}: {
  label: string;
  cards: MageCardView[];
  imageFor: (card: MageCardView) => string | undefined;
  accent: "danger" | "blue";
}) {
  return (
    <div className="mt-1">
      <div className="text-[10px] font-semibold uppercase text-text-subtle">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {cards.map((card) => {
          const image = imageFor(card);
          return (
            <span
              key={card.id ?? card.name}
              className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${
                accent === "danger"
                  ? "border-[color:var(--danger)]/30 bg-red-50"
                  : "border-blue-300 bg-blue-50"
              }`}
              title={cardName(card)}
            >
              {image && (
                <img
                  src={image}
                  alt=""
                  draggable={false}
                  className="h-6 w-[1.07rem] rounded-sm object-cover"
                />
              )}
              <span className="max-w-28 truncate font-medium text-text">
                {cardName(card)}
              </span>
              {powerToughness(card) && (
                <span className="font-semibold text-text-muted tabular-nums">
                  {powerToughness(card)}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function SharedZonesPanel({
  game,
  onOpenZone,
}: {
  game: MageGameView | null;
  onOpenZone: (state: ZoneViewerState) => void;
}) {
  const exiles = exileZonesFromGame(game);
  const revealed = (game?.revealed ?? []).filter(
    (view) => cardsFromRevealed(view).length > 0
  );
  const lookedAt = (game?.lookedAt ?? []).filter(
    (view) => cardsFromRevealed(view).length > 0
  );
  const companion = (game?.companion ?? []).filter(
    (view) => cardsFromRevealed(view).length > 0
  );

  const hasShared =
    exiles.length > 0 ||
    revealed.length > 0 ||
    lookedAt.length > 0 ||
    companion.length > 0;
  if (!hasShared) return null;

  return (
    <section className="shrink-0 rounded-lg border border-border bg-surface-raised p-2">
      <ZoneHeader label="Shared zones" count={0} />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {exiles.map((zone, index) => {
          const cards = cardsFromView(zone);
          return (
            <SharedZoneButton
              key={`exile-${zone.id ?? index}`}
              label={zone.name || "Exile"}
              count={cards.length}
              onClick={() =>
                onOpenZone({ title: zone.name || "Exile", cards })
              }
            />
          );
        })}
        {revealed.map((view, index) => {
          const cards = cardsFromRevealed(view);
          return (
            <SharedZoneButton
              key={`revealed-${index}`}
              label={view.name ? `Revealed: ${view.name}` : "Revealed"}
              count={cards.length}
              onClick={() =>
                onOpenZone({ title: view.name || "Revealed", subtitle: "Revealed", cards })
              }
            />
          );
        })}
        {lookedAt.map((view, index) => {
          const cards = cardsFromRevealed(view);
          return (
            <SharedZoneButton
              key={`looked-${index}`}
              label={view.name ? `Looking: ${view.name}` : "Looked at"}
              count={cards.length}
              onClick={() =>
                onOpenZone({ title: view.name || "Looked at", subtitle: "Looked at", cards })
              }
            />
          );
        })}
        {companion.map((view, index) => {
          const cards = cardsFromRevealed(view);
          return (
            <SharedZoneButton
              key={`companion-${index}`}
              label="Companion"
              count={cards.length}
              onClick={() =>
                onOpenZone({ title: view.name || "Companion", subtitle: "Companion", cards })
              }
            />
          );
        })}
      </div>
    </section>
  );
}

function SharedZoneButton({
  label,
  count,
  onClick,
}: {
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-full border border-border bg-white px-2 py-0.5 text-[11px] font-medium text-text-muted transition hover:border-border-strong hover:text-text"
    >
      <span className="max-w-36 truncate">{label}</span>
      <span className="rounded-full bg-surface-subtle px-1 text-[10px] tabular-nums">
        {count}
      </span>
    </button>
  );
}

function GameChatPanel({
  messages,
  canSend,
  onSend,
}: {
  messages: MageChatMessage[];
  canSend: boolean;
  onSend: (message: string) => boolean;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages.length]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !canSend) return;
    if (onSend(text)) setDraft("");
  };

  return (
    <section className="shrink-0 rounded-lg border border-border bg-surface-raised p-2">
      <div className="flex items-center justify-between gap-2">
        <ZoneHeader label="Chat" count={messages.length} />
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            canSend
              ? "bg-emerald-50 text-emerald-700"
              : "bg-surface-subtle text-text-subtle"
          }`}
        >
          {canSend ? "Connected" : "Offline"}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="thin-scroll mt-2 flex max-h-44 min-h-24 flex-col gap-1.5 overflow-auto rounded-md bg-white p-2 ring-1 ring-border/70"
      >
        {messages.length > 0 ? (
          messages.map((message) => (
            <ChatMessageRow key={message.id} message={message} />
          ))
        ) : (
          <div className="flex min-h-16 items-center text-xs text-text-subtle">
            No chat yet.
          </div>
        )}
      </div>
      <form onSubmit={submit} className="mt-2 flex gap-1.5">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={!canSend}
          placeholder="Message"
          maxLength={500}
          className="min-w-0 flex-1 rounded-md border border-border bg-white px-2 py-1.5 text-xs text-text outline-none transition focus:border-accent disabled:bg-surface-subtle disabled:text-text-subtle"
        />
        <button
          type="submit"
          disabled={!canSend || draft.trim().length === 0}
          className="rounded-md border border-accent bg-accent px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-accent/90 disabled:cursor-default disabled:border-border disabled:bg-surface-subtle disabled:text-text-subtle"
        >
          Send
        </button>
      </form>
    </section>
  );
}

function ChatMessageRow({ message }: { message: MageChatMessage }) {
  const system =
    message.messageType === "STATUS" ||
    message.messageType === "USER_INFO" ||
    !message.username;
  return (
    <div
      className={`rounded-md px-2 py-1 text-xs leading-snug ${
        system ? "bg-surface-subtle text-text-muted" : "bg-white text-text"
      }`}
    >
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 text-[10px] tabular-nums text-text-subtle">
          {formatChatTime(message.time)}
        </span>
        {message.turnInfo && (
          <span className="shrink-0 rounded bg-surface-subtle px-1 text-[10px] font-medium text-text-subtle">
            {message.turnInfo}
          </span>
        )}
        {message.username && (
          <span className="min-w-0 truncate font-semibold text-text">
            {message.username}
          </span>
        )}
      </div>
      <div className="mt-0.5 whitespace-pre-wrap break-words">{message.message}</div>
    </div>
  );
}

function formatChatTime(time: number | null): string {
  if (typeof time !== "number" || !Number.isFinite(time)) return "";
  return new Date(time).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function ZoneViewerDialog({
  state,
  imageFor,
  onClose,
  onHover,
}: {
  state: ZoneViewerState | null;
  imageFor: (card: MageCardView) => string | undefined;
  onClose: () => void;
  onHover: (src: string | undefined, x: number, y: number) => void;
}) {
  useEffect(() => {
    if (!state) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state, onClose]);

  if (!state) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="playtest-dialog-panel flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {state.subtitle && (
              <div className="text-[11px] font-semibold uppercase text-text-subtle">
                {state.subtitle}
              </div>
            )}
            <div className="truncate text-sm font-semibold text-text">
              {state.title}
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-border bg-white px-2 py-0.5 text-[11px] text-text-subtle">
            {state.cards.length} cards
          </span>
          <button
            type="button"
            onClick={onClose}
            className="control shrink-0 px-3 py-1.5 text-sm"
          >
            Close
          </button>
        </div>
        <div className="thin-scroll min-h-0 flex-1 overflow-auto p-4">
          {state.cards.length === 0 ? (
            <div className="py-8 text-center text-sm text-text-subtle">
              This zone is empty.
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
              {state.cards.map((card, index) => {
                const image = imageFor(card);
                return (
                  <div
                    key={card.id ?? `${card.name}-${index}`}
                    className="overflow-hidden rounded-lg ring-1 ring-black/15"
                    onMouseEnter={(event) => onHover(image, event.clientX, event.clientY)}
                    onMouseMove={(event) => onHover(image, event.clientX, event.clientY)}
                    onMouseLeave={() => onHover(undefined, 0, 0)}
                  >
                    {image ? (
                      <img
                        src={image}
                        alt={cardName(card)}
                        draggable={false}
                        className="aspect-[5/7] w-full object-cover"
                      />
                    ) : (
                      <div className="flex aspect-[5/7] w-full items-center justify-center bg-surface-subtle p-2 text-center text-xs font-semibold text-text-muted">
                        {cardName(card)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CardContextMenu({
  state,
  imageFor,
  onClose,
  onInspect,
}: {
  state: ContextMenuState | null;
  imageFor: (card: MageCardView) => string | undefined;
  onClose: () => void;
  onInspect: (card: MageCardView) => void;
}) {
  if (!state) return null;

  const image = imageFor(state.card);
  const left = Math.min(state.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 232);
  const top = Math.min(state.y, (typeof window !== "undefined" ? window.innerHeight : 9999) - 160);

  return (
    <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={(event) => event.preventDefault()}>
      <div
        className="playtest-dialog-panel absolute w-56 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-xl"
        style={{ left, top }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border p-2">
          {image && (
            <img
              src={image}
              alt=""
              draggable={false}
              className="h-12 w-[2.14rem] rounded object-cover ring-1 ring-black/15"
            />
          )}
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-text">
              {cardName(state.card)}
            </div>
            <div className="truncate text-[10px] text-text-subtle">
              {typeLine(state.card)}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onInspect(state.card)}
          className="block w-full px-3 py-2 text-left text-xs text-text-muted transition hover:bg-surface-subtle hover:text-text"
        >
          Inspect card
        </button>
      </div>
    </div>
  );
}

function GameEndDialog({
  open,
  message,
  onClose,
  onRematch,
}: {
  open: boolean;
  message: string;
  onClose: () => void;
  onRematch: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="playtest-end-panel w-full max-w-sm rounded-2xl border border-border bg-surface p-6 text-center shadow-2xl">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
          Game over
        </div>
        <div className="mt-2 text-lg font-bold text-text">
          <ManaTextBlock text={message || "The game has ended."} size={18} />
        </div>
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            onClick={onRematch}
            className="control control-primary px-4 py-2 text-sm font-semibold"
          >
            Play again
          </button>
          <button
            type="button"
            onClick={onClose}
            className="control px-4 py-2 text-sm"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

type CombatArrow = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: "attack" | "block";
};

function CombatArrowsOverlay({
  containerRef,
  cardElementsRef,
  groups,
  tick,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  cardElementsRef: React.RefObject<Map<string, HTMLElement>>;
  groups: MageCombatGroupView[];
  tick: number;
}) {
  const [arrows, setArrows] = useState<CombatArrow[]>([]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const elements = cardElementsRef.current;
    if (!container || !elements || groups.length === 0) {
      setArrows([]);
      return;
    }
    const base = container.getBoundingClientRect();
    const center = (id: string): { x: number; y: number } | null => {
      const el = elements.get(id);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        x: rect.left - base.left + rect.width / 2,
        y: rect.top - base.top + rect.height / 2,
      };
    };

    const next: CombatArrow[] = [];
    groups.forEach((group, groupIndex) => {
      const attackerIds = Object.keys(group.attackers ?? {});
      const blockerIds = Object.keys(group.blockers ?? {});
      for (const attackerId of attackerIds) {
        const from = center(attackerId);
        const defender = group.defenderId ? center(group.defenderId) : null;
        if (from && defender) {
          next.push({
            id: `atk-${groupIndex}-${attackerId}`,
            x1: from.x,
            y1: from.y,
            x2: defender.x,
            y2: defender.y,
            kind: "attack",
          });
        }
        for (const blockerId of blockerIds) {
          const blocker = center(blockerId);
          if (from && blocker) {
            next.push({
              id: `blk-${groupIndex}-${attackerId}-${blockerId}`,
              x1: blocker.x,
              y1: blocker.y,
              x2: from.x,
              y2: from.y,
              kind: "block",
            });
          }
        }
      }
    });
    setArrows(next);
  }, [containerRef, cardElementsRef, groups, tick]);

  if (arrows.length === 0) return null;

  return (
    <svg className="pointer-events-none absolute inset-0 z-30 h-full w-full" aria-hidden="true">
      <defs>
        <marker
          id="combat-arrow-attack"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="4"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 Z" fill="rgba(196,61,67,0.95)" />
        </marker>
        <marker
          id="combat-arrow-block"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="4"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 Z" fill="rgba(37,99,235,0.95)" />
        </marker>
      </defs>
      {arrows.map((arrow) => (
        <line
          key={arrow.id}
          x1={arrow.x1}
          y1={arrow.y1}
          x2={arrow.x2}
          y2={arrow.y2}
          className="playtest-combat-arrow"
          stroke={arrow.kind === "attack" ? "rgba(196,61,67,0.9)" : "rgba(37,99,235,0.9)"}
          strokeWidth={2.5}
          markerEnd={`url(#combat-arrow-${arrow.kind})`}
        />
      ))}
    </svg>
  );
}

function AmountControls({
  value,
  min,
  max,
  onChange,
  onConfirm,
  onCancel,
}: {
  value: string;
  min: number;
  max: number;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-20 rounded-lg border border-border bg-white px-2 text-sm outline-none focus:border-accent"
      />
      <ActionButton onClick={onConfirm}>Confirm</ActionButton>
      <ActionButton onClick={onCancel}>Cancel</ActionButton>
    </>
  );
}

function EventLog({ events }: { events: MageGatewayEvent[] }) {
  const visible = events.slice(-28).toReversed();
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase text-text-muted">
          Event Log
        </div>
        <div className="text-[11px] text-text-subtle tabular-nums">
          {events.length}
        </div>
      </div>
      <div className="thin-scroll min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-white p-2">
        {visible.length === 0 ? (
          <div className="px-1 py-2 text-xs text-text-subtle">
            No gateway events yet.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {visible.map((event) => (
              <div
                key={`${event.sequence ?? event.time}-${event.type}`}
                className="rounded-lg bg-surface-subtle px-2 py-1.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-text">
                    {formatLabel(event.callbackMethod ?? event.type ?? "event")}
                  </span>
                  <span className="text-[10px] text-text-subtle tabular-nums">
                    {event.sequence ?? "—"}
                  </span>
                </div>
                <div className="mt-0.5 line-clamp-2 text-text-muted">
                  <ManaText
                    text={plainMageText(event.message ?? eventSummary(event))}
                    size={12}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ZoneHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[11px] font-semibold uppercase text-text-muted">
        {label}
      </span>
      <span className="text-[11px] text-text-subtle tabular-nums">{count}</span>
    </div>
  );
}

function cardsFromView(cards?: MageCardsView | null): MageCardView[] {
  return Object.entries(cards ?? {})
    .filter(([, card]) => isPlainObject(card))
    .map(([id, card]) => ({
      ...(card as MageCardView),
      id: (card as MageCardView).id ?? id,
    }));
}

function cardsFromExileZones(
  zones: MageExileView[] | undefined,
  players: MagePlayerView[]
): ExileCardView[] {
  const sourceByName = cardSourceMap(players);
  if (zones && zones.length > 0) {
    return zones.flatMap((zone) => {
      const source = sourceForExileZone(zone, sourceByName);
      return cardsFromView(zone).map((card) => ({ ...card, exiledBy: source }));
    });
  }
  return players.flatMap((player) => cardsFromView(player.exile));
}

function sourceForExileZone(
  zone: MageExileView,
  sourceByName: Map<string, MageCardView>
): MageCardView | undefined {
  const name = typeof zone.name === "string" ? normalizeName(zone.name) : "";
  if (!name) return undefined;
  return (
    sourceByName.get(name) ??
    sourceByName.get(name.replace(/^exiled with /, "")) ??
    sourceByName.get(name.replace(/^exiled by /, ""))
  );
}

function cardSourceMap(players: MagePlayerView[]): Map<string, MageCardView> {
  const map = new Map<string, MageCardView>();
  for (const player of players) {
    for (const card of [
      ...cardsFromView(player.battlefield),
      ...cardsFromView(player.graveyard),
      ...cardsFromView(player.exile),
      ...(player.commandList ?? []),
    ]) {
      const key = normalizeName(cardName(card));
      if (key && !map.has(key)) map.set(key, card);
    }
  }
  return map;
}

function battlefieldLayout(cards: MageCardView[]): BattlefieldLayout {
  const ids = new Set(cards.map((card) => card.id).filter(Boolean));
  const attachmentsByHost = new Map<string, MageCardView[]>();
  const roots: MageCardView[] = [];
  for (const card of cards) {
    const attachedTo = card.attachedTo;
    if (attachedTo && ids.has(attachedTo)) {
      const attachments = attachmentsByHost.get(attachedTo) ?? [];
      attachments.push(card);
      attachmentsByHost.set(attachedTo, attachments);
    } else {
      roots.push(card);
    }
  }
  return { roots, attachmentsByHost };
}

function collectStackTargetIds(cards: MageCardView[]): Set<string> {
  const ids = new Set<string>();
  for (const card of cards) {
    for (const target of card.targets ?? []) ids.add(target);
  }
  return ids;
}

function collectChosenTargetIds(prompt: MageGatewayEvent | null): Set<string> {
  return idsFromUnknownCollection(prompt?.options?.chosenTargets);
}

function unionIdSets(...sets: Array<Set<string>>): Set<string> {
  const ids = new Set<string>();
  for (const set of sets) {
    for (const id of set) ids.add(normalizeUuid(id));
  }
  return ids;
}

function collectCardIds(cards: MageCardView[]): Set<string> {
  return new Set(cards.map((card) => card.id).filter((id): id is string => !!id));
}

function combatGroupsFromView(game: MageGameView | null): MageCombatGroupView[] {
  return (game?.combat ?? []).filter(
    (group) =>
      Object.keys(group.attackers ?? {}).length > 0 ||
      Object.keys(group.blockers ?? {}).length > 0
  );
}

function collectCombatRoles(
  game: MageGameView | null,
  prompt: MageGatewayEvent | null
): CombatRoles {
  const attackers = collectCombatAttackerIds(game);
  const blockers = collectCombatBlockerIds(game);
  return {
    attackers,
    blockers,
    possibleAttackers: idsFromOptionsList(prompt?.options, "possibleAttackers"),
    possibleBlockers: idsFromOptionsList(prompt?.options, "possibleBlockers"),
  };
}

function collectCombatAttackerIds(game: MageGameView | null): Set<string> {
  const ids = new Set<string>();
  for (const group of game?.combat ?? []) {
    for (const id of Object.keys(group.attackers ?? {})) ids.add(normalizeUuid(id));
  }
  return ids;
}

function collectCombatBlockerIds(game: MageGameView | null): Set<string> {
  const ids = new Set<string>();
  for (const group of game?.combat ?? []) {
    for (const id of Object.keys(group.blockers ?? {})) ids.add(normalizeUuid(id));
  }
  return ids;
}

function idsFromOptionsList(
  options: Record<string, unknown> | null | undefined,
  key: string
): Set<string> {
  return idsFromUnknownCollection(options?.[key]);
}

function idsFromUnknownCollection(value: unknown): Set<string> {
  const ids = new Set<string>();
  const add = (entry: unknown) => {
    if (typeof entry === "string") {
      ids.add(normalizeUuid(entry));
      return;
    }
    if (!isPlainObject(entry)) return;
    for (const key of ["id", "uuid", "playerId"]) {
      const nested = entry[key];
      if (typeof nested === "string") ids.add(normalizeUuid(nested));
    }
  };

  if (Array.isArray(value)) {
    for (const entry of value) add(entry);
  } else if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      ids.add(normalizeUuid(key));
      add(entry);
    }
  } else {
    add(value);
  }
  return ids;
}

function isSelectingAttackersPrompt(prompt: MageGatewayEvent | null): boolean {
  const method = prompt?.callbackMethod ?? prompt?.type;
  return (
    method === "GAME_SELECT" &&
    (idsFromOptionsList(prompt?.options, "possibleAttackers").size > 0 ||
      /select attackers/i.test(plainMageText(prompt?.message)))
  );
}

function isSelectingBlockersPrompt(prompt: MageGatewayEvent | null): boolean {
  const method = prompt?.callbackMethod ?? prompt?.type;
  return (
    method === "GAME_SELECT" &&
    (idsFromOptionsList(prompt?.options, "possibleBlockers").size > 0 ||
      /select blockers/i.test(plainMageText(prompt?.message)))
  );
}

function exileZonesFromGame(game: MageGameView | null): MageExileView[] {
  const zones = game?.exiles ?? game?.exile ?? [];
  return zones.filter((zone) => cardsFromView(zone).length > 0);
}

function cardsFromRevealed(view: MageRevealedView): MageCardView[] {
  return cardsFromView(view.cards);
}

function notableCounters(player?: MagePlayerView): MageCounterView[] {
  return (player?.counters ?? []).filter(
    (counter) => typeof counter.count === "number" && counter.count !== 0
  );
}

function counterStyle(name?: string): string {
  const key = (name ?? "").toLowerCase();
  return NOTABLE_COUNTER_STYLES[key] ?? "border-border bg-white text-text-muted";
}

function manaPoolTotal(pool: ManaPoolCounts): number {
  return (
    pool.white + pool.blue + pool.black + pool.red + pool.green + pool.colorless
  );
}

function commanderCards(player?: MagePlayerView): MageCardView[] {
  return [
    ...(player?.commandList ?? []),
    ...(player?.commandObjectList ?? []),
  ].filter((card) => isPlainObject(card));
}

function formatTimer(seconds?: number): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function activeStepKeys(game: MageGameView | null): { phase: string; step: string } {
  return {
    phase: String(game?.phase ?? "").toUpperCase(),
    step: String(game?.step ?? "").toUpperCase(),
  };
}

function manaPoolFromView(pool: unknown): ManaPoolCounts {
  const view = isPlainObject(pool) ? (pool as MageManaPoolView) : {};
  return {
    white: numericMana(view.white),
    blue: numericMana(view.blue),
    black: numericMana(view.black),
    red: numericMana(view.red),
    green: numericMana(view.green),
    colorless: numericMana(view.colorless),
  };
}

function addManaToGameView(
  game: MageGameView | null,
  playerId: string | null,
  mana: ManaPoolDelta
): MageGameView | null {
  if (!game?.players || !hasManaDelta(mana)) return game;
  let updated = false;
  const players = game.players.map((player) => {
    const isSelf =
      player.controlled ||
      (!!player.playerId &&
        (player.playerId === playerId || player.playerId === game.myPlayerId));
    if (!isSelf) return player;
    updated = true;
    const current = manaPoolFromView(player.manaPool);
    const next: ManaPoolCounts = { ...current };
    for (const manaType of Object.keys(mana) as Array<keyof ManaPoolCounts>) {
      next[manaType] = Math.max(0, current[manaType] + numericMana(mana[manaType]));
    }
    return { ...player, manaPool: next };
  });
  return updated ? { ...game, players } : game;
}

function hasManaDelta(mana: ManaPoolDelta): boolean {
  return Object.values(mana).some((value) => numericMana(value) > 0);
}

function manaDeltaFromManaType(value: string): ManaPoolDelta | null {
  const key = MANA_TYPE_TO_POOL_KEY[value.toUpperCase()];
  return key ? { [key]: 1 } : null;
}

function manaProducedByActivation(
  card: MageCardView,
  prompt: MageGatewayEvent | null
): ManaPoolDelta | null {
  if (!shouldOptimisticallyAddManaForPrompt(prompt) || card.faceDown) return null;
  const basicLandMana = BASIC_LAND_MANA[normalizeName(cardName(card))];
  if (basicLandMana) return basicLandMana;

  const manaRules = (card.rules ?? [])
    .map(plainMageText)
    .filter((rule) => /\badds?\b/i.test(rule));
  for (const rule of manaRules) {
    const symbols = [...rule.matchAll(/\{([WUBRGC])\}/gi)].map((match) =>
      match[1].toUpperCase()
    );
    if (symbols.length === 0) continue;
    if (/\b(any color|or)\b/i.test(rule) && new Set(symbols).size > 1) continue;
    const mana = symbols.reduce<ManaPoolDelta>((counts, symbol) => {
      const key = MANA_SYMBOL_TO_POOL_KEY[symbol];
      if (key) counts[key] = numericMana(counts[key]) + 1;
      return counts;
    }, {});
    if (hasManaDelta(mana)) return mana;
  }
  return null;
}

function shouldOptimisticallyAddManaForPrompt(
  prompt: MageGatewayEvent | null
): boolean {
  const method = prompt?.callbackMethod ?? prompt?.type;
  return (
    !method ||
    method === "GAME_UPDATE" ||
    method === "GAME_UPDATE_AND_INFORM"
  );
}

function numericMana(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return 0;
}

function isSelfActivePlayer(
  player: MagePlayerView | undefined,
  game: MageGameView | null
): boolean {
  if (!player) return false;
  if (player.isActive) return true;
  return !!player.playerId && player.playerId === game?.activePlayerId;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function collectPlayableIds(game: MageGameView | null): Set<string> {
  const ids = new Set<string>();
  const objects = game?.canPlayObjects?.objects;
  if (!objects || !isPlainObject(objects)) return ids;
  for (const id of Object.keys(objects)) ids.add(normalizeUuid(id));
  return ids;
}

function collectInteractiveIds(
  prompt: MageGatewayEvent | null,
  game: MageGameView | null
): Set<string> {
  const ids = new Set<string>();
  const method = prompt?.callbackMethod ?? prompt?.type;
  const explicitTargets = targetIds(prompt?.targets);
  if (explicitTargets.length > 0) {
    for (const id of explicitTargets) ids.add(normalizeUuid(id));
  } else if (method === "GAME_SELECT" || method === "GAME_TARGET") {
    // Some effects only list choosable cards in cardsView1.
    for (const card of cardsFromView(prompt?.cardsView1)) {
      if (card.id) ids.add(normalizeUuid(card.id));
    }
  }
  for (const id of idsFromUnknownCollection(prompt?.options?.possibleTargets)) ids.add(id);
  for (const id of idsFromUnknownCollection(prompt?.options?.chosenTargets)) ids.add(id);
  for (const id of idsFromOptionsList(prompt?.options, "possibleAttackers")) ids.add(id);
  for (const id of idsFromOptionsList(prompt?.options, "possibleBlockers")) ids.add(id);
  if (isSelectingAttackersPrompt(prompt)) {
    for (const id of collectCombatAttackerIds(game)) ids.add(id);
  }
  if (isSelectingBlockersPrompt(prompt)) {
    for (const id of collectCombatBlockerIds(game)) ids.add(id);
  }
  return ids;
}

function collectPromptChoiceZones(
  prompt: MageGatewayEvent | null,
  game: MageGameView | null
): PromptChoiceZone[] {
  const view = prompt?.gameView ?? game;
  const zones: PromptChoiceZone[] = [];
  const seen = new Set<string>();

  const push = (title: string, cards: MageCardView[]) => {
    const unique = cards.filter((card) => {
      if (!card.id) return true;
      const key = normalizeUuid(card.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (unique.length > 0) zones.push({ title, cards: unique });
  };

  const pile1 = cardsFromView(prompt?.cardsView1);
  if (pile1.length > 0) {
    push(
      prompt?.cardsView2 && cardsFromView(prompt.cardsView2).length > 0
        ? "First pile"
        : "Cards to choose",
      pile1
    );
  }

  const pile2 = cardsFromView(prompt?.cardsView2);
  if (pile2.length > 0) push("Second pile", pile2);

  for (const entry of view?.revealed ?? []) {
    push(entry.name?.trim() || "Revealed cards", cardsFromRevealed(entry));
  }
  for (const entry of view?.lookedAt ?? []) {
    push(entry.name?.trim() || "Looked at", cardsFromRevealed(entry));
  }
  for (const entry of view?.companion ?? []) {
    push(entry.name?.trim() || "Companion", cardsFromRevealed(entry));
  }

  pushHandsFromRecord(view?.opponentHands, "hand", push);
  pushHandsFromRecord(view?.watchedHands, "watched hand", push);

  return zones;
}

function pushHandsFromRecord(
  hands: Record<string, MageCardsView> | undefined,
  label: string,
  push: (title: string, cards: MageCardView[]) => void
) {
  if (!hands || !isPlainObject(hands)) return;
  for (const [name, hand] of Object.entries(hands)) {
    const cards = cardsFromView(hand);
    if (cards.length > 0) {
      push(name.trim() || label, cards);
    }
  }
}

function gameViewForHands(
  game: MageGameView | null,
  promptView?: MageGameView | null
): MageGameView | null {
  if (!game && !promptView) return null;
  if (!promptView) return game;
  if (!game) return promptView;
  return {
    ...game,
    revealed: promptView.revealed ?? game.revealed,
    lookedAt: promptView.lookedAt ?? game.lookedAt,
    opponentHands: promptView.opponentHands ?? game.opponentHands,
    watchedHands: promptView.watchedHands ?? game.watchedHands,
    myHand: game.myHand ?? promptView.myHand,
  };
}

function collectVisibleHands(
  game: MageGameView | null,
  options: { spectator: boolean; selfName?: string }
): VisibleHandView[] {
  if (!game) return [];
  const hands: VisibleHandView[] = [];
  const fingerprints = new Set<string>();

  const register = (
    key: string,
    label: string,
    cards: MageCardView[],
    isOwnHand: boolean
  ) => {
    if (!isOwnHand && cards.length === 0) return;
    const fingerprint = handFingerprint(label, cards);
    if (fingerprints.has(fingerprint)) return;
    fingerprints.add(fingerprint);
    hands.push({
      key,
      label,
      shortLabel: shortHandLabel(label, isOwnHand),
      cards,
      isOwnHand,
    });
  };

  if (!options.spectator) {
    register(
      MY_HAND_VIEW_KEY,
      options.selfName ? `${options.selfName}'s hand` : "Your hand",
      cardsFromView(game.myHand),
      true
    );
  }

  appendHandsFromRecord(game.opponentHands, "opponent", register);
  appendHandsFromRecord(game.watchedHands, "watched", register);

  for (const entry of game.revealed ?? []) {
    const name = entry.name?.trim();
    if (!name || !isHandRevealName(name)) continue;
    register(`revealed:${name}`, name, cardsFromRevealed(entry), false);
  }

  for (const entry of game.lookedAt ?? []) {
    const name = entry.name?.trim();
    if (!name || !isHandRevealName(name)) continue;
    register(`looked:${name}`, name, cardsFromRevealed(entry), false);
  }

  return hands;
}

function appendHandsFromRecord(
  hands: Record<string, MageCardsView> | undefined,
  prefix: string,
  register: (
    key: string,
    label: string,
    cards: MageCardView[],
    isOwnHand: boolean
  ) => void
) {
  if (!hands || !isPlainObject(hands)) return;
  for (const [name, hand] of Object.entries(hands)) {
    const label = name.trim() || "Hand";
    register(`${prefix}:${label}`, label, cardsFromView(hand), false);
  }
}

function isHandRevealName(name: string): boolean {
  return /\bhand\b/i.test(name);
}

function handFingerprint(label: string, cards: MageCardView[]): string {
  const ids = cards
    .map((card) => card.id)
    .filter((id): id is string => !!id)
    .map(normalizeUuid)
    .sort()
    .join(",");
  return `${normalizeHandLabel(label)}:${ids}`;
}

function normalizeHandLabel(label: string): string {
  return label.trim().toLowerCase();
}

function shortHandLabel(label: string, isOwnHand: boolean): string {
  if (isOwnHand) return "Your hand";
  const trimmed = label.trim();
  const possessive = trimmed.match(/^(.+?)(?:'s|’s)\s+hand$/i);
  if (possessive?.[1]) return possessive[1].trim();
  if (/\bhand\b/i.test(trimmed)) {
    return trimmed.replace(/\s+hand\s*$/i, "").trim() || trimmed;
  }
  return trimmed.length > 20 ? `${trimmed.slice(0, 18)}…` : trimmed;
}

function normalizeUuid(id: string): string {
  return id.trim().toLowerCase();
}

function idInInteractiveSet(ids: Set<string>, id: string): boolean {
  const normalized = normalizeUuid(id);
  for (const candidate of ids) {
    if (normalizeUuid(candidate) === normalized) return true;
  }
  return false;
}

function collectSelectablePlayers(
  prompt: MageGatewayEvent | null,
  players: MagePlayerView[]
): MagePlayerView[] {
  const method = prompt?.callbackMethod ?? prompt?.type;
  if (method !== "GAME_SELECT" && method !== "GAME_TARGET") return [];
  const targetSet = new Set(targetIds(prompt?.targets).map(normalizeUuid));
  for (const id of idsFromUnknownCollection(prompt?.options?.possibleTargets)) {
    targetSet.add(id);
  }
  for (const id of idsFromUnknownCollection(prompt?.options?.chosenTargets)) {
    targetSet.add(id);
  }
  if (targetSet.size === 0) return [];
  return players.filter(
    (player) =>
      !!player.playerId && targetSet.has(normalizeUuid(player.playerId))
  );
}

function targetIds(targets: MageGatewayEvent["targets"]): string[] {
  if (!targets) return [];
  if (Array.isArray(targets)) {
    return targets.flatMap((target: unknown) => {
      if (typeof target === "string") return [target];
      if (!isPlainObject(target)) return [];
      if (typeof target.id === "string") return [target.id];
      if (typeof target.uuid === "string") return [target.uuid];
      if (typeof target.playerId === "string") return [target.playerId];
      return [];
    });
  }
  if (isPlainObject(targets)) {
    const ids: string[] = [];
    for (const [key, value] of Object.entries(targets)) {
      ids.push(key);
      if (typeof value === "string") ids.push(value);
    }
    return ids;
  }
  return [];
}

function isCardChoicePrompt(prompt: MageGatewayEvent | null): boolean {
  if (!prompt) return false;
  return (
    prompt.callbackMethod === "GAME_SELECT" ||
    prompt.callbackMethod === "GAME_TARGET" ||
    prompt.callbackMethod === "GAME_PLAY_MANA"
  );
}

function buildDeckImageMap(
  ...decks: Array<Deck | null | undefined>
): Map<string, CardImage> {
  const map = new Map<string, CardImage>();
  for (const deck of decks) {
    if (!deck) continue;
    for (const entry of [...deck.entries, ...deck.sideboard, ...deck.maybeboard]) {
      addEntryImage(map, entry);
    }
  }
  return map;
}

function mergeImageMaps(...maps: Array<Map<string, CardImage>>): Map<string, CardImage> {
  const merged = new Map<string, CardImage>();
  for (const map of maps) {
    for (const [key, image] of map) {
      if (!merged.has(key)) merged.set(key, image);
    }
  }
  return merged;
}

function addEntryImage(map: Map<string, CardImage>, entry: DeckEntry) {
  const image = { normal: entry.imageNormal, small: entry.imageSmall };
  const names = [entry.name, ...entry.name.split(" // ")];
  for (const name of names) {
    const key = normalizeName(name);
    if (key && !map.has(key)) map.set(key, image);
  }
}

function collectVisibleCardImageNames(
  game: MageGameView | null,
  players: MagePlayerView[],
  visibleHands: VisibleHandView[],
  prompt: MageGatewayEvent | null
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const addCard = (card: MageCardView | null | undefined) => {
    if (!card) return;
    for (const name of mageCardImageLookupNames(card)) {
      const key = normalizeName(name);
      if (!key || seen.has(key) || isUnknownCardImageName(key)) continue;
      seen.add(key);
      names.push(name);
    }
  };
  const addCards = (cards: MageCardView[]) => cards.forEach(addCard);

  for (const player of players) {
    addCards(cardsFromView(player.battlefield));
    addCards(cardsFromView(player.graveyard));
    addCards(cardsFromView(player.exile));
    addCards(cardsFromView(player.sideboard));
    addCard(player.topCard);
    addCards(player.commandList ?? []);
  }

  addCards(cardsFromView(game?.myHand));
  addCards(cardsFromView(game?.stack));

  for (const zone of exileZonesFromGame(game)) addCards(cardsFromView(zone));
  for (const hand of visibleHands) addCards(hand.cards);
  for (const view of game?.revealed ?? []) addCards(cardsFromRevealed(view));
  for (const view of game?.lookedAt ?? []) addCards(cardsFromRevealed(view));
  for (const view of game?.companion ?? []) addCards(cardsFromRevealed(view));
  for (const group of game?.combat ?? []) {
    addCards(cardsFromView(group.attackers));
    addCards(cardsFromView(group.blockers));
  }
  addCards(cardsFromView(prompt?.cardsView1));
  addCards(cardsFromView(prompt?.cardsView2));
  addCards(cardsFromView(prompt?.gameView?.stack));

  return names;
}

function mageCardImageLookupNames(card: MageCardView): string[] {
  const source = abilitySourceCard(card);
  const targets = source ? [source, card] : [card];
  const expanded: string[] = [];
  for (const target of targets) {
    const names = [
      target.name,
      target.displayName,
      target.displayFullName,
      target.alternateName,
      target.original?.name,
    ];
    for (const name of names) {
      if (!name) continue;
      const clean = cleanMageCardName(name);
      if (!clean) continue;
      expanded.push(clean, ...clean.split(" // "));
    }
  }
  return expanded;
}

function isMageAbility(card: MageCardView): boolean {
  if (card.isAbility) return true;
  const objectType = String(card.mageObjectType ?? "").toUpperCase();
  if (objectType.includes("ABILITY")) return true;
  return card.name === "Ability" && !!abilitySourceCard(card);
}

function abilitySourceCard(card: MageCardView): MageCardView | null {
  const source = card.sourceCard;
  return source && isPlainObject(source) ? source : null;
}

function imageCardForMageCard(card: MageCardView): MageCardView {
  return abilitySourceCard(card) ?? card;
}

function cleanMageCardName(name: string): string {
  return plainMageText(name)
    .replace(/\s+\[[^\]]+\]$/g, "")
    .replace(/\s+\([A-Z0-9]{2,6}\s+\d+[a-z]?\)$/i, "")
    .trim();
}

function imageFromScryfallCard(card: ScryfallCard): CardImage | null {
  const image = {
    normal: getCardImage(card, "normal"),
    small: getCardImage(card, "small"),
  };
  return image.normal || image.small ? image : null;
}

function scryfallCardImageLookupNames(card: ScryfallCard): string[] {
  return [
    card.name,
    ...card.name.split(" // "),
    ...(card.card_faces ?? []).map((face) => face.name),
  ];
}

function isMageToken(card: MageCardView): boolean {
  if (card.isToken) return true;
  if (cardHasType(card, "token")) return true;
  const objectType = String(card.mageObjectType ?? "").toUpperCase();
  return objectType.includes("TOKEN");
}

function imageForMageCard(
  card: MageCardView,
  imageByName: Map<string, CardImage>
): string | undefined {
  const imageCard = imageCardForMageCard(card);
  let fallbackName: string | null = null;
  for (const name of mageCardImageLookupNames(imageCard)) {
    if (!fallbackName) fallbackName = name;
    const image = imageByName.get(normalizeName(name));
    if (image?.normal || image?.small) return image.normal ?? image.small;
  }
  // Custom tokens often have no Scryfall art; avoid broken <img> requests.
  if (isMageToken(imageCard)) return undefined;
  return fallbackName ? scryfallNamedImageUrl(fallbackName) : undefined;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function scryfallNamedImageUrl(name: string): string | undefined {
  const key = normalizeName(name);
  if (!key || isUnknownCardImageName(key)) return undefined;
  const params = new URLSearchParams({
    exact: name,
    format: "image",
    version: "normal",
  });
  return `https://api.scryfall.com/cards/named?${params.toString()}`;
}

function isUnknownCardImageName(name: string): boolean {
  return (
    name === "unknown card" ||
    name === "unknown" ||
    name === "face down card" ||
    name === "face-down card"
  );
}

function plainMageText(value?: string | null): string {
  return (value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function cardName(card: MageCardView): string {
  if (isMageAbility(card)) {
    const source = abilitySourceCard(card);
    const sourceName = source ? cardName(source) : null;
    const abilityText = plainMageText(card.rules?.[0]);
    if (sourceName && abilityText) return `${sourceName}: ${abilityText}`;
    if (sourceName) return sourceName;
    if (abilityText) return abilityText;
  }
  return (
    card.displayName ||
    card.name ||
    card.displayFullName ||
    card.original?.name ||
    "Unknown card"
  );
}

function isLandCard(card: MageCardView): boolean {
  return cardHasType(card, "land");
}

function cardHasType(card: MageCardView, typeName: string): boolean {
  const needle = typeName.toLowerCase();
  return (card.cardTypes ?? []).some((type) => type.toLowerCase() === needle);
}

function presentStat(value?: string | number | null): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function typeLine(card: MageCardView): string {
  const types = [
    ...(card.superTypes ?? []),
    ...(card.cardTypes ?? []),
  ].map(formatLabel);
  const subTypes = extractSubTypes(card.subTypes);
  return [types.join(" "), subTypes ? `— ${subTypes}` : ""].filter(Boolean).join(" ");
}

function extractSubTypes(raw: unknown): string {
  if (Array.isArray(raw)) {
    return raw.map(String).map(formatLabel).join(" ");
  }
  if (typeof raw === "string") return raw;
  if (!raw || typeof raw !== "object") return "";
  const object = raw as Record<string, unknown>;
  const candidates = [object.subtypes, object.subTypes, object.values];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map(String).map(formatLabel).join(" ");
    }
  }
  return Object.values(object)
    .filter((value): value is string => typeof value === "string")
    .map(formatLabel)
    .join(" ");
}

function manaCost(card: MageCardView): string {
  return [...(card.manaCostLeftStr ?? []), ...(card.manaCostRightStr ?? [])].join(" ");
}

function powerToughness(card: MageCardView): string {
  if (cardHasType(card, "planeswalker")) {
    return presentStat(card.loyalty) ?? "";
  }
  if (cardHasType(card, "battle")) {
    return presentStat(card.defense) ?? "";
  }
  if (!cardHasType(card, "creature")) return "";

  const power = presentStat(card.power);
  const toughness = presentStat(card.toughness);
  if (!power && !toughness) return "";
  return `${power ?? "?"}/${toughness ?? "?"}`;
}

type PromptChoiceOption = {
  label: string;
  value: string;
  sendAsUuid: boolean;
};

function optionsForChoice(prompt: MageGatewayEvent | null): PromptChoiceOption[] {
  const choice = prompt?.choice;
  const choiceFromKeyChoices = Object.entries(choice?.keyChoices ?? {});
  if (choiceFromKeyChoices.length > 0) {
    return choiceFromKeyChoices
      .filter(([value, label]) => typeof value === "string" && typeof label === "string")
      .map(([value, label]) => ({
        value,
        label: plainMageText(label) || value,
        sendAsUuid: false,
      }));
  }
  const choices = Array.isArray(choice?.choices) ? choice.choices : [];
  if (choices.length > 0) {
    return choices
      .filter((value) => typeof value === "string")
      .map((value) => ({
        value,
        label: plainMageText(value),
        sendAsUuid: false,
      }))
      .filter((option) => option.value.trim().length > 0);
  }

  const fallbackChoices = Object.entries(prompt?.choices ?? {});
  if (fallbackChoices.length > 0) {
    return fallbackChoices
      .filter(
        ([value, label]) =>
          typeof value === "string" &&
          value.trim().length > 0 &&
          typeof label === "string"
      )
      .map(([value, label]) => ({
        value,
        label: plainMageText(label) || value,
        sendAsUuid: isUuid(value),
      }))
      .filter((option) => option.label.trim().length > 0);
  }

  return [];
}

function isUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[1-5][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(
    value.trim()
  );
}

function optionText(
  options: Record<string, unknown> | null | undefined,
  key: string,
  fallback: string
): string {
  const value = options?.[key];
  if (typeof value !== "string") return fallback;
  return plainMageText(value) || fallback;
}

function formatStep(game?: MageGameView | null): string {
  const values = [game?.phase, game?.step].filter(Boolean).map(String);
  return values.length > 0 ? values.map(formatLabel).join(" / ") : "—";
}

function formatTurn(game?: MageGameView | null): string {
  const rawTurn = game?.turn;
  if (typeof rawTurn !== "number" || !Number.isFinite(rawTurn)) return "—";
  const playerCount = gamePlayerCount(game);
  const sharedTurn = Math.ceil(Math.max(1, Math.trunc(rawTurn)) / playerCount);
  return String(sharedTurn);
}

function gamePlayerCount(game?: MageGameView | null): number {
  const players = game?.players ?? [];
  const playerKeys = new Set(
    players
      .map((player, index) => player.playerId ?? player.name ?? `player-${index}`)
      .filter((key) => key.trim().length > 0)
  );
  return Math.max(2, playerKeys.size);
}

function formatLabel(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function eventSummary(event: MageGatewayEvent): string {
  if (event.gameView) {
    return `Turn ${formatTurn(event.gameView)} ${formatStep(event.gameView)}`;
  }
  return event.type ?? "Gateway event";
}
