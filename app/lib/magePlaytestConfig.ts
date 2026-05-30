import { getCardsByIdentifiers, type CollectionIdentifier } from "./scryfall";
import type { Deck, DeckEntry, ScryfallCard } from "./types";

export type MageOpponentType = "ai" | "human";
export type MageOpponentDeckMode = "current" | "random" | "selected";
export type MageOpponentDeckSource = "saved" | "official";
export type MageServerId = "local-ai" | "us" | "eu" | "beta";

export type MageGameMode =
  | "commander"
  | "standard"
  | "pioneer"
  | "modern"
  | "legacy"
  | "vintage"
  | "pauper"
  | "freeform";

export type MageAiType =
  | "COMPUTER_MAD"
  | "COMPUTER_MONTE_CARLO"
  | "COMPUTER_RANDOM"
  | "COMPUTER_DRAFT_BOT";

export type MagePlaytestConfig = {
  opponentType: MageOpponentType;
  gameMode: MageGameMode;
  ai: MageAiType;
  playerRating?: number;
  mageServerId?: MageServerId;
  opponentDeckMode?: MageOpponentDeckMode;
  opponentDeckSource?: MageOpponentDeckSource | null;
  opponentDeckId?: string | null;
  opponentDeckPublicId?: string | null;
  opponentDeckName?: string | null;
  includeOfficialOpponentDecks?: boolean;
};

export type MageGameModeOption = {
  id: MageGameMode;
  label: string;
};

export type MageAiOption = {
  id: MageAiType;
  label: string;
};

export type MageServerOption = {
  id: MageServerId;
  label: string;
  host: string;
  port: number;
  note: string;
  ai: boolean;
};

export type MageDeckValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checkedCards: number;
};

type ValidationEntry = {
  entry: DeckEntry;
  zone: "main" | "sideboard" | "maybeboard";
  card?: ScryfallCard | null;
};

export const MAGE_GAME_MODES: MageGameModeOption[] = [
  { id: "commander", label: "Commander" },
  { id: "standard", label: "Standard" },
  { id: "pioneer", label: "Pioneer" },
  { id: "modern", label: "Modern" },
  { id: "legacy", label: "Legacy" },
  { id: "vintage", label: "Vintage" },
  { id: "pauper", label: "Pauper" },
  { id: "freeform", label: "Freeform" },
];

export const MAGE_AI_OPTIONS: MageAiOption[] = [
  { id: "COMPUTER_MAD", label: "MAGE AI" },
  { id: "COMPUTER_MONTE_CARLO", label: "Monte Carlo AI" },
];

export const MAGE_DEFAULT_SERVER_ID: MageServerId = "beta";
export const MAGE_DEFAULT_PLAYER_RATING = 800;
export const MAGE_MIN_PLAYER_RATING = 0;
export const MAGE_MAX_PLAYER_RATING = 3000;

export const MAGE_SERVER_OPTIONS: MageServerOption[] = [
  {
    id: "local-ai",
    label: "Local AI",
    host: "127.0.0.1",
    port: 17171,
    note: "Docker AI server",
    ai: true,
  },
  {
    id: "beta",
    label: "Beta",
    host: "beta.xmage.today",
    port: 17171,
    note: "Official public",
    ai: false,
  },
  {
    id: "us",
    label: "US",
    host: "us.xmage.today",
    port: 17171,
    note: "Public tables",
    ai: false,
  },
  {
    id: "eu",
    label: "EU",
    host: "eu.xmage.today",
    port: 17171,
    note: "Public tables",
    ai: false,
  },
];

const MODE_IDS = new Set<MageGameMode>(MAGE_GAME_MODES.map((mode) => mode.id));
const AI_IDS = new Set<MageAiType>(MAGE_AI_OPTIONS.map((option) => option.id));
const SERVER_IDS = new Set<MageServerId>(
  MAGE_SERVER_OPTIONS.map((option) => option.id)
);
const BASIC_LANDS = new Set([
  "Plains",
  "Island",
  "Swamp",
  "Mountain",
  "Forest",
  "Wastes",
  "Snow-Covered Plains",
  "Snow-Covered Island",
  "Snow-Covered Swamp",
  "Snow-Covered Mountain",
  "Snow-Covered Forest",
  "Snow-Covered Wastes",
]);
const COPY_LIMITS = new Map<string, number>([
  ["Relentless Rats", Number.POSITIVE_INFINITY],
  ["Shadowborn Apostle", Number.POSITIVE_INFINITY],
  ["Rat Colony", Number.POSITIVE_INFINITY],
  ["Persistent Petitioners", Number.POSITIVE_INFINITY],
  ["Dragon's Approach", Number.POSITIVE_INFINITY],
  ["Slime Against Humanity", Number.POSITIVE_INFINITY],
  ["Templar Knight", Number.POSITIVE_INFINITY],
  ["Hare Apparent", Number.POSITIVE_INFINITY],
  ["Tempest Hawk", Number.POSITIVE_INFINITY],
  ["Cid, Timeless Artificer", Number.POSITIVE_INFINITY],
  ["Seven Dwarves", 7],
  ["Nazgul", 9],
  ["Once More with Feeling", 1],
]);

export function defaultMageGameMode(format: string | undefined): MageGameMode {
  const normalized = format?.trim().toLowerCase();
  return MODE_IDS.has(normalized as MageGameMode)
    ? (normalized as MageGameMode)
    : "commander";
}

export function defaultMageAiType(ai: string | null | undefined): MageAiType {
  const normalized = ai?.trim();
  return AI_IDS.has(normalized as MageAiType)
    ? (normalized as MageAiType)
    : "COMPUTER_MAD";
}

export function defaultMageServerId(
  serverId: string | null | undefined
): MageServerId {
  const normalized = serverId?.trim().toLowerCase();
  return SERVER_IDS.has(normalized as MageServerId)
    ? (normalized as MageServerId)
    : MAGE_DEFAULT_SERVER_ID;
}

export function defaultMagePlayerRating(
  rating: number | string | null | undefined
): number {
  const parsed =
    typeof rating === "number"
      ? rating
      : typeof rating === "string"
        ? Number.parseInt(rating, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return MAGE_DEFAULT_PLAYER_RATING;
  }
  return Math.min(
    MAGE_MAX_PLAYER_RATING,
    Math.max(MAGE_MIN_PLAYER_RATING, Math.round(parsed))
  );
}

export function mageAiServerOption(): MageServerOption | null {
  return MAGE_SERVER_OPTIONS.find((option) => option.ai) ?? null;
}

export function effectiveMageServerId(
  config: Pick<MagePlaytestConfig, "opponentType" | "mageServerId">
): MageServerId {
  if (config.opponentType === "ai") {
    return mageAiServerOption()?.id ?? defaultMageServerId(config.mageServerId);
  }
  const serverId = defaultMageServerId(config.mageServerId);
  return mageServerOption(serverId).ai ? MAGE_DEFAULT_SERVER_ID : serverId;
}

export function mageServerOption(serverId: string | null | undefined) {
  const id = defaultMageServerId(serverId);
  return (
    MAGE_SERVER_OPTIONS.find((option) => option.id === id) ??
    MAGE_SERVER_OPTIONS[0]!
  );
}

export function mageGameModeLabel(mode: MageGameMode): string {
  return MAGE_GAME_MODES.find((option) => option.id === mode)?.label ?? mode;
}

export async function validateDeckForMageGameMode(
  deck: Deck,
  gameMode: MageGameMode,
  signal?: AbortSignal
): Promise<MageDeckValidation> {
  const entries = validationEntries(deck, gameMode);
  const cardsById = await loadValidationCards(entries, signal);
  const withCards = entries.map((item) => ({
    ...item,
    card: cardsById.get(item.entry.cardId) ?? null,
  }));
  const validatedEntries =
    gameMode === "commander"
      ? withCards.filter((item) => item.zone !== "maybeboard" || hasCompanion(item.card))
      : withCards;
  const errors: string[] = [];
  const warnings: string[] = [];

  validateSizes(deck, gameMode, validatedEntries, errors);
  validateCopyCounts(validatedEntries, gameMode, errors);
  validateLegalities(validatedEntries, gameMode, errors, warnings);

  if (gameMode === "commander") {
    validateCommander(deck, validatedEntries, errors, warnings);
  }

  for (const item of validatedEntries) {
    if (!item.card) {
      errors.push(`Could not verify ${item.entry.name}.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    checkedCards: cardsById.size,
  };
}

function validationEntries(deck: Deck, gameMode: MageGameMode): ValidationEntry[] {
  const sideboardEntries = deck.sideboard.map((entry) => ({
    entry,
    zone: "sideboard" as const,
  }));
  const maybeboardEntries =
    gameMode === "commander"
      ? deck.maybeboard.map((entry) => ({
          entry,
          zone: "maybeboard" as const,
        }))
      : [];
  return [
    ...deck.entries.map((entry) => ({ entry, zone: "main" as const })),
    ...sideboardEntries,
    ...maybeboardEntries,
  ].filter((item) => item.entry.quantity > 0);
}

async function loadValidationCards(
  entries: ValidationEntry[],
  signal?: AbortSignal
): Promise<Map<string, ScryfallCard>> {
  const identifiers = new Map<string, CollectionIdentifier>();
  for (const { entry } of entries) {
    if (!entry.cardId) continue;
    identifiers.set(entry.cardId, identifierForCardId(entry.cardId));
  }
  const cards = await getCardsByIdentifiers([...identifiers.values()], signal);
  const cardsById = new Map<string, ScryfallCard>();
  for (const card of cards) {
    cardsById.set(card.id, card);
    if (card.oracle_id) {
      cardsById.set(`oracle:${card.oracle_id}`, card);
    }
  }
  return cardsById;
}

function identifierForCardId(cardId: string): CollectionIdentifier {
  if (cardId.startsWith("oracle:")) {
    return { oracle_id: cardId.slice("oracle:".length) };
  }
  return { id: cardId };
}

function validateSizes(
  deck: Deck,
  gameMode: MageGameMode,
  entries: ValidationEntry[],
  errors: string[]
) {
  const mainCount = countEntries(deck.entries);
  const sideboardCount = countEntries(deck.sideboard);
  const companionEntries = entries.filter(
    (item) =>
      hasCompanion(item.card) &&
      (item.zone === "sideboard" || item.zone === "maybeboard")
  );
  if (gameMode === "freeform") {
    if (mainCount === 0) errors.push("Freeform requires at least one main-deck card.");
    return;
  }

  if (gameMode === "commander") {
    const commanderCount = deck.entries.reduce(
      (total, entry) => total + (entry.isCommander ? entry.quantity : 0),
      0
    );
    const companionCount = companionEntries.reduce(
      (total, item) => total + item.entry.quantity,
      0
    );
    const nonCompanionSideboardEntries = entries.filter(
      (item) => item.zone === "sideboard" && !hasCompanion(item.card)
    );
    if (commanderCount < 1 || commanderCount > 2) {
      errors.push("Commander requires one commander, or two legal partner commanders.");
    }
    if (nonCompanionSideboardEntries.length > 0) {
      errors.push(
        `Commander playtest sideboard can only contain a companion. Move or remove: ${summarizeEntries(nonCompanionSideboardEntries)}.`
      );
    }
    if (companionCount > 1) {
      errors.push("Commander playtest sideboard can contain at most one companion.");
    }
    if (companionCount > 0 ? mainCount + companionCount !== 101 : mainCount !== 100) {
      errors.push(
        companionCount > 0
          ? "Commander requires 100 cards including commander(s), plus one companion."
          : "Commander requires exactly 100 cards including commander(s)."
      );
    }
    return;
  }

  if (mainCount < 60) {
    errors.push(`${mageGameModeLabel(gameMode)} requires at least 60 main-deck cards.`);
  }
  if (sideboardCount > 15) {
    errors.push(`${mageGameModeLabel(gameMode)} sideboards can contain at most 15 cards.`);
  }
}

function validateCopyCounts(
  entries: ValidationEntry[],
  gameMode: MageGameMode,
  errors: string[]
) {
  if (gameMode === "freeform") return;

  const counts = new Map<string, number>();
  for (const { entry } of entries) {
    counts.set(entry.name, (counts.get(entry.name) ?? 0) + entry.quantity);
  }

  for (const [name, count] of counts) {
    const limit = maxCopiesFor(name, gameMode);
    if (count > limit) {
      const copyLabel = Number.isFinite(limit) ? String(limit) : "any number of";
      errors.push(`${name} exceeds the ${copyLabel}-copy limit.`);
    }
  }
}

function maxCopiesFor(name: string, gameMode: MageGameMode): number {
  if (BASIC_LANDS.has(name)) return Number.POSITIVE_INFINITY;
  const override = COPY_LIMITS.get(name);
  if (override !== undefined) return override;
  return gameMode === "commander" ? 1 : 4;
}

function validateLegalities(
  entries: ValidationEntry[],
  gameMode: MageGameMode,
  errors: string[],
  warnings: string[]
) {
  if (gameMode === "freeform") return;

  const checkedByName = new Set<string>();
  for (const { entry, card } of entries) {
    if (!card || checkedByName.has(entry.name)) continue;
    checkedByName.add(entry.name);
    const legality = card.legalities?.[gameMode];
    if (legality === "legal") continue;
    if (gameMode === "vintage" && legality === "restricted") {
      const total = entries
        .filter((item) => item.entry.name === entry.name)
        .reduce((sum, item) => sum + item.entry.quantity, 0);
      if (total > 1) {
        errors.push(`${entry.name} is restricted in Vintage.`);
      }
      continue;
    }
    if (!legality) {
      warnings.push(`Could not read ${entry.name} ${mageGameModeLabel(gameMode)} legality.`);
    } else {
      errors.push(`${entry.name} is ${legality.replace(/_/g, " ")} in ${mageGameModeLabel(gameMode)}.`);
    }
  }
}

function validateCommander(
  deck: Deck,
  entries: ValidationEntry[],
  errors: string[],
  warnings: string[]
) {
  const commanderEntries = deck.entries.filter(
    (entry) => entry.isCommander && entry.quantity > 0
  );
  const cardByEntryId = new Map(entries.map((item) => [item.entry.cardId, item.card]));
  const commanders = commanderEntries
    .map((entry) => ({ entry, card: cardByEntryId.get(entry.cardId) ?? null }))
    .filter((item) => item.card);

  for (const { entry, card } of commanders) {
    if (card && !isCommanderCandidate(card)) {
      errors.push(`${entry.name} is not a valid Commander.`);
    }
  }

  if (commanders.length === 2 && !commandersHaveObviousPartnerRule(commanders)) {
    warnings.push("MAGE will verify that the two commanders can legally partner.");
  }

  const commanderIdentity = new Set<string>();
  for (const { card } of commanders) {
    for (const color of card?.color_identity ?? []) commanderIdentity.add(color);
  }
  for (const { entry, card } of entries) {
    if (!card) continue;
    for (const color of card.color_identity ?? []) {
      if (!commanderIdentity.has(color)) {
        errors.push(`${entry.name} is outside your commander's color identity.`);
        break;
      }
    }
  }
}

function commandersHaveObviousPartnerRule(
  commanders: Array<{ entry: DeckEntry; card: ScryfallCard | null }>
): boolean {
  return commanders.every(({ card }) => {
    const text = oracleText(card).toLowerCase();
    return (
      text.includes("partner") ||
      text.includes("doctor's companion") ||
      text.includes("friends forever") ||
      text.includes("choose a background")
    );
  });
}

function isCommanderCandidate(card: ScryfallCard): boolean {
  const typeLine = card.type_line?.toLowerCase() ?? "";
  if (oracleText(card).toLowerCase().includes("can be your commander")) {
    return true;
  }
  return (
    typeLine.includes("legendary") &&
    (typeLine.includes("creature") ||
      typeLine.includes("vehicle") ||
      typeLine.includes("spacecraft"))
  );
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

function countEntries(entries: DeckEntry[]): number {
  return entries.reduce((total, entry) => total + Math.max(0, entry.quantity), 0);
}

function summarizeEntries(entries: ValidationEntry[]): string {
  const names = entries
    .map((item) =>
      item.entry.quantity > 1
        ? `${item.entry.quantity} ${item.entry.name}`
        : item.entry.name
    )
    .slice(0, 4);
  const remaining = entries.length - names.length;
  return remaining > 0 ? `${names.join(", ")} and ${remaining} more` : names.join(", ");
}
