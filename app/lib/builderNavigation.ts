export const OPEN_DECK_SELECTOR_QUERY_PARAM = "deckSelector";
export const OPEN_DECK_SELECTOR_HREF = `/builder/?${OPEN_DECK_SELECTOR_QUERY_PARAM}=1`;
export const SAVED_DECK_QUERY_PARAM = "deck";

export function builderDeckHref(deckId: string): string {
  return `/builder/?${SAVED_DECK_QUERY_PARAM}=${encodeURIComponent(deckId)}`;
}
