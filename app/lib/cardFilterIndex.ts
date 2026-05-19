"use client";

import type { AdvancedFilters } from "./scryfall";

type FilterIndexRow = [
  oracleId: string,
  nameLower: string,
  oracleTextLower: string,
  typeLineLower: string,
  colorsKey: string,
  colorIdentityKey: string,
  rarity: string,
  set: string,
  printings: string,
  cmc: number | null,
  power: string,
  toughness: string,
  legalFormats: string,
  usd: number | null,
];

const BASE_PATH = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH ?? "");
const FILTER_INDEX_URL = `${BASE_PATH}/card-filter-index.json`;

let filterIndexPromise: Promise<FilterIndexRow[]> | null = null;

export async function getHybridCandidateOracleIds(
  filters: AdvancedFilters,
  signal?: AbortSignal
): Promise<string[]> {
  const rows = await loadFilterIndex(signal);
  const oracleIds: string[] = [];

  for (const row of rows) {
    if (signal?.aborted) break;
    if (matchesFilterIndexRow(row, filters)) oracleIds.push(row[0]);
  }

  return oracleIds;
}

async function loadFilterIndex(signal?: AbortSignal): Promise<FilterIndexRow[]> {
  if (!filterIndexPromise) {
    filterIndexPromise = fetch(FILTER_INDEX_URL, {
      cache: "force-cache",
      signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Card filter index failed ${response.status}`);
        }
        return response.json() as Promise<FilterIndexRow[]>;
      })
      .catch((error) => {
        filterIndexPromise = null;
        throw error;
      });
  }
  return filterIndexPromise;
}

function matchesFilterIndexRow(
  row: FilterIndexRow,
  filters: AdvancedFilters
): boolean {
  const text = filters.text?.trim().toLowerCase();
  if (text && !`${row[1]} ${row[2]} ${row[3]}`.includes(text)) return false;

  const name = filters.name?.trim().toLowerCase();
  if (name && !row[1].includes(name)) return false;

  const oracle = filters.oracle?.trim().toLowerCase();
  if (oracle && !row[2].includes(oracle)) return false;

  const excludeTerms = (filters.excludeOracle ?? "")
    .split(",")
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  if (excludeTerms.some((term) => row[2].includes(term))) return false;

  const type = filters.type?.trim().toLowerCase();
  if (type && !row[3].includes(type)) return false;

  if (filters.colors?.length && !matchesColors(row, filters)) return false;

  if (filters.rarity?.length && !filters.rarity.includes(row[6])) return false;

  const set = filters.set?.trim().toLowerCase();
  if (set && row[7] !== set && !row[8].includes(`|${set}|`)) return false;

  const cmc = row[9] ?? 0;
  if (typeof filters.cmcMin === "number" && cmc < filters.cmcMin) return false;
  if (typeof filters.cmcMax === "number" && cmc > filters.cmcMax) return false;

  if (filters.power?.trim() && !matchesNumericExpression(row[10], filters.power)) {
    return false;
  }
  if (
    filters.toughness?.trim() &&
    !matchesNumericExpression(row[11], filters.toughness)
  ) {
    return false;
  }

  const format = filters.format?.trim().toLowerCase();
  if (format && !row[12].includes(`|${format}|`)) return false;

  const usd = row[13];
  if (typeof filters.usdMin === "number" && !(usd != null && usd >= filters.usdMin)) {
    return false;
  }
  if (typeof filters.usdMax === "number" && !(usd != null && usd <= filters.usdMax)) {
    return false;
  }

  return true;
}

function matchesColors(row: FilterIndexRow, filters: AdvancedFilters): boolean {
  const selected = new Set(filters.colors ?? []);
  const values = filters.colorMode === "identity" ? row[5] : row[4] || row[5];
  const cardSet = new Set(values.split("").filter(Boolean));

  if (filters.colorMode === "exact") {
    return selected.size === cardSet.size && [...selected].every((c) => cardSet.has(c));
  }
  if (filters.colorMode === "including") {
    return [...selected].every((c) => cardSet.has(c));
  }
  return [...cardSet].every((c) => selected.has(c));
}

function matchesNumericExpression(value: string, raw: string): boolean {
  const number = Number(value);
  if (!Number.isFinite(number)) return false;
  const match = /^(<=|>=|<|>|=)?\s*(-?\d+(?:\.\d+)?)$/.exec(raw.trim());
  if (!match) return false;
  const operator = match[1] ?? "=";
  const expected = Number(match[2]);
  if (operator === "<") return number < expected;
  if (operator === "<=") return number <= expected;
  if (operator === ">") return number > expected;
  if (operator === ">=") return number >= expected;
  return number === expected;
}

function normalizeBasePath(basePath: string): string {
  if (!basePath || basePath === "/") return "";
  return basePath.startsWith("/")
    ? basePath.replace(/\/$/, "")
    : `/${basePath.replace(/\/$/, "")}`;
}
