import { getCardsByIdentifiers } from "./scryfall";
import type { Deck, DeckEntry } from "./types";

export type ExportFormat =
  | "text"
  | "mtga"
  | "mtgo"
  | "mws"
  | "csv"
  | "json"
  | "full-json";

export type ExportFormatMeta = {
  id: ExportFormat;
  label: string;
  description: string;
  extension: string;
  mimeType: string;
};

export const EXPORT_FORMATS: ExportFormatMeta[] = [
  {
    id: "text",
    label: "Plain text",
    description: "One card per line — works with most tools",
    extension: "txt",
    mimeType: "text/plain",
  },
  {
    id: "mtga",
    label: "MTG Arena",
    description: "Paste directly into Arena's deck importer",
    extension: "txt",
    mimeType: "text/plain",
  },
  {
    id: "mtgo",
    label: "Magic Online (.dek)",
    description: "XML deck file for MTGO",
    extension: "dek",
    mimeType: "application/xml",
  },
  {
    id: "mws",
    label: "Magic Workstation (.mwDeck)",
    description: "Classic MWS format with set codes",
    extension: "mwDeck",
    mimeType: "text/plain",
  },
  {
    id: "csv",
    label: "CSV",
    description: "Spreadsheet-friendly columns",
    extension: "csv",
    mimeType: "text/csv",
  },
  {
    id: "json",
    label: "JSON",
    description: "Deck metadata with compact card snapshots",
    extension: "json",
    mimeType: "application/json",
  },
  {
    id: "full-json",
    label: "Full card JSON",
    description: "Each entry includes number plus full Scryfall card data",
    extension: "full.json",
    mimeType: "application/json",
  },
];

function sortedEntries(entries: DeckEntry[]): DeckEntry[] {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name));
}

function toQuantityNameLines(entries: DeckEntry[]): string {
  return sortedEntries(entries)
    .map((e) => `${e.quantity} ${e.name}`)
    .join("\n");
}

function toTextLines(deck: Deck): string {
  const sections = [toQuantityNameLines(deck.entries)];
  if (deck.sideboard.length > 0) {
    sections.push("Sideboard", toQuantityNameLines(deck.sideboard));
  }
  if (deck.maybeboard.length > 0) {
    sections.push("Maybeboard", toQuantityNameLines(deck.maybeboard));
  }
  return sections
    .filter(Boolean)
    .join("\n");
}

function toMtgaBody(entries: DeckEntry[]): string {
  return sortedEntries(entries)
    .map((e) => {
      const set = e.set?.toUpperCase();
      if (set && e.collectorNumber) {
        return `${e.quantity} ${e.name} (${set}) ${e.collectorNumber}`;
      }
      return `${e.quantity} ${e.name}`;
    })
    .join("\n");
}

function toMtgaLines(deck: Deck): string {
  const body = [`Deck`, toMtgaBody(deck.entries)];
  if (deck.sideboard.length > 0) {
    body.push(`Sideboard`, toMtgaBody(deck.sideboard));
  }
  if (deck.maybeboard.length > 0) {
    body.push(`Maybeboard`, toMtgaBody(deck.maybeboard));
  }
  return body.filter(Boolean).join("\n");
}

function toMwsSection(entries: DeckEntry[]): string {
  return sortedEntries(entries)
    .map((e) => {
      const set = e.set ? e.set.toUpperCase() : "   ";
      return `    ${e.quantity} [${set}] ${e.name}`;
    })
    .join("\n");
}

function toMwsLines(deck: Deck): string {
  const sections = [toMwsSection(deck.entries)];
  if (deck.sideboard.length > 0) {
    sections.push("Sideboard", toMwsSection(deck.sideboard));
  }
  if (deck.maybeboard.length > 0) {
    sections.push("Maybeboard", toMwsSection(deck.maybeboard));
  }
  return sections
    .filter(Boolean)
    .join("\n");
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toMtgoDek(deck: Deck): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Deck>",
    `  <NetDeckID>0</NetDeckID>`,
    `  <PreconstructedDeckID>0</PreconstructedDeckID>`,
  ];
  for (const e of sortedEntries(deck.entries)) {
    lines.push(
      `  <Cards CatID="0" Quantity="${e.quantity}" Sideboard="false" Name="${xmlEscape(e.name)}" />`
    );
  }
  for (const e of sortedEntries(deck.sideboard)) {
    lines.push(
      `  <Cards CatID="0" Quantity="${e.quantity}" Sideboard="true" Name="${xmlEscape(e.name)}" />`
    );
  }
  for (const e of sortedEntries(deck.maybeboard)) {
    lines.push(
      `  <!-- Maybeboard: ${e.quantity} ${xmlEscape(e.name)} -->`
    );
  }
  lines.push("</Deck>");
  return lines.join("\n");
}

function toCsv(deck: Deck): string {
  const esc = (v: string | number | undefined) => {
    const s = v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = "Board,Quantity,Name,Set,CollectorNumber,ManaCost,Type";
  const rowFor = (board: string, e: DeckEntry) =>
    [
      board,
      e.quantity,
      esc(e.name),
      esc(e.set?.toUpperCase()),
      esc(e.collectorNumber),
      esc(e.manaCost),
      esc(e.typeLine),
    ].join(",");
  const rows = [
    ...sortedEntries(deck.entries).map((entry) => rowFor("Main", entry)),
    ...sortedEntries(deck.sideboard).map((entry) =>
      rowFor("Sideboard", entry)
    ),
    ...sortedEntries(deck.maybeboard).map((entry) =>
      rowFor("Maybeboard", entry)
    ),
  ];
  return [header, ...rows].join("\n");
}

function compactEntry(entry: DeckEntry) {
  return {
    name: entry.name,
    quantity: entry.quantity,
    isCommander: entry.isCommander === true,
    set: entry.set,
    collectorNumber: entry.collectorNumber,
    manaCost: entry.manaCost,
    cmc: entry.cmc,
    typeLine: entry.typeLine,
    colors: entry.colors,
    rarity: entry.rarity,
  };
}

async function entriesWithFullCards(entries: DeckEntry[]) {
  const sorted = sortedEntries(entries);
  if (sorted.length === 0) return [];
  const cards = await getCardsByIdentifiers(
    sorted.map((entry) => ({ id: entry.cardId }))
  );
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const missing = sorted.filter((entry) => !cardsById.has(entry.cardId));

  if (missing.length > 0) {
    const names = missing
      .slice(0, 3)
      .map((entry) => entry.name)
      .join(", ");
    throw new Error(
      [
        `Could not fetch full card data for ${names}`,
        missing.length > 3 ? ", ..." : "",
      ].join("")
    );
  }

  return sorted.map((entry) => ({
    number: entry.quantity,
    isCommander: entry.isCommander === true,
    card: cardsById.get(entry.cardId)!,
  }));
}

async function toFullCardJson(deck: Deck): Promise<string> {
  const [entries, sideboard, maybeboard] = await Promise.all([
    entriesWithFullCards(deck.entries),
    entriesWithFullCards(deck.sideboard),
    entriesWithFullCards(deck.maybeboard),
  ]);

  return JSON.stringify(
    {
      name: deck.name,
      format: deck.format,
      cardCount: deck.cardCount,
      sideboardCount: deck.sideboardCount,
      maybeboardCount: deck.maybeboardCount,
      createdAt: deck.createdAt,
      updatedAt: deck.updatedAt,
      entries,
      sideboard,
      maybeboard,
    },
    null,
    2
  );
}

export function serializeDeck(deck: Deck, format: ExportFormat): string {
  switch (format) {
    case "text":
      return toTextLines(deck);
    case "mtga":
      return toMtgaLines(deck);
    case "mtgo":
      return toMtgoDek(deck);
    case "mws":
      return toMwsLines(deck);
    case "csv":
      return toCsv(deck);
    case "json":
      return JSON.stringify(
        {
          name: deck.name,
          format: deck.format,
          cardCount: deck.cardCount,
          sideboardCount: deck.sideboardCount,
          maybeboardCount: deck.maybeboardCount,
          createdAt: deck.createdAt,
          updatedAt: deck.updatedAt,
          entries: deck.entries.map(compactEntry),
          sideboard: deck.sideboard.map(compactEntry),
          maybeboard: deck.maybeboard.map(compactEntry),
        },
        null,
        2
      );
    case "full-json":
      throw new Error(
        "Full card JSON export must be serialized asynchronously"
      );
  }
}

export async function serializeDeckForExport(
  deck: Deck,
  format: ExportFormat
): Promise<string> {
  if (format === "full-json") return toFullCardJson(deck);
  return serializeDeck(deck, format);
}

export function filenameFor(deck: Deck, format: ExportFormat): string {
  const meta = EXPORT_FORMATS.find((f) => f.id === format)!;
  const safeName =
    deck.name.trim().replace(/[^a-z0-9-_ ]/gi, "").replace(/\s+/g, "_") ||
    "deck";
  return `${safeName}.${meta.extension}`;
}

export async function downloadDeck(
  deck: Deck,
  format: ExportFormat
): Promise<void> {
  const meta = EXPORT_FORMATS.find((f) => f.id === format)!;
  const content = await serializeDeckForExport(deck, format);
  const blob = new Blob([content], { type: `${meta.mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filenameFor(deck, format);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
