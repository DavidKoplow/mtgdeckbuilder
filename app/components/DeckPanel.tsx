"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Deck, DeckEntry } from "../lib/types";
import { ManaCost } from "./ManaCost";

type Props = {
  deck: Deck;
  onSetQty: (cardId: string, qty: number) => void;
  onHover: (
    payload: { src?: string; x: number; y: number } | null
  ) => void;
  onSelect: (cardId: string) => void;
  /** Scryfall card id — tile/row is highlighted when it matches the preview pane */
  previewCardId?: string | null;
  onRefreshPrices?: () => void;
};

type ViewMode = "grid" | "list";
type DeckSortMode = "type" | "mana" | "price";

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

function compareByManaThenName(a: DeckEntry, b: DeckEntry): number {
  const ca = a.cmc ?? 0;
  const cb = b.cmc ?? 0;
  if (ca !== cb) return ca - cb;
  return a.name.localeCompare(b.name);
}

function compareByName(a: DeckEntry, b: DeckEntry): number {
  return a.name.localeCompare(b.name);
}

function manaBucket(entry: DeckEntry): string {
  const cmc = Math.max(0, Math.round(entry.cmc ?? 0));
  return cmc >= 7 ? "MV 7+" : `MV ${cmc}`;
}

function buildDisplayGroups(
  entries: DeckEntry[],
  sortMode: DeckSortMode
): Array<readonly [string, DeckEntry[]]> {
  if (sortMode === "type") {
    const groups = new Map<string, DeckEntry[]>();
    for (const entry of entries) {
      const group = groupOf(entry);
      const groupEntries = groups.get(group) ?? [];
      groupEntries.push(entry);
      groups.set(group, groupEntries);
    }

    for (const groupEntries of groups.values()) {
      groupEntries.sort(compareByManaThenName);
    }

    return TYPE_ORDER.filter((type) => groups.has(type)).map(
      (type) => [type, groups.get(type)!] as const
    );
  }

  if (sortMode === "mana") {
    const groups = new Map<string, DeckEntry[]>();
    for (const entry of entries) {
      const bucket = manaBucket(entry);
      const groupEntries = groups.get(bucket) ?? [];
      groupEntries.push(entry);
      groups.set(bucket, groupEntries);
    }

    for (const groupEntries of groups.values()) {
      groupEntries.sort((a, b) => {
        const typeCompare =
          TYPE_ORDER.indexOf(groupOf(a)) - TYPE_ORDER.indexOf(groupOf(b));
        if (typeCompare !== 0) return typeCompare;
        return compareByName(a, b);
      });
    }

    return Array.from(groups.entries()).sort(([a], [b]) => {
      const bucketNumber = (label: string) =>
        label === "MV 7+" ? 7 : Number(label.replace("MV ", ""));
      return bucketNumber(a) - bucketNumber(b);
    });
  }

  const priced = entries
    .filter((entry) => typeof entry.priceUsd === "number")
    .slice()
    .sort((a, b) => {
      const priceCompare = (b.priceUsd ?? 0) - (a.priceUsd ?? 0);
      if (priceCompare !== 0) return priceCompare;
      return compareByManaThenName(a, b);
    });
  const unpriced = entries
    .filter((entry) => typeof entry.priceUsd !== "number")
    .slice()
    .sort(compareByManaThenName);
  const groups: Array<readonly [string, DeckEntry[]]> = [];
  if (priced.length > 0) groups.push(["Price high to low", priced]);
  if (unpriced.length > 0) groups.push(["Unpriced", unpriced]);
  return groups;
}

export function DeckPanel({
  deck,
  onSetQty,
  onHover,
  onSelect,
  previewCardId = null,
  onRefreshPrices,
}: Props) {
  const [view, setView] = useState<ViewMode>("grid");
  const [sortMode, setSortMode] = useState<DeckSortMode>("type");

  // Track which card IDs we've already tried to price in this session so we
  // don't spam Scryfall for cards that genuinely have no listed USD price.
  const triedPriceRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!onRefreshPrices) return;
    const novel = deck.entries.some(
      (e) => e.priceUsd === undefined && !triedPriceRef.current.has(e.cardId)
    );
    if (!novel) return;
    for (const e of deck.entries) {
      if (e.priceUsd === undefined) triedPriceRef.current.add(e.cardId);
    }
    onRefreshPrices();
  }, [deck.entries, onRefreshPrices]);

  const { groups, totalCount, curve, colorPips, totalPrice, topExpensive, pricedCount } = useMemo(() => {
    const displayGroups = buildDisplayGroups(deck.entries, sortMode);
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

    let totalPrice = 0;
    let pricedCount = 0;
    for (const e of deck.entries) {
      if (typeof e.priceUsd === "number") {
        totalPrice += e.priceUsd * e.quantity;
        pricedCount += e.quantity;
      }
    }
    const topExpensive = deck.entries
      .filter((e) => typeof e.priceUsd === "number")
      .slice()
      .sort((a, b) => (b.priceUsd ?? 0) - (a.priceUsd ?? 0))
      .slice(0, 3);

    return {
      groups: displayGroups,
      totalCount,
      curve: curveBuckets,
      colorPips,
      totalPrice,
      topExpensive,
      pricedCount,
    };
  }, [deck.entries, sortMode]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="panel-heading flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 py-3 text-xs text-text-muted sm:px-4">
        <div className="mr-1">
          <div className="text-sm font-semibold text-text">Deck</div>
          <div className="text-xs tabular-nums text-text-subtle">
            {totalCount} cards
          </div>
        </div>
        <div className="flex min-w-[11rem] flex-1 flex-wrap items-center gap-x-4 gap-y-2">
          <ColorBar pips={colorPips} />
          <ManaCurve curve={curve} />
          <PriceSummary
            totalPrice={totalPrice}
            topExpensive={topExpensive}
            totalCount={totalCount}
            pricedCount={pricedCount}
          />
        </div>
        <SortSelect sortMode={sortMode} onChange={setSortMode} />
        <ViewToggle view={view} onChange={setView} />
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-surface">
        {deck.entries.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div className="empty-pill rounded-full px-4 py-2 text-sm text-text-subtle">
              Empty deck
            </div>
          </div>
        ) : (
          <div className={view === "grid" ? "space-y-4 p-4" : "space-y-4 py-2"}>
            {groups.map(([group, entries]) => (
              <section key={group}>
                <header
                  className={`mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase text-text-muted ${
                    view === "list" ? "px-4" : ""
                  }`}
                >
                  <span>{group}</span>
                  <span className="rounded-full bg-surface-subtle px-1.5 py-0.5 text-[10px] font-medium text-text-subtle">
                    {entries.reduce((n, entry) => n + entry.quantity, 0)}
                  </span>
                </header>
                {view === "grid" ? (
                  <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.25rem,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(8.25rem,1fr))]">
                    {entries.map((e) => (
                      <DeckTile
                        key={e.cardId}
                        entry={e}
                        highlighted={previewCardId === e.cardId}
                        onSetQty={(q) => onSetQty(e.cardId, q)}
                        onHover={onHover}
                        onSelect={() => onSelect(e.cardId)}
                      />
                    ))}
                  </ul>
                ) : (
                  <ul className="divide-y divide-border border-y border-border bg-white">
                    {entries.map((e) => (
                      <DeckRow
                        key={e.cardId}
                        entry={e}
                        highlighted={previewCardId === e.cardId}
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

function SortSelect({
  sortMode,
  onChange,
}: {
  sortMode: DeckSortMode;
  onChange: (mode: DeckSortMode) => void;
}) {
  return (
    <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-white/78 px-2.5 text-xs text-text-muted shadow-sm">
      <span className="font-medium">Sort</span>
      <select
        value={sortMode}
        onChange={(e) => onChange(e.target.value as DeckSortMode)}
        className="bg-transparent text-xs font-medium text-text outline-none"
        aria-label="Sort displayed deck cards"
      >
        <option value="type">Type</option>
        <option value="mana">Mana value</option>
        <option value="price">Price</option>
      </select>
    </label>
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
    <div className="segmented-control ml-auto flex items-center rounded-lg p-1">
      <button
        onClick={() => onChange("grid")}
        aria-pressed={view === "grid"}
        title="Grid view"
        className={`flex h-7 w-8 items-center justify-center rounded-md transition ${
          view === "grid"
            ? "selected-segment font-medium text-text"
            : "text-text-muted hover:text-text"
        }`}
      >
        <GridIcon />
      </button>
      <button
        onClick={() => onChange("list")}
        aria-pressed={view === "list"}
        title="List view"
        className={`flex h-7 w-8 items-center justify-center rounded-md transition ${
          view === "list"
            ? "selected-segment font-medium text-text"
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
  highlighted,
  onSetQty,
  onHover,
  onSelect,
}: {
  entry: DeckEntry;
  highlighted?: boolean;
  onSetQty: (q: number) => void;
  onHover: (p: { src?: string; x: number; y: number } | null) => void;
  onSelect: () => void;
}) {
  return (
    <li
      aria-current={highlighted ? "true" : undefined}
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
        className={`interactive-card relative cursor-pointer overflow-hidden rounded-lg bg-surface-subtle shadow-sm transition ${
          highlighted
            ? "ring-2 ring-accent shadow-[0_0_0_3px_rgba(139,63,244,0.2)]"
            : "ring-1 ring-black/10 group-hover:ring-accent"
        }`}
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
          className="absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-text-muted opacity-0 shadow ring-1 ring-black/10 transition hover:bg-white hover:text-[color:var(--danger)] group-hover:opacity-100"
        >
          <TrashIcon />
        </button>

        {/* quantity badge overlay */}
        <div className="pointer-events-none absolute right-1.5 top-1.5 flex h-7 min-w-7 items-center justify-center rounded-full bg-black/80 px-2 text-sm font-semibold text-white tabular-nums shadow">
          ×{entry.quantity}
        </div>

        {/* +/− controls */}
        <div className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSetQty(entry.quantity - 1);
            }}
            className="deck-action-button"
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
            className="deck-action-button"
            aria-label={`Add another ${entry.name}`}
            title="Add one"
          >
            +
          </button>
        </div>
      </div>
      <div
        className="mt-1.5 truncate px-0.5 text-[11px] font-medium text-text-muted"
        title={entry.name}
      >
        {entry.name}
      </div>
    </li>
  );
}

function DeckRow({
  entry,
  highlighted,
  onSetQty,
  onHover,
  onSelect,
}: {
  entry: DeckEntry;
  highlighted?: boolean;
  onSetQty: (q: number) => void;
  onHover: (p: { src?: string; x: number; y: number } | null) => void;
  onSelect: () => void;
}) {
  return (
    <li
      aria-current={highlighted ? "true" : undefined}
      className={`group flex cursor-pointer items-center gap-2 px-3 py-2.5 transition sm:gap-3 sm:px-4 ${
        highlighted
          ? "bg-[image:var(--rainbow-soft)] ring-2 ring-inset ring-accent/60"
          : "hover:bg-surface-tint/80"
      }`}
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
          className="h-[84px] w-[60px] shrink-0 rounded-lg object-cover shadow-sm ring-1 ring-black/10 sm:h-[100px] sm:w-[72px]"
          loading="lazy"
        />
      ) : (
        <div className="h-[84px] w-[60px] shrink-0 rounded-md bg-surface-subtle sm:h-[100px] sm:w-[72px]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{entry.name}</div>
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
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSetQty(entry.quantity - 1);
          }}
          className="deck-action-button"
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
          className="deck-action-button"
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
          className="deck-action-button deck-action-button-danger"
          aria-label={`Remove all ${entry.name}`}
          title="Remove all copies"
        >
          <TrashIcon />
        </button>
      </div>
    </li>
  );
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function PriceSummary({
  totalPrice,
  topExpensive,
  totalCount,
  pricedCount,
}: {
  totalPrice: number;
  topExpensive: DeckEntry[];
  totalCount: number;
  pricedCount: number;
}) {
  if (totalCount === 0) return null;
  const partial = pricedCount < totalCount;
  const label = pricedCount === 0 ? "Price —" : `≈ ${formatUsd(totalPrice)}`;
  const title =
    pricedCount === 0
      ? "Prices not yet loaded"
      : partial
        ? `${pricedCount}/${totalCount} cards priced — total excludes unpriced cards`
        : "Estimated total deck price (USD, Scryfall)";
  return (
    <div className="group relative">
      <span
        className="cursor-default rounded-full border border-border bg-white/80 px-2.5 py-1 font-medium tabular-nums text-text shadow-sm"
        title={title}
      >
        {label}
        {partial && pricedCount > 0 ? (
          <span className="ml-1 text-text-subtle">*</span>
        ) : null}
      </span>
      {topExpensive.length > 0 && (
        <div
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-max min-w-[14rem] rounded-lg border border-border bg-white p-2 shadow-lg group-hover:block"
        >
          <div className="mb-1 text-[10px] font-semibold uppercase text-text-subtle">
            Top {topExpensive.length} priciest
          </div>
          <ul className="space-y-0.5">
            {topExpensive.map((e) => (
              <li
                key={e.cardId}
                className="flex items-baseline justify-between gap-4 text-[11px]"
              >
                <span className="truncate text-text">
                  {e.name}
                  {e.quantity > 1 ? (
                    <span className="ml-1 text-text-subtle">×{e.quantity}</span>
                  ) : null}
                </span>
                <span className="tabular-nums text-text-muted">
                  {formatUsd(e.priceUsd ?? 0)}
                </span>
              </li>
            ))}
          </ul>
          {partial && (
            <div className="mt-1 border-t border-border pt-1 text-[10px] text-text-subtle">
              {pricedCount}/{totalCount} cards priced
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ColorBar({ pips }: { pips: Record<string, number> }) {
  const order: (keyof typeof pips)[] = ["W", "U", "B", "R", "G", "C"];
  const colors: Record<string, string> = {
    W: "var(--mana-w)",
    U: "var(--mana-u)",
    B: "var(--mana-b)",
    R: "var(--mana-r)",
    G: "var(--mana-g)",
    C: "#d7ddd9",
  };
  const total = order.reduce((n, k) => n + pips[k], 0);
  if (total === 0) return null;
  return (
    <div
      className="flex h-2.5 w-32 overflow-hidden rounded-full bg-white/70 shadow-sm ring-1 ring-black/5"
      title="Color mix"
    >
      {order.map((k) =>
        pips[k] > 0 ? (
          <div
            key={k}
            style={{
              width: `${(pips[k] / total) * 100}%`,
              background: colors[k],
            }}
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
      className="flex items-end gap-0.5 rounded-full border border-border bg-white/78 px-2 py-1 shadow-sm"
      title="Mana curve (non-lands)"
    >
      {curve.map((n, i) => (
        <div
          key={i}
          className="accent-bar w-2.5 rounded-sm"
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
