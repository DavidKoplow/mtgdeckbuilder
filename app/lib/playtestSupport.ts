import { WORKSPACE_DESKTOP_QUERY } from "./breakpoints";
import {
  SAVED_DECK_QUERY_PARAM,
  builderDeckHref,
} from "./builderNavigation";

export const PLAYTEST_MOBILE_WARNING =
  "Playtest is not available on mobile yet. Use a desktop-sized screen to playtest decks.";
export const PLAYTEST_MOBILE_WARNING_QUERY_PARAM = "playtestMobileWarning";
export const PLAYTEST_MOBILE_WARNING_REDIRECT = `/builder/?${PLAYTEST_MOBILE_WARNING_QUERY_PARAM}=1`;

export function playtestMobileWarningRedirect(deckId?: string | null): string {
  const trimmedDeckId = deckId?.trim();
  if (!trimmedDeckId) return PLAYTEST_MOBILE_WARNING_REDIRECT;

  const href = new URL(builderDeckHref(trimmedDeckId), "http://localhost");
  href.searchParams.set(PLAYTEST_MOBILE_WARNING_QUERY_PARAM, "1");
  return `${href.pathname}${href.search}`;
}

export function readPlaytestDeckIdFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get(SAVED_DECK_QUERY_PARAM);
  return value?.trim() || null;
}

export function isPlaytestSupportedViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }

  return window.matchMedia(WORKSPACE_DESKTOP_QUERY).matches;
}
