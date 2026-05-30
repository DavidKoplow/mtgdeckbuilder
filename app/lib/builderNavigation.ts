export const OPEN_DECK_SELECTOR_QUERY_PARAM = "deckSelector";
export const OPEN_DECK_SELECTOR_HREF = `/builder/?${OPEN_DECK_SELECTOR_QUERY_PARAM}=1`;
export const SAVED_DECK_QUERY_PARAM = "deck";
export const PUBLIC_DECK_QUERY_PARAM = "publicDeck";
const TEMPORARY_PUBLIC_DECK_PREFIX = "public:";

export function publicIdFromTemporaryDeckId(deckId: string): string | null {
  if (!deckId.startsWith(TEMPORARY_PUBLIC_DECK_PREFIX)) return null;
  const publicId = deckId.slice(TEMPORARY_PUBLIC_DECK_PREFIX.length);
  return publicId.length > 0 ? publicId : null;
}

export function builderDeckHref(deckId: string): string {
  const publicId = publicIdFromTemporaryDeckId(deckId);
  if (publicId) {
    return `/builder/?${PUBLIC_DECK_QUERY_PARAM}=${encodeURIComponent(publicId)}`;
  }
  return `/builder/?${SAVED_DECK_QUERY_PARAM}=${encodeURIComponent(deckId)}`;
}
