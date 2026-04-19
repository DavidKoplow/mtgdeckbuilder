"use client";

import { useEffect, useMemo, useState } from "react";
import type { Deck, DeckEntry } from "../lib/types";
import { ManaCost } from "./ManaCost";

type Props = {
  deck: Deck;
  onSetQty: (cardId: string, qty: number) => void;
  onHover: (
    payload: { src?: string; x: number; y: number } | null
  ) => void;
  onSelect: (cardId: string) => void;
};

type ViewMode = "grid" | "list";
const VIEW_KEY = "deckwright:deckview:v1";

const TYPE_ORDER = [
  "Creature",
  "Planeswalker",
  "Instant",
  "Sorcery",
  "Artifact",
  "Enchantment",
  "Battle",
  "Land",
  "Other",
];

function groupOf(entry: DeckEntry): string {
  const t = entry.typeLine ?? "";
  for (const g of TYPE_ORDER) if (t.includes(g)) return g;
  return "Other";
}

export function DeckPanel({
  deck,
  onSetQty,
  onHover,
  onSelect,
}: Props) {
  const [view, setView] = useState<ViewMode>("grid");

  useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_KEY);
    if (saved === "grid" || saved === "list") setView(saved);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(VIEW_KEY, view);
  }, [view]);

  const { groups, totalCount, curve, colorPips } = useMemo(() => {
    const groups = new Map<string, DeckEntry[]>();
    for (const e of deck.entries) {
      const g = groupOf(e);
      const arr = groups.get(g) ?? [];
      arr.push(e);
      groups.set(g, arr);
    }
    for (const arr of groups.values())
      arr.sort((a, b) => {
        const ca = a.cmc ?? 0;
        const cb = b.cmc ?? 0;
        if (ca !== cb) return ca - cb;
        return a.name.localeCompare(b.name);
      });

    const ordered = TYPE_ORDER.filter((t) => groups.has(t)).map(
      (t) => [t, groups.get(t)!] as const
    );

    const totalCount = deck.entries.reduce((n, e) => n + e.quantity, 0);

    const curveBuckets = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const e of deck.entries) {
      if ((e.typeLine ?? "").includes("Land")) continue;
      const cmc = Math.max(0, Math.round(e.cmc ?? 0));
      const idx = Math.min(7, cmc);
      curveBuckets[idx] += e.quantity;
    }

    const colorPips = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    for (const e of deck.entries) {
      const colors = e.colors ?? [];
      if (colors.length === 0) colorPips.C += e.quantity;
      for (const c of colors) {
        if (c in colorPips) colorPips[c as "W"] += e.quantity;
      }
    }

    return { groups: ordered, totalCount, curve: curveBuckets, colorPips };
  }, [deck.entries]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-4 border-b border-border bg-surface px-4 py-2 text-xs text-text-muted">
        <span className="font-medium text-text">{totalCount} cards</span>
        <ColorBar pips={colorPips} />
        <ManaCurve curve={curve} />
        <ViewToggle view={view} onChange={setView} />
      </div>

      <div className="thin-scroll flex-1 min-h-0 overflow-y-auto bg-surface">
        {deck.entries.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-text-subtle">
            Your deck is empty. Search on the left and hit + to add.
          </div>
        ) : (
          <div className={view === "grid" ? "space-y-4 p-4" : "space-y-4 py-2"}>
            {groups.map(([group, entries]) => (
              <section key={group}>
                <header
                  className={`mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted ${
                    view === "list" ? "px-4" : ""
                  }`}
                >
                  {group}
                </header>
                {view === "grid" ? (
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(calc(25%-0.5625rem),1fr))] gap-3">
                    {entries.map((e) => (
                      <DeckTile
                        key={e.cardId}
                        entry={e}
                        onSetQty={(q) => onSetQty(e.cardId, q)}
                        onHover={onHover}
                        onSelect={() => onSelect(e.cardId)}
                      />
                    ))}
                  </ul>
                ) : (
                  <ul className="divide-y divide-border border-y border-border">
                    {entries.map((e) => (
                      <DeckRow
                        key={e.cardId}
                        entry={e}
                        onSetQty={(q) => onSetQty(e.cardId, q)}
                        onHover={onHover}
                        onSelect={() => onSelect(e.cardId)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  return (
    <div className="ml-auto flex items-center rounded-md border border-border bg-white p-0.5">
      <button
        onClick={() => onChange("grid")}
        aria-pressed={view === "grid"}
        title="Grid view"
        className={`flex h-6 w-7 items-center justify-center rounded transition ${
          view === "grid"
            ? "bg-accent text-white"
            : "text-text-muted hover:text-text"
        }`}
      >
        <GridIcon />
      </button>
      <button
        onClick={() => onChange("list")}
        aria-pressed={view === "list"}
        title="List view"
        className={`flex h-6 w-7 items-center justify-center rounded transition ${
          view === "list"
            ? "bg-accent text-white"
            : "text-text-muted hover:text-text"
        }`}
      >
        <ListIcon />
      </button>
    </div>
  );
}

function DeckTile({
  entry,
  onSetQty,
  onHover,
  onSelect,
}: {
  entry: DeckEntry;
  onSetQty: (q: number) => void;
  onHover: (p: { src?: string; x: number; y: number } | null) => void;
  onSelect: () => void;
}) {
  return (
    <li
      className="group relative"
      onMouseEnter={(e) =>
        onHover({ src: entry.imageNormal, x: e.clientX, y: e.clientY })
      }
      onMouseMove={(e) =>
        onHover({ src: entry.imageNormal, x: e.clientX, y: e.clientY })
      }
      onMouseLeave={() => onHover(null)}
    >
      <div
        onClick={onSelect}
        className="relative cursor-pointer overflow-hidden rounded-[9px] ring-1 ring-black/10 transition group-hover:ring-accent"
      >
        {entry.imageNormal ? (
          <img
            src={entry.imageNormal}
            alt={entry.name}
            className="block aspect-[488/680] w-full object-cover"
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div className="flex aspect-[488/680] w-full items-center justify-center bg-surface-subtle px-2 text-center text-xs text-text-subtle">
            {entry.name}
          </div>
        )}

        {/* trash: remove all copies */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSetQty(0);
          }}
          aria-label={`Remove all ${entry.name}`}
          title="Remove all copies"
          className="absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-text-muted shadow ring-1 ring-black/10 transition hover:bg-white hover:text-[color:var(--danger)]"
        >
          <TrashIcon />
        </button>

        {/* quantity badge overlay */}
        <div className="pointer-events-none absolute right-1.5 top-1.5 flex h-7 min-w-7 items-center justify-center rounded-full bg-black/80 px-2 text-sm font-semibold text-white tabular-nums shadow">
          ×{entry.quantity}
        </div>

        {/* +/− controls */}
        <div className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSetQty(entry.quantity - 1);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-base font-semibold text-text shadow ring-1 ring-black/10 transition hover:bg-white"
            aria-label={`Remove one ${entry.name}`}
            title="Remove one"
          >
            −
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSetQty(entry.quantity + 1);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-base font-semibold text-white shadow ring-1 ring-black/10 transition hover:bg-accent-hover"
            aria-label={`Add another ${entry.name}`}
            title="Add one"
          >
            +
          </button>
        </div>
      </div>
      <div className="mt-1 truncate px-0.5 text-[11px] text-text-muted" title={entry.name}>
        {entry.name}
      </div>
    </li>
  );
}

function DeckRow({
  entry,
  onSetQty,
  onHover,
  onSelect,
}: {
  entry: DeckEntry;
  onSetQty: (q: number) => void;
  onHover: (p: { src?: string; x: number; y: number } | null) => void;
  onSelect: () => void;
}) {
  return (
    <li
      className="group flex cursor-pointer items-center gap-3 px-4 py-2.5 transition hover:bg-accent-subtle"
      onClick={onSelect}
      onMouseEnter={(e) =>
        onHover({ src: entry.imageNormal, x: e.clientX, y: e.clientY })
      }
      onMouseMove={(e) =>
        onHover({ src: entry.imageNormal, x: e.clientX, y: e.clientY })
      }
      onMouseLeave={() => onHover(null)}
    >
      {entry.imageSmall || entry.imageNormal ? (
        <img
          src={entry.imageSmall ?? entry.imageNormal}
          alt=""
          width={72}
          height={100}
          className="h-[100px] w-[72px] shrink-0 rounded-md ring-1 ring-black/10"
          loading="lazy"
        />
      ) : (
        <div className="h-[100px] w-[72px] shrink-0 rounded-md bg-surface-subtle" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{entry.name}</div>
        <div className="truncate text-xs text-text-muted">
          {entry.typeLine ?? ""}
        </div>
        <div className="mt-1">
          <ManaCost cost={entry.manaCost} size={16} />
        </div>
      </div>
      <div className="shrink-0 rounded-full bg-black/80 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
        ×{entry.quantity}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSetQty(entry.quantity - 1);
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-white text-base font-semibold text-text-muted transition hover:border-accent hover:text-accent"
          aria-label={`Remove one ${entry.name}`}
          title="Remove one"
        >
          −
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSetQty(entry.quantity + 1);
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-white text-base font-semibold text-text-muted transition hover:border-accent hover:bg-accent hover:text-white"
          aria-label={`Add another ${entry.name}`}
          title="Add one"
        >
          +
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSetQty(0);
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-white text-text-muted transition hover:border-[color:var(--danger)] hover:text-[color:var(--danger)]"
          aria-label={`Remove all ${entry.name}`}
          title="Remove all copies"
        >
          <TrashIcon />
        </button>
      </div>
    </li>
  );
}

function ColorBar({ pips }: { pips: Record<string, number> }) {
  const order: (keyof typeof pips)[] = ["W", "U", "B", "R", "G", "C"];
  const total = order.reduce((n, k) => n + pips[k], 0);
  if (total === 0) return null;
  return (
    <div className="flex h-2 w-28 overflow-hidden rounded-full ring-1 ring-black/5">
      {order.map((k) =>
        pips[k] > 0 ? (
          <div
            key={k}
            className={`pip-${k}`}
            style={{ width: `${(pips[k] / total) * 100}%` }}
            title={`${k}: ${pips[k]}`}
          />
        ) : null
      )}
    </div>
  );
}

function ManaCurve({ curve }: { curve: number[] }) {
  const max = Math.max(1, ...curve);
  return (
    <div
      className="flex items-end gap-0.5"
      title="Mana curve (non-lands)"
    >
      {curve.map((n, i) => (
        <div
          key={i}
          className="w-2.5 rounded-sm bg-accent/70"
          style={{ height: `${(n / max) * 22 + 2}px` }}
          title={`${i === 7 ? "7+" : i} CMC: ${n}`}
        />
      ))}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 5.5h13M8 5.5V4a1.5 1.5 0 0 1 1.5-1.5h1A1.5 1.5 0 0 1 12 4v1.5M5 5.5l.8 10a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4l.8-10M8.5 9v5M11.5 9v5" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 5h11M6 10h11M6 15h11M3.5 5h.01M3.5 10h.01M3.5 15h.01" />
    </svg>
  );
}
