#!/usr/bin/env node

import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const DEFAULT_DECK_LIST_URL = "https://mtgjson.com/api/v5/DeckList.json";
const DEFAULT_DECKS_BASE_URL = "https://mtgjson.com/api/v5/decks";
const DEFAULT_AUTHOR = "Wizards of the Coast";
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_CONCURRENCY = 4;
const importOfficialDeckBatch = makeFunctionReference(
  "decks:importOfficialDeckBatch"
);
const deleteStaleOfficialDecks = makeFunctionReference(
  "decks:deleteStaleOfficialDecks"
);

const args = parseArgs(process.argv.slice(2));
const deckListUrl = args["deck-list-url"] ?? DEFAULT_DECK_LIST_URL;
const decksBaseUrl = stripTrailingSlash(
  args["decks-base-url"] ?? DEFAULT_DECKS_BASE_URL
);
const convexUrl =
  args["convex-url"] ??
  process.env.NEXT_PUBLIC_CONVEX_URL ??
  process.env.CONVEX_URL ??
  process.env.CONVEX_CLOUD_URL;
const importToken = args.token ?? process.env.MTGJSON_IMPORT_TOKEN;
const batchSize = positiveInteger(args["batch-size"], DEFAULT_BATCH_SIZE);
const concurrency = positiveInteger(args.concurrency, DEFAULT_CONCURRENCY);
const limit = optionalNonNegativeInteger(args.limit);
const offset = optionalNonNegativeInteger(args.offset) ?? 0;
const includeTypes = stringSet(args.type);
const excludeTypes = stringSet(args["exclude-type"]);
const includeFileNames = stringSet(args["file-name"]);
const dryRun = booleanFlag(args["dry-run"]);
const skipStaleDelete = booleanFlag(args["skip-stale-delete"]);
const authorName = args.author ?? DEFAULT_AUTHOR;

if (!dryRun && !convexUrl) {
  throw new Error(
    "Set NEXT_PUBLIC_CONVEX_URL, CONVEX_URL, or pass --convex-url."
  );
}
if (!dryRun && !importToken) {
  throw new Error("Set MTGJSON_IMPORT_TOKEN or pass --token.");
}

const client = dryRun ? null : new ConvexHttpClient(convexUrl);
const deckList = await fetchJson(deckListUrl);
const allDecks = Array.isArray(deckList.data) ? deckList.data : [];
const selectedDecks = allDecks
  .filter((deck) => deck && typeof deck.fileName === "string")
  .filter((deck) => includeTypes.size === 0 || includeTypes.has(deck.type))
  .filter((deck) => !excludeTypes.has(deck.type))
  .filter(
    (deck) => includeFileNames.size === 0 || includeFileNames.has(deck.fileName)
  )
  .slice(offset, limit === undefined ? undefined : offset + limit);
const sourceUpdatedAt = timestampFromIsoDate(deckList.meta?.date) ?? Date.now();
const sourceVersion =
  typeof deckList.meta?.version === "string" ? deckList.meta.version : undefined;

console.log(
  `${dryRun ? "checking" : "importing"} ${selectedDecks.length} MTGJSON deck${selectedDecks.length === 1 ? "" : "s"}`
);

let fetched = 0;
let skipped = 0;
const convertedDecks = await mapLimit(selectedDecks, concurrency, async (deck) => {
  try {
    const deckJson = await fetchJson(`${decksBaseUrl}/${deck.fileName}.json`);
    fetched += 1;
    if (fetched % 25 === 0 || fetched === selectedDecks.length) {
      console.log(`downloaded ${fetched}/${selectedDecks.length}`);
    }
    return convertDeck(deck, deckJson.data, {
      authorName,
      sourceUpdatedAt,
      sourceVersion,
    });
  } catch (error) {
    skipped += 1;
    console.warn(`skipped ${deck.fileName}: ${error.message}`);
    return null;
  }
});

const importableDecks = convertedDecks.filter((deck) => deck !== null);

if (dryRun) {
  const cards = importableDecks.reduce((sum, deck) => sum + deck.entries.length, 0);
  const sideboardCards = importableDecks.reduce(
    (sum, deck) => sum + deck.sideboard.length,
    0
  );
  console.log(
    `dry run complete: ${importableDecks.length} decks, ${cards} main rows, ${sideboardCards} sideboard rows, ${skipped} skipped`
  );
  process.exit(0);
}

let imported = 0;
let importedCards = 0;
let importedSideboardCards = 0;

for (const batch of chunks(importableDecks, batchSize)) {
  const result = await client.mutation(importOfficialDeckBatch, {
    importToken,
    decks: batch,
  });
  imported += result.imported;
  importedCards += result.cards;
  importedSideboardCards += result.sideboardCards;
  console.log(`imported ${imported}/${importableDecks.length}`);
}

let deleted = 0;
if (!skipStaleDelete && includeTypes.size === 0 && includeFileNames.size === 0) {
  const result = await client.mutation(deleteStaleOfficialDecks, {
    importToken,
    activeFileNames: selectedDecks.map((deck) => deck.fileName),
  });
  deleted = result.deleted;
}

console.log(
  `done: imported ${imported} decks (${importedCards} main cards, ${importedSideboardCards} sideboard cards), deleted ${deleted} stale official decks, skipped ${skipped}`
);

function convertDeck(summary, deck, source) {
  if (!deck || typeof deck !== "object") {
    throw new Error("deck payload is missing data");
  }

  const commanders = toDeckEntries(cardRows(deck.commander), true, summary.fileName);
  const commanderIds = commanders.map((entry) => entry.cardId);
  const entries = [
    ...commanders,
    ...toDeckEntries(cardRows(deck.mainBoard), false, summary.fileName),
  ];
  const sideboard = toDeckEntries(cardRows(deck.sideBoard), false, summary.fileName);

  if (entries.length === 0 && sideboard.length === 0) {
    throw new Error("deck has no importable Scryfall card ids");
  }

  return {
    fileName: summary.fileName,
    name: stringValue(deck.name) ?? stringValue(summary.name) ?? summary.fileName,
    format: inferFormat(deck, summary),
    authorName: source.authorName,
    sourceUrl: stringValue(deck.source) ?? stringValue(summary.source),
    sourceDeckCode:
      stringValue(deck.code) ?? stringValue(summary.code) ?? "UNKNOWN",
    sourceDeckType:
      stringValue(deck.type) ?? stringValue(summary.type) ?? "Official Deck",
    sourceReleaseDate:
      stringValue(deck.releaseDate) ?? stringValue(summary.releaseDate),
    sourceUpdatedAt: source.sourceUpdatedAt,
    sourceVersion: source.sourceVersion,
    sealedProductUuids: Array.isArray(deck.sealedProductUuids)
      ? deck.sealedProductUuids.filter((value) => typeof value === "string")
      : undefined,
    entries,
    sideboard,
    commanders: commanderIds,
  };
}

function toDeckEntries(cards, isCommander, fileName) {
  const entries = [];
  for (const card of cards) {
    try {
      entries.push(toDeckEntry(card, isCommander));
    } catch (error) {
      console.warn(`skipped card in ${fileName}: ${error.message}`);
    }
  }
  return entries;
}

function toDeckEntry(card, isCommander = false) {
  const scryfallId = card?.identifiers?.scryfallId;
  if (typeof scryfallId !== "string" || scryfallId.length === 0) {
    throw new Error(`${card?.name ?? "unknown card"} has no Scryfall id`);
  }

  const entry = {
    cardId: scryfallId,
    name: stringValue(card.name) ?? "Unknown Card",
    quantity: positiveInteger(card.count, 1),
    imageSmall: scryfallImageUrl(scryfallId, "small"),
    imageNormal: scryfallImageUrl(scryfallId, "normal"),
    imageArtCrop: scryfallImageUrl(scryfallId, "art_crop"),
    manaCost: stringValue(card.manaCost),
    cmc: finiteNumber(card.manaValue ?? card.convertedManaCost),
    typeLine: stringValue(card.type),
    colors: stringArray(card.colors),
    rarity: stringValue(card.rarity),
    set: stringValue(card.setCode)?.toLowerCase(),
    collectorNumber: stringValue(card.number),
    legalities: normalizeLegalities(card.legalities),
  };

  if (isCommander) entry.isCommander = true;
  return cleanUndefined(entry);
}

function inferFormat(deck, summary) {
  const type = `${deck?.type ?? ""} ${summary?.type ?? ""}`.toLowerCase();
  if (cardRows(deck?.commander).length > 0 || type.includes("commander")) {
    return "commander";
  }
  if (type.includes("standard")) return "standard";
  if (type.includes("pioneer")) return "pioneer";
  if (type.includes("modern")) return "modern";
  if (type.includes("legacy")) return "legacy";
  if (type.includes("vintage")) return "vintage";
  if (type.includes("pauper")) return "pauper";
  return "casual";
}

function scryfallImageUrl(scryfallId, size) {
  const first = scryfallId[0];
  const second = scryfallId[1];
  return `https://cards.scryfall.io/${size}/front/${first}/${second}/${scryfallId}.jpg`;
}

function normalizeLegalities(legalities) {
  if (!legalities || typeof legalities !== "object") return undefined;
  const normalized = {};
  for (const [format, status] of Object.entries(legalities)) {
    if (typeof status !== "string") continue;
    normalized[format] = status.trim().toLowerCase().replace(/\s+/g, "_");
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function cardRows(value) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string")
    : undefined;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function cleanUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

async function fetchJson(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await delay(500 * attempt);
      }
    }
  }
  throw lastError;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = new Array(Math.min(limit, items.length))
    .fill(null)
    .map(async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    });
  await Promise.all(workers);
  return results;
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function timestampFromIsoDate(value) {
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    if (key === "dry-run" || key === "skip-stale-delete") {
      parsed[key] = "true";
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    if (parsed[key] === undefined) {
      parsed[key] = value;
    } else if (Array.isArray(parsed[key])) {
      parsed[key].push(value);
    } else {
      parsed[key] = [parsed[key], value];
    }
    index += 1;
  }
  return parsed;
}

function stringSet(value) {
  if (value === undefined) return new Set();
  const values = Array.isArray(value) ? value : [value];
  return new Set(values.flatMap((entry) => entry.split(",")).filter(Boolean));
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function optionalNonNegativeInteger(value) {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`Expected a non-negative integer, received ${value}`);
  }
  return number;
}

function booleanFlag(value) {
  return value === "true" || value === true;
}
