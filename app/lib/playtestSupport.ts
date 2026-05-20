import { WORKSPACE_DESKTOP_QUERY } from "./breakpoints";

export const PLAYTEST_MOBILE_WARNING =
  "Playtest is not available on mobile yet. Use a desktop-sized screen to playtest decks.";
export const PLAYTEST_MOBILE_WARNING_QUERY_PARAM = "playtestMobileWarning";
export const PLAYTEST_MOBILE_WARNING_REDIRECT = `/builder/?${PLAYTEST_MOBILE_WARNING_QUERY_PARAM}=1`;

export function isPlaytestSupportedViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true;
  }

  return window.matchMedia(WORKSPACE_DESKTOP_QUERY).matches;
}
