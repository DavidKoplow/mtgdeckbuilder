import type { Deck, DeckEntry } from "./types";

export type DeckFormat =
  | "casual"
  | "commander"
  | "standard"
  | "pioneer"
  | "modern"
  | "legacy"
  | "vintage"
  | "pauper";

export type DeckLegalityState = "legal" | "not-legal" | "unknown";

export type DeckCardLegalityIssue = {
  kind: "card-legality" | "copy-limit";
  cardId: string;
  name: string;
  message: string;
  affectsDeck?: boolean;
  status?: string;
  quantity?: number;
  limit?: number;
};

export type DeckLegalitySummary = {
  format: DeckFormat;
  label: string;
  state: DeckLegalityState;
  messages: string[];
  cardIssuesById: Map<string, DeckCardLegalityIssue[]>;
  missingLegalityCount: number;
};

export const DEFAULT_DECK_FORMAT: DeckFormat = "commander";

export const DECK_FORMAT_OPTIONS: Array<{ id: DeckFormat; label: string }> = [
  { id: "casual", label: "Casual" },
  { id: "commander", label: "Commander" },
  { id: "standard", label: "Standard" },
  { id: "pioneer", label: "Pioneer" },
  { id: "modern", label: "Modern" },
  { id: "legacy", label: "Legacy" },
  { id: "vintage", label: "Vintage" },
  { id: "pauper", label: "Pauper" },
];

const FORMAT_LABELS = new Map(
  DECK_FORMAT_OPTIONS.map((format) => [format.id, format.label])
);
const FORMAT_IDS = new Set<DeckFormat>(
  DECK_FORMAT_OPTIONS.map((format) => format.id)
);

const BASIC_LANDS = new Set(
  [
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
  ].map(cardNameKey)
);

const COPY_LIMITS = new Map(
  [
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
  ].map(([name, limit]) => [cardNameKey(String(name)), Number(limit)] as const)
);

export function normalizeDeckFormat(format: string | null | undefined): DeckFormat {
  const normalized = format?.trim().toLowerCase();
  return FORMAT_IDS.has(normalized as DeckFormat)
    ? (normalized as DeckFormat)
    : DEFAULT_DECK_FORMAT;
}

export function deckFormatLabel(format: string | null | undefined): string {
  const normalized = normalizeDeckFormat(format);
  return FORMAT_LABELS.get(normalized) ?? normalized;
}

export function analyzeDeckLegality(deck: Deck): DeckLegalitySummary {
  const format = normalizeDeckFormat(deck.format);
  const label = deckFormatLabel(format);
  const activeEntries = [
    ...(deck.entries ?? []),
    ...(deck.sideboard ?? []),
  ].filter((entry) => entry.quantity > 0);
  const activeEntrySet = new Set(activeEntries);
  const visibleEntries = [
    ...activeEntries,
    ...(deck.maybeboard ?? []).filter((entry) => entry.quantity > 0),
  ];
  const cardIssuesById = new Map<string, DeckCardLegalityIssue[]>();
  const messages: string[] = [];
  let missingLegalityCount = 0;

  for (const issue of deckSizeIssues(deck, format, label)) {
    messages.push(issue);
  }

  const activeCountsByName = new Map<string, number>();
  const entriesByName = new Map<string, DeckEntry[]>();

  for (const entry of visibleEntries) {
    const affectsDeck = activeEntrySet.has(entry);
    const key = cardNameKey(entry.name);
    if (affectsDeck) {
      activeCountsByName.set(
        key,
        (activeCountsByName.get(key) ?? 0) + entry.quantity
      );
      const entries = entriesByName.get(key) ?? [];
      entries.push(entry);
      entriesByName.set(key, entries);
    }

    if (format === "casual") continue;

    const status = legalityStatus(entry, format);
    if (status === undefined) {
      if (affectsDeck) missingLegalityCount += 1;
      continue;
    }
    if (status === "legal") continue;
    if (format === "vintage" && status === "restricted") continue;

    addCardIssue(cardIssuesById, {
      kind: "card-legality",
      cardId: entry.cardId,
      name: entry.name,
      status,
      affectsDeck,
      message: `${entry.name} is ${status.replace(/_/g, " ")} in ${label}.`,
    });
  }

  for (const [nameKey, quantity] of activeCountsByName) {
    const entries = entriesByName.get(nameKey) ?? [];
    const limit = copyLimitFor(entries, format);
    if (quantity <= limit) continue;

    const firstEntry = entries[0];
    const copyLabel = Number.isFinite(limit) ? String(limit) : "any number of";
    const message = `${firstEntry.name} exceeds the ${copyLabel}-copy limit in ${label}.`;
    messages.push(message);
    for (const entry of entries) {
      addCardIssue(cardIssuesById, {
        kind: "copy-limit",
        cardId: entry.cardId,
        name: entry.name,
        quantity,
        limit,
        message,
      });
    }
  }

  for (const issues of cardIssuesById.values()) {
    for (const issue of issues) {
      if (issue.kind === "card-legality" && issue.affectsDeck !== false) {
        messages.push(issue.message);
      }
    }
  }

  const state: DeckLegalityState =
    messages.length > 0
      ? "not-legal"
      : missingLegalityCount > 0
        ? "unknown"
        : "legal";

  return {
    format,
    label,
    state,
    messages,
    cardIssuesById,
    missingLegalityCount,
  };
}

export function legalityStatus(
  entry: DeckEntry,
  format: string | null | undefined
): string | undefined {
  const normalizedFormat = normalizeDeckFormat(format);
  return entry.legalities?.[normalizedFormat]?.trim().toLowerCase();
}

function deckSizeIssues(
  deck: Deck,
  format: DeckFormat,
  label: string
): string[] {
  if (format === "casual") return [];
  const mainCount = countEntries(deck.entries);
  const sideboardCount = countEntries(deck.sideboard);
  if (format === "commander") {
    const commanderCount = (deck.entries ?? []).reduce(
      (total, entry) => total + (entry.isCommander ? entry.quantity : 0),
      0
    );
    const issues: string[] = [];
    if (commanderCount < 1 || commanderCount > 2) {
      issues.push("Commander requires one commander, or two partner commanders.");
    }
    const libraryCount = mainCount - commanderCount;
    if (mainCount !== 100 && libraryCount !== 100) {
      issues.push("Commander requires 100 cards, or 100 library cards plus commanders.");
    }
    return issues;
  }

  const issues: string[] = [];
  if (mainCount < 60) {
    issues.push(`${label} requires at least 60 main-deck cards.`);
  }
  if (sideboardCount > 15) {
    issues.push(`${label} sideboards can contain at most 15 cards.`);
  }
  return issues;
}

function copyLimitFor(entries: DeckEntry[], format: DeckFormat): number {
  if (format === "casual") return Number.POSITIVE_INFINITY;
  if (entries.some((entry) => legalityStatus(entry, format) === "restricted")) {
    return 1;
  }
  const nameKey = cardNameKey(entries[0]?.name ?? "");
  if (BASIC_LANDS.has(nameKey)) return Number.POSITIVE_INFINITY;
  const override = COPY_LIMITS.get(nameKey);
  if (override !== undefined) return override;
  return format === "commander" ? 1 : 4;
}

function countEntries(entries: DeckEntry[] | undefined): number {
  return (entries ?? []).reduce((total, entry) => total + entry.quantity, 0);
}

function addCardIssue(
  issuesById: Map<string, DeckCardLegalityIssue[]>,
  issue: DeckCardLegalityIssue
) {
  const issues = issuesById.get(issue.cardId) ?? [];
  issues.push(issue);
  issuesById.set(issue.cardId, issues);
}

function cardNameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
