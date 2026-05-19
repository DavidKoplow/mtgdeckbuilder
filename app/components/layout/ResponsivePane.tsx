import type { CSSProperties, ReactNode } from "react";

type ResponsivePaneProps = {
  /** When true, pane is shown below the lg breakpoint. Ignored at lg+. */
  mobileActive: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
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
}: ResponsivePaneProps) {
  return (
    <section
      className={`${mobileActive ? "flex" : "hidden"} lg:flex ${className}`.trim()}
      style={style}
    >
      {children}
    </section>
  );
}
