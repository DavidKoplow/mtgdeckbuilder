import type { CSSProperties, ReactNode } from "react";

type ResponsivePaneProps = {
  /** When true, pane is shown below the lg breakpoint. Ignored at lg+. */
  mobileActive: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  tourId?: string;
};

/**
 * Pane visible on desktop (lg+) always; on smaller viewports only when
 * `mobileActive` is true. Pass layout utilities via className.
 */
export function ResponsivePane({
  mobileActive,
  children,
  className = "",
  style,
  tourId,
}: ResponsivePaneProps) {
  return (
    <section
      data-tour={tourId}
      className={`${mobileActive ? "flex" : "hidden"} lg:flex ${className}`.trim()}
      style={style}
    >
      {children}
    </section>
  );
}
