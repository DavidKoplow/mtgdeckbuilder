"use client";

export type MobileWorkspacePane = "search" | "deck";

type MobileWorkspaceTabsProps = {
  active: MobileWorkspacePane;
  deckCount: number;
  onChange: (pane: MobileWorkspacePane) => void;
  placement?: "fixed" | "panel" | "menu";
  className?: string;
};

export function MobileWorkspaceTabs({
  active,
  deckCount,
  onChange,
  placement = "fixed",
  className,
}: MobileWorkspaceTabsProps) {
  const placementClass =
    placement === "panel"
      ? "mobile-bottom-nav mobile-bottom-nav-panel shrink-0 border-t border-border bg-white/94 px-3 pt-2 backdrop-blur-md lg:hidden"
      : placement === "menu"
        ? "w-full"
      : "mobile-bottom-nav fixed inset-x-0 bottom-0 z-[70] border-t border-border bg-white/94 px-3 pt-2 backdrop-blur-md lg:hidden";
  const navStyle =
    placement === "fixed" || placement === "panel"
      ? { paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }
      : undefined;

  return (
    <nav
      className={`${placementClass}${className ? ` ${className}` : ""}`}
      aria-label="Workspace panel"
      style={navStyle}
    >
      <div className="segmented-control grid grid-cols-2 gap-1 rounded-xl p-1">
        <WorkspaceTab
          pane="search"
          active={active}
          label="Search"
          onChange={onChange}
        />
        <WorkspaceTab
          pane="deck"
          active={active}
          label="Deck"
          badge={deckCount > 0 ? String(deckCount) : undefined}
          onChange={onChange}
        />
      </div>
    </nav>
  );
}

function WorkspaceTab({
  pane,
  active,
  label,
  badge,
  onChange,
}: {
  pane: MobileWorkspacePane;
  active: MobileWorkspacePane;
  label: string;
  badge?: string;
  onChange: (pane: MobileWorkspacePane) => void;
}) {
  const selected = active === pane;
  return (
    <button
      type="button"
      onClick={() => onChange(pane)}
      aria-pressed={selected}
      className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition ${
        selected
          ? "selected-segment text-text"
          : "text-text-muted hover:text-text"
      }`}
    >
      {pane === "search" ? <SearchIcon /> : <DeckIcon />}
      <span>{label}</span>
      {badge ? (
        <span
          className={`min-w-[1.25rem] rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold tabular-nums leading-none ${
            selected
              ? "bg-accent text-white"
              : "bg-surface-subtle text-text-muted"
          }`}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13.5 13.5L17 17" />
    </svg>
  );
}

function DeckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="3" width="12" height="14" rx="1.5" />
      <path d="M7 7h6M7 10h6M7 13h4" />
    </svg>
  );
}
