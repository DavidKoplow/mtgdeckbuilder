#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const INPUT = "data/local_card_index.json";
const OUTPUT = "public/card-filter-index.json";

const cardsByOracleId = JSON.parse(await readFile(INPUT, "utf8"));
const rows = Object.values(cardsByOracleId).map((card) => [
  card.oracle_id,
  lower(card.name),
  lower(fullOracleText(card)),
  lower(fullTypeLine(card)),
  key(card.colors),
  key(card.color_identity),
  lower(card.rarity),
  lower(card.set),
  pipeList(card.printings),
  numberOrNull(card.cmc),
  card.power ?? "",
  card.toughness ?? "",
  pipeList(
    Object.entries(card.legalities ?? {})
      .filter(([, status]) => lower(status) === "legal")
      .map(([format]) => format)
  ),
  numberOrNull(card.prices?.usd),
]);

await writeFile(OUTPUT, `${JSON.stringify(rows)}\n`, "utf8");
console.log(`wrote ${rows.length} filter index rows to ${OUTPUT}`);

function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function fullOracleText(card) {
  if (typeof card.oracle_text === "string") return card.oracle_text;
  return (card.card_faces ?? [])
    .map((face) => face.oracle_text)
    .filter(Boolean)
    .join("\n");
}

function fullTypeLine(card) {
  const parts = [card.type_line];
  parts.push(...(card.card_faces ?? []).map((face) => face.type_line));
  return parts.filter(Boolean).join(" ");
}

function key(value) {
  return Array.isArray(value) ? value.join("") : "";
}

function pipeList(value) {
  return Array.isArray(value)
    ? `|${value.map((item) => lower(item)).filter(Boolean).join("|")}|`
    : "";
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
