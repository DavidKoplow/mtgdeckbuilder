import type { ScryfallCard } from "./types";

export function oracleIdForCard(card: ScryfallCard): string | undefined {
  if (card.oracle_id) return card.oracle_id;
  if (card.id.startsWith("oracle:")) return card.id.slice("oracle:".length);
  return undefined;
}
