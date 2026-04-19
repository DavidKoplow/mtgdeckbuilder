import type { DeckEntry } from "./types";
import { cardToEntry } from "./decks";
import { getCardsByIdentifiers, type CollectionIdentifier } from "./scryfall";

export type ParsedLine = {
  quantity: number;
  name: string;
  set?: string;
  collectorNumber?: string;
};

export type ImportResult = {
  entries: DeckEntry[];
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

export function parseDeckText(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("//") || line.startsWith("#")) continue;
    if (SECTION_HEADERS.has(line.toLowerCase())) continue;

    const mws = MWS_RE.exec(line);
    if (mws) {
      const set = mws[2].trim();
      out.push({
        quantity: Number(mws[1]),
        name: frontFaceName(mws[3]),
        set: set && set !== "   " ? set.toLowerCase() : undefined,
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
      });
      continue;
    }
    // Bare card name (no leading count) — treat as qty 1
    if (/^[A-Za-z][^|\t]{1,}/.test(line) && !/^\d/.test(line)) {
      out.push({ quantity: 1, name: frontFaceName(line) });
    }
  }
  return out;
}

type JsonDeckShape = {
  name?: string;
  entries?: Array<{
    name: string;
    quantity?: number;
    set?: string;
    collectorNumber?: string;
  }>;
};

export function parseDeckInput(
  text: string
): { lines: ParsedLine[]; deckName?: string } {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as JsonDeckShape;
      if (Array.isArray(obj.entries)) {
        return {
          deckName: obj.name,
          lines: obj.entries
            .filter((e) => e && typeof e.name === "string")
            .map((e) => ({
              quantity: Math.max(1, Number(e.quantity) || 1),
              name: frontFaceName(e.name),
              set: e.set?.toLowerCase(),
              collectorNumber: e.collectorNumber,
            })),
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
  if (lines.length === 0) return { entries: [], unresolved: [] };

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
  const unresolved: ParsedLine[] = [];
  for (const l of lines) {
    const card = byName.get(l.name.toLowerCase());
    if (!card) {
      unresolved.push(l);
      continue;
    }
    const existing = entries.find((e) => e.cardId === card.id);
    if (existing) {
      existing.quantity += l.quantity;
    } else {
      entries.push(cardToEntry(card, l.quantity));
    }
  }
  return { entries, unresolved };
}
