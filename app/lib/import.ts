import type { DeckEntry, DeckZone } from "./types";
import { cardToEntry } from "./decks";
import { getCardsByIdentifiers, type CollectionIdentifier } from "./scryfall";

export type ParsedLine = {
  quantity: number;
  name: string;
  set?: string;
  collectorNumber?: string;
  isCommander?: boolean;
  zone?: DeckZone;
};

export type ImportResult = {
  entries: DeckEntry[];
  sideboard: DeckEntry[];
  maybeboard: DeckEntry[];
  unresolved: ParsedLine[];
  deckName?: string;
};

const SECTION_HEADERS = new Set([
  "deck",
  "main",
  "mainboard",
  "sideboard",
  "commander",
  "companion",
  "maybeboard",
]);

// "3 Lightning Bolt", "3x Lightning Bolt", "3 Lightning Bolt (M21) 162"
const LINE_RE =
  /^\s*(\d+)\s*[xX]?\s+([^(\[\n]+?)\s*(?:\(([A-Za-z0-9]{2,6})\)(?:\s*([^\s]+))?)?\s*(?:\*[A-Z]\*)?\s*$/;
// MWS: "    1 [M21] Lightning Bolt"
const MWS_RE = /^\s*(\d+)\s*\[([A-Za-z0-9 ]{0,6})\]\s*(.+?)\s*$/;

// Scryfall card names for DFCs / split cards are "Front // Back", but pasted
// lists only need the front face to resolve. Drop the back half so users
// pasting either form import cleanly.
function frontFaceName(name: string): string {
  const idx = name.indexOf("//");
  return (idx >= 0 ? name.slice(0, idx) : name).trim();
}

function zoneForSection(section: string | null): DeckZone {
  if (section === "companion") return "sideboard";
  if (section === "maybeboard") return "maybeboard";
  return section === "sideboard" ? "sideboard" : "main";
}

export function parseDeckText(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  let section: string | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("//") || line.startsWith("#")) continue;
    if (SECTION_HEADERS.has(line.toLowerCase())) {
      section = line.toLowerCase();
      continue;
    }

    const mws = MWS_RE.exec(line);
    if (mws) {
      const set = mws[2].trim();
      out.push({
        quantity: Number(mws[1]),
        name: frontFaceName(mws[3]),
        set: set && set !== "   " ? set.toLowerCase() : undefined,
        isCommander: section === "commander",
        zone: zoneForSection(section),
      });
      continue;
    }

    const m = LINE_RE.exec(line);
    if (m) {
      out.push({
        quantity: Number(m[1]),
        name: frontFaceName(m[2]),
        set: m[3]?.toLowerCase(),
        collectorNumber: m[4],
        isCommander: section === "commander",
        zone: zoneForSection(section),
      });
      continue;
    }
    // Bare card name (no leading count) — treat as qty 1
    if (/^[A-Za-z][^|\t]{1,}/.test(line) && !/^\d/.test(line)) {
      out.push({
        quantity: 1,
        name: frontFaceName(line),
        isCommander: section === "commander",
        zone: zoneForSection(section),
      });
    }
  }
  return out;
}

type JsonDeckEntryShape = {
  name: string;
  quantity?: number;
  set?: string;
  collectorNumber?: string;
  isCommander?: boolean;
};

type JsonDeckShape = {
  name?: string;
  entries?: JsonDeckEntryShape[];
  sideboard?: JsonDeckEntryShape[];
  maybeboard?: JsonDeckEntryShape[];
};

export function parseDeckInput(
  text: string
): { lines: ParsedLine[]; deckName?: string } {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as JsonDeckShape;
      if (
        Array.isArray(obj.entries) ||
        Array.isArray(obj.sideboard) ||
        Array.isArray(obj.maybeboard)
      ) {
        const toLines = (
          entries: JsonDeckEntryShape[] | undefined,
          zone: DeckZone
        ): ParsedLine[] =>
          (entries ?? [])
            .filter((e) => e && typeof e.name === "string")
            .map((e) => ({
              quantity: Math.max(1, Number(e.quantity) || 1),
              name: frontFaceName(e.name),
              set: e.set?.toLowerCase(),
              collectorNumber: e.collectorNumber,
              isCommander: zone === "main" && e.isCommander === true,
              zone,
            }));
        return {
          deckName: obj.name,
          lines: [
            ...toLines(obj.entries, "main"),
            ...toLines(obj.sideboard, "sideboard"),
            ...toLines(obj.maybeboard, "maybeboard"),
          ],
        };
      }
    } catch {
      // Fall through to text parsing.
    }
  }
  return { lines: parseDeckText(text) };
}

export async function resolveLines(
  lines: ParsedLine[]
): Promise<ImportResult> {
  if (lines.length === 0) {
    return { entries: [], sideboard: [], maybeboard: [], unresolved: [] };
  }

  const identifiers: CollectionIdentifier[] = lines.map((l) => {
    if (l.set && l.collectorNumber) {
      return { set: l.set, collector_number: l.collectorNumber };
    }
    if (l.set) return { name: l.name, set: l.set };
    return { name: l.name };
  });

  const cards = await getCardsByIdentifiers(identifiers);

  // Scryfall lookups normalize the card name — match back by lowercased name
  // so we can merge the user's quantities onto the resolved card. Also index
  // the front face of DFCs since users commonly paste only that half.
  const byName = new Map<string, (typeof cards)[number]>();
  for (const c of cards) {
    const full = c.name.toLowerCase();
    byName.set(full, c);
    const front = full.split(" // ")[0];
    if (front && front !== full) byName.set(front, c);
  }

  const entries: DeckEntry[] = [];
  const sideboard: DeckEntry[] = [];
  const maybeboard: DeckEntry[] = [];
  const unresolved: ParsedLine[] = [];
  for (const l of lines) {
    const card = byName.get(l.name.toLowerCase());
    if (!card) {
      unresolved.push(l);
      continue;
    }
    const target =
      l.zone === "sideboard"
        ? sideboard
        : l.zone === "maybeboard"
          ? maybeboard
          : entries;
    const existing = target.find((e) => e.cardId === card.id);
    if (existing) {
      existing.quantity += l.quantity;
      if (l.zone === "main") existing.isCommander ||= l.isCommander;
    } else {
      const entry = cardToEntry(card, l.quantity);
      if (l.zone === "main" && l.isCommander) entry.isCommander = true;
      target.push(entry);
    }
  }
  return { entries, sideboard, maybeboard, unresolved };
}
