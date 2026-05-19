/** Tailwind-aligned breakpoints — single source of truth for JS and CSS. */
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

export function mediaQueryUp(breakpoint: Breakpoint): string {
  return `(min-width: ${BREAKPOINTS[breakpoint]}px)`;
}

export function mediaQueryDown(breakpoint: Breakpoint): string {
  return `(max-width: ${BREAKPOINTS[breakpoint] - 1}px)`;
}

/** Primary workspace layout switches at lg (side-by-side vs tabbed mobile). */
export const WORKSPACE_DESKTOP_QUERY = mediaQueryUp("lg");

/** Header uses full inline layout from lg upward. */
export const HEADER_INLINE_QUERY = mediaQueryUp("lg");

/** Fine pointer — enable hover previews. */
export const FINE_POINTER_QUERY = "(pointer: fine)";
