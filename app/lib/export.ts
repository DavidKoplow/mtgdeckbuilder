import type { Deck, DeckEntry } from "./types";

export type ExportFormat = "text" | "mtga" | "mtgo" | "mws" | "csv" | "json";

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
    description: "Full structured deck data",
    extension: "json",
    mimeType: "application/json",
  },
];

function sortedEntries(entries: DeckEntry[]): DeckEntry[] {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name));
}

function toTextLines(entries: DeckEntry[]): string {
  return sortedEntries(entries)
    .map((e) => `${e.quantity} ${e.name}`)
    .join("\n");
}

function toMtgaLines(entries: DeckEntry[]): string {
  const body = sortedEntries(entries)
    .map((e) => {
      const set = e.set?.toUpperCase();
      if (set && e.collectorNumber) {
        return `${e.quantity} ${e.name} (${set}) ${e.collectorNumber}`;
      }
      return `${e.quantity} ${e.name}`;
    })
    .join("\n");
  return `Deck\n${body}`;
}

function toMwsLines(entries: DeckEntry[]): string {
  return sortedEntries(entries)
    .map((e) => {
      const set = e.set ? e.set.toUpperCase() : "   ";
      return `    ${e.quantity} [${set}] ${e.name}`;
    })
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
  lines.push("</Deck>");
  return lines.join("\n");
}

function toCsv(entries: DeckEntry[]): string {
  const esc = (v: string | number | undefined) => {
    const s = v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = "Quantity,Name,Set,CollectorNumber,ManaCost,Type";
  const rows = sortedEntries(entries).map((e) =>
    [
      e.quantity,
      esc(e.name),
      esc(e.set?.toUpperCase()),
      esc(e.collectorNumber),
      esc(e.manaCost),
      esc(e.typeLine),
    ].join(",")
  );
  return [header, ...rows].join("\n");
}

export function serializeDeck(deck: Deck, format: ExportFormat): string {
  switch (format) {
    case "text":
      return toTextLines(deck.entries);
    case "mtga":
      return toMtgaLines(deck.entries);
    case "mtgo":
      return toMtgoDek(deck);
    case "mws":
      return toMwsLines(deck.entries);
    case "csv":
      return toCsv(deck.entries);
    case "json":
      return JSON.stringify(
        {
          name: deck.name,
          format: deck.format,
          createdAt: deck.createdAt,
          updatedAt: deck.updatedAt,
          entries: deck.entries.map((e) => ({
            name: e.name,
            quantity: e.quantity,
            set: e.set,
            collectorNumber: e.collectorNumber,
            manaCost: e.manaCost,
            cmc: e.cmc,
            typeLine: e.typeLine,
            colors: e.colors,
          })),
        },
        null,
        2
      );
  }
}

export function filenameFor(deck: Deck, format: ExportFormat): string {
  const meta = EXPORT_FORMATS.find((f) => f.id === format)!;
  const safeName =
    deck.name.trim().replace(/[^a-z0-9-_ ]/gi, "").replace(/\s+/g, "_") ||
    "deck";
  return `${safeName}.${meta.extension}`;
}

export function downloadDeck(deck: Deck, format: ExportFormat): void {
  const meta = EXPORT_FORMATS.find((f) => f.id === format)!;
  const content = serializeDeck(deck, format);
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
