"use client";

export type MobilePlaytestPane = "battlefield" | "hand" | "zones";

type MobilePlaytestTabsProps = {
  active: MobilePlaytestPane;
  handCount: number;
  battlefieldCount: number;
  onChange: (pane: MobilePlaytestPane) => void;
};

export function MobilePlaytestTabs({
  active,
  handCount,
  battlefieldCount,
  onChange,
}: MobilePlaytestTabsProps) {
  return (
    <nav
      className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-[70] border-t border-border bg-white/94 px-3 pt-2 backdrop-blur-md lg:hidden"
      aria-label="Playtest panel"
      style={{
        paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="segmented-control grid grid-cols-3 gap-1 rounded-xl p-1">
        <PlaytestTab
          pane="battlefield"
          active={active}
          label="Board"
          badge={
            battlefieldCount > 0 ? String(battlefieldCount) : undefined
          }
          onChange={onChange}
        />
        <PlaytestTab
          pane="hand"
          active={active}
          label="Hand"
          badge={handCount > 0 ? String(handCount) : undefined}
          onChange={onChange}
        />
        <PlaytestTab
          pane="zones"
          active={active}
          label="Zones"
          onChange={onChange}
        />
      </div>
    </nav>
  );
}

function PlaytestTab({
  pane,
  active,
  label,
  badge,
  onChange,
}: {
  pane: MobilePlaytestPane;
  active: MobilePlaytestPane;
  label: string;
  badge?: string;
  onChange: (pane: MobilePlaytestPane) => void;
}) {
  const selected = active === pane;
  return (
    <button
      type="button"
      onClick={() => onChange(pane)}
      aria-pressed={selected}
      className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold transition ${
        selected
          ? "selected-segment text-text"
          : "text-text-muted hover:text-text"
      }`}
    >
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
