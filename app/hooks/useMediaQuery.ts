"use client";

import { useEffect, useState } from "react";
import {
  FINE_POINTER_QUERY,
  HEADER_INLINE_QUERY,
  WORKSPACE_DESKTOP_QUERY,
} from "../lib/breakpoints";

function subscribe(query: string, onChange: (matches: boolean) => void) {
  const mq = window.matchMedia(query);
  onChange(mq.matches);
  const handler = (event: MediaQueryListEvent) => onChange(event.matches);
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => subscribe(query, setMatches), [query]);

  return matches;
}

export function useIsWorkspaceDesktop(): boolean {
  return useMediaQuery(WORKSPACE_DESKTOP_QUERY);
}

export function useIsHeaderInline(): boolean {
  return useMediaQuery(HEADER_INLINE_QUERY);
}

export function useFinePointer(): boolean {
  return useMediaQuery(FINE_POINTER_QUERY);
}
