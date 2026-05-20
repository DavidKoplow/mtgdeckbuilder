"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Deck, DeckEntry, DeckZone } from "../lib/types";
import { ManaCost } from "./ManaCost";

type Props = {
  deck: Deck;
  readOnly?: boolean;
  onSetQty: (cardId: string, qty: number) => void;
  onSetSideboardQty: (cardId: string, qty: number) => void;
  onSetMaybeboardQty: (cardId: string, qty: number) => void;
  onMoveCard: (cardId: string, from: BoardView, to: BoardView) => void;
  onSetCommander: (cardId: string, isCommander: boolean) => void;
  onHover: (
    payload: { src?: string; x: number; y: number } | null
  ) => void;
  onSelect: (cardId: string) => void;
  /** Scryfall card id — tile/row is highlighted when it matches the preview pane */
  previewCardId?: string | null;
  onRefreshCardData?: () => void;
};

type BoardView = DeckZone;
type ViewMode = "grid" | "list";
type DeckSortMode = "type" | "mana" | "rarity" | "price";

const BOARD_VIEWS: BoardView[] = ["main", "sideboard", "maybeboard"];
const BOARD_LABELS: Record<BoardView, string> = {
  main: "Deck",
  sideboard: "Sideboard",
  maybeboard: "Maybeboard",
};
const EMPTY_DECK_ENTRIES: DeckEntry[] = [];

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

const RARITY_ORDER = ["mythic", "rare", "uncommon", "common", "special", "bonus"];
const RARITY_LABELS: Record<string, string> = {
  mythic: "Mythic",
  rare: "Rare",
  uncommon: "Uncommon",
  common: "Common",
  special: "Special",
  bonus: "Bonus",
  unknown: "Unknown rarity",
};

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

function rarityBucket(entry: DeckEntry): string {
  const rarity = entry.rarity?.toLowerCase();
  return rarity && RARITY_LABELS[rarity] ? rarity : "unknown";
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

  if (sortMode === "rarity") {
    const groups = new Map<string, DeckEntry[]>();
    for (const entry of entries) {
      const bucket = rarityBucket(entry);
      const groupEntries = groups.get(bucket) ?? [];
      groupEntries.push(entry);
      groups.set(bucket, groupEntries);
    }

    for (const groupEntries of groups.values()) {
      groupEntries.sort(compareByManaThenName);
    }

    return [...RARITY_ORDER, "unknown"]
      .filter((rarity) => groups.has(rarity))
      .map(
        (rarity) =>
          [RARITY_LABELS[rarity] ?? rarity, groups.get(rarity)!] as const
      );
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

function countEntries(entries: DeckEntry[]): number {
  return entries.reduce((n, entry) => n + entry.quantity, 0);
}

export function DeckPanel({
  deck,
  readOnly = false,
  onSetQty,
  onSetSideboardQty,
  onSetMaybeboardQty,
  onMoveCard,
  onSetCommander,
  onHover,
  onSelect,
  previewCardId = null,
  onRefreshCardData,
}: Props) {
  const [view, setView] = useState<ViewMode>("grid");
  const [sortMode, setSortMode] = useState<DeckSortMode>("type");
  const [statsExpanded, setStatsExpanded] = useState(false);
  const mainEntries = deck.entries ?? EMPTY_DECK_ENTRIES;
  const sideboardEntries = deck.sideboard ?? EMPTY_DECK_ENTRIES;
  const maybeboardEntries = deck.maybeboard ?? EMPTY_DECK_ENTRIES;
  const mainCount = countEntries(mainEntries);
  const sideboardCount = countEntries(sideboardEntries);
  const maybeboardCount = countEntries(maybeboardEntries);
  const hasAnyEntries = mainCount + sideboardCount + maybeboardCount > 0;

  // Track which card IDs we've already tried to hydrate in this session so we
  // don't spam Scryfall for cards that genuinely have no listed metadata.
  const triedCardDataRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!onRefreshCardData) return;
    const allEntries = [
      ...mainEntries,
      ...sideboardEntries,
      ...maybeboardEntries,
    ];
    const novel = allEntries.some(
      (e) =>
        (e.priceUsd === undefined || e.rarity === undefined) &&
        !triedCardDataRef.current.has(e.cardId)
    );
    if (!novel) return;
    for (const e of allEntries) {
      if (e.priceUsd === undefined || e.rarity === undefined) {
        triedCardDataRef.current.add(e.cardId);
      }
    }
    onRefreshCardData();
  }, [mainEntries, sideboardEntries, maybeboardEntries, onRefreshCardData]);

  const {
    mainGroups,
    sideboardGroups,
    maybeboardGroups,
    totalCount,
    curve,
    colorPips,
    totalPrice,
    topExpensive,
    pricedCount,
  } = useMemo(() => {
    const totalCount = mainEntries.reduce((n, e) => n + e.quantity, 0);

    const curveBuckets = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const e of mainEntries) {
      if ((e.typeLine ?? "").includes("Land")) continue;
      const cmc = Math.max(0, Math.round(e.cmc ?? 0));
      const idx = Math.min(7, cmc);
      curveBuckets[idx] += e.quantity;
    }

    const colorPips = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    for (const e of mainEntries) {
      const colors = e.colors ?? [];
      if (colors.length === 0) colorPips.C += e.quantity;
      for (const c of colors) {
        if (c in colorPips) colorPips[c as "W"] += e.quantity;
      }
    }

    let totalPrice = 0;
    let pricedCount = 0;
    for (const e of mainEntries) {
      if (typeof e.priceUsd === "number") {
        totalPrice += e.priceUsd * e.quantity;
        pricedCount += e.quantity;
      }
    }
    const topExpensive = mainEntries
      .filter((e) => typeof e.priceUsd === "number")
      .slice()
      .sort((a, b) => (b.priceUsd ?? 0) - (a.priceUsd ?? 0))
      .slice(0, 3);

    return {
      mainGroups: buildDisplayGroups(mainEntries, sortMode),
      sideboardGroups: buildDisplayGroups(sideboardEntries, sortMode),
      maybeboardGroups: buildDisplayGroups(maybeboardEntries, sortMode),
      totalCount,
      curve: curveBuckets,
      colorPips,
      totalPrice,
      topExpensive,
      pricedCount,
    };
  }, [mainEntries, sideboardEntries, maybeboardEntries, sortMode]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="panel-heading flex flex-col gap-2 border-b border-border px-2 py-2 text-[11px] text-text-muted sm:px-4 sm:py-3 sm:text-xs lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-4 lg:gap-y-2">
        <div className="flex min-w-0 items-center justify-between gap-2 lg:mr-1">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-text">
              Deck
            </div>
            <div className="truncate text-xs tabular-nums text-text-subtle">
              {mainCount} main · {sideboardCount} sideboard ·{" "}
              {maybeboardCount} maybe
            </div>
          </div>
          <button
            type="button"
            onClick={() => setStatsExpanded((expanded) => !expanded)}
            aria-expanded={statsExpanded}
            className="control flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-xs font-semibold lg:hidden"
          >
            Stats
            <ChevronIcon expanded={statsExpanded} />
          </button>
        </div>
        <div
          className={`min-w-0 flex-col items-start gap-1.5 lg:flex lg:min-w-[11rem] lg:flex-1 lg:gap-1.5 ${
            statsExpanded ? "flex" : "hidden"
          }`}
        >
          <ManaCurve curve={curve} />
          <ColorBar pips={colorPips} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 lg:gap-2">
          <PriceSummary
            totalPrice={totalPrice}
            topExpensive={topExpensive}
            totalCount={totalCount}
            pricedCount={pricedCount}
          />
          <SortSelect sortMode={sortMode} onChange={setSortMode} />
          <ViewToggle view={view} onChange={setView} />
        </div>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-surface">
        {!hasAnyEntries ? (
          <div className="flex h-full items-center justify-center p-8 text-center">
            <div className="empty-pill rounded-full px-4 py-2 text-sm text-text-subtle">
              Empty deck
            </div>
          </div>
        ) : (
          <div className={view === "grid" ? "space-y-5 p-4" : "space-y-5 py-2"}>
            {mainCount > 0 && (
              <DeckBoardSection
                title="Deck"
                boardView="main"
                groups={mainGroups}
                view={view}
                readOnly={readOnly}
                previewCardId={previewCardId}
                onSetQty={onSetQty}
                onSetCommander={onSetCommander}
                onMoveCard={onMoveCard}
                onHover={onHover}
                onSelect={onSelect}
              />
            )}
            {sideboardCount > 0 && (
              <DeckBoardSection
                title="Sideboard"
                boardView="sideboard"
                groups={sideboardGroups}
                view={view}
                readOnly={readOnly}
                previewCardId={previewCardId}
                onSetQty={onSetSideboardQty}
                onSetCommander={onSetCommander}
                onMoveCard={onMoveCard}
                onHover={onHover}
                onSelect={onSelect}
              />
            )}
            {maybeboardCount > 0 && (
              <DeckBoardSection
                title="Maybeboard"
                boardView="maybeboard"
                groups={maybeboardGroups}
                view={view}
                readOnly={readOnly}
                previewCardId={previewCardId}
                onSetQty={onSetMaybeboardQty}
                onSetCommander={onSetCommander}
                onMoveCard={onMoveCard}
                onHover={onHover}
                onSelect={onSelect}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DeckBoardSection({
  title,
  boardView,
  groups,
  view,
  readOnly,
  previewCardId,
  onSetQty,
  onSetCommander,
  onMoveCard,
  onHover,
  onSelect,
}: {
  title?: string;
  boardView: BoardView;
  groups: Array<readonly [string, DeckEntry[]]>;
  view: ViewMode;
  readOnly: boolean;
  previewCardId: string | null;
  onSetQty: (cardId: string, qty: number) => void;
  onSetCommander: (cardId: string, isCommander: boolean) => void;
  onMoveCard: (cardId: string, from: BoardView, to: BoardView) => void;
  onHover: (p: { src?: string; x: number; y: number } | null) => void;
  onSelect: (cardId: string) => void;
}) {
  const sectionCount = groups.reduce(
    (n, [, entries]) => n + countEntries(entries),
    0
  );

  return (
    <section
      className={
        title && boardView !== "main"
          ? "border-t border-border/80 pt-4"
          : undefined
      }
    >
      {title && (
        <header
          className={`mb-3 flex items-center gap-2 text-xs font-semibold text-text ${
            view === "list" ? "px-4" : ""
          }`}
        >
          <span>{title}</span>
          <span className="rounded-full bg-surface-subtle px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-text-subtle">
            {sectionCount}
          </span>
        </header>
      )}
      <div className="space-y-4">
        {groups.map(([group, entries]) => (
          <div key={`${boardView}-${group}`}>
            <header
              className={`mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase text-text-muted ${
                view === "list" ? "px-4" : ""
              }`}
            >
              <span>{group}</span>
              <span className="rounded-full bg-surface-subtle px-1.5 py-0.5 text-[10px] font-medium text-text-subtle">
                {countEntries(entries)}
              </span>
            </header>
            {view === "grid" ? (
              <ul className="deck-card-grid grid grid-cols-[repeat(auto-fill,minmax(5.35rem,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(8.25rem,1fr))] sm:gap-3">
                {entries.map((entry) => (
                  <DeckTile
                    key={entry.cardId}
                    entry={entry}
                    boardView={boardView}
                    readOnly={readOnly}
                    highlighted={previewCardId === entry.cardId}
                    onSetQty={(quantity) => onSetQty(entry.cardId, quantity)}
                    onSetCommander={(isCommander) =>
                      onSetCommander(entry.cardId, isCommander)
                    }
                    onMove={(to) => onMoveCard(entry.cardId, boardView, to)}
                    onHover={onHover}
                    onSelect={() => onSelect(entry.cardId)}
                  />
                ))}
              </ul>
            ) : (
              <ul className="divide-y divide-border border-y border-border bg-white">
                {entries.map((entry) => (
                  <DeckRow
                    key={entry.cardId}
                    entry={entry}
                    boardView={boardView}
                    readOnly={readOnly}
                    highlighted={previewCardId === entry.cardId}
                    onSetQty={(quantity) => onSetQty(entry.cardId, quantity)}
                    onSetCommander={(isCommander) =>
                      onSetCommander(entry.cardId, isCommander)
                    }
                    onMove={(to) => onMoveCard(entry.cardId, boardView, to)}
                    onHover={onHover}
                    onSelect={() => onSelect(entry.cardId)}
                  />
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
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
    <label className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-white/78 px-2 text-[11px] text-text-muted shadow-sm lg:h-9 lg:gap-2 lg:px-2.5 lg:text-xs">
      <span className="font-medium">Sort</span>
      <select
        value={sortMode}
        onChange={(e) => onChange(e.target.value as DeckSortMode)}
        className="bg-transparent text-[11px] font-medium text-text outline-none lg:text-xs"
        aria-label="Sort displayed deck cards"
      >
        <option value="type">Type</option>
        <option value="mana">Mana value</option>
        <option value="rarity">Rarity</option>
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
    <div className="segmented-control ml-auto flex items-center rounded-lg p-0.5 lg:p-1">
      <button
        onClick={() => onChange("grid")}
        aria-pressed={view === "grid"}
        title="Grid view"
        className={`flex h-7 w-7 items-center justify-center rounded-md transition lg:w-8 ${
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
        className={`flex h-7 w-7 items-center justify-center rounded-md transition lg:w-8 ${
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
  boardView,
  readOnly,
  highlighted,
  onSetQty,
  onSetCommander,
  onMove,
  onHover,
  onSelect,
}: {
  entry: DeckEntry;
  boardView: BoardView;
  readOnly: boolean;
  highlighted?: boolean;
  onSetQty: (q: number) => void;
  onSetCommander: (isCommander: boolean) => void;
  onMove: (to: BoardView) => void;
  onHover: (p: { src?: string; x: number; y: number } | null) => void;
  onSelect: () => void;
}) {
  const isMain = boardView === "main";
  const trashTop = entry.isCommander && isMain ? "top-9" : "top-1.5";
  const moveTop =
    entry.isCommander && isMain ? "top-[4.65rem]" : "top-9";

  return (
    <li
      aria-current={highlighted ? "true" : undefined}
      className="group relative"
      onMouseEnter={(e) =>
        onHover({
          src: entry.imageNormal ?? entry.imageSmall,
          x: e.clientX,
          y: e.clientY,
        })
      }
      onMouseMove={(e) =>
        onHover({
          src: entry.imageNormal ?? entry.imageSmall,
          x: e.clientX,
          y: e.clientY,
        })
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
        {entry.imageNormal || entry.imageSmall ? (
          <img
            src={entry.imageNormal ?? entry.imageSmall}
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

        {entry.isCommander && isMain && (
          <div className="pointer-events-none absolute left-1.5 top-1.5 rounded-full bg-accent px-2 py-1 text-[10px] font-semibold uppercase text-white shadow">
            Commander
          </div>
        )}

        {!readOnly && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSetQty(0);
            }}
            aria-label={`Remove all ${entry.name}`}
            title="Remove all copies"
            className={`absolute left-1.5 ${trashTop} hidden h-7 w-7 items-center justify-center rounded-full bg-white/95 text-text-muted shadow ring-1 ring-black/10 transition hover:bg-white hover:text-[color:var(--danger)] lg:flex lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100`}
          >
            <TrashIcon />
          </button>
        )}

        {/* quantity badge overlay */}
        <div className="pointer-events-none absolute right-1.5 top-1.5 flex h-7 min-w-7 items-center justify-center rounded-full bg-black/80 px-2 text-sm font-semibold text-white tabular-nums shadow">
          ×{entry.quantity}
        </div>

        {!readOnly && (
          <div
            className={`absolute inset-x-1.5 bottom-1.5 hidden items-center gap-1 transition lg:flex lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 ${
              isMain ? "justify-between" : "justify-center"
            }`}
          >
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
            {isMain && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSetCommander(!entry.isCommander);
                }}
                className={`deck-action-button ${
                  entry.isCommander ? "deck-action-button-active" : ""
                }`}
                aria-pressed={entry.isCommander}
                aria-label={
                  entry.isCommander
                    ? `Remove ${entry.name} as commander`
                    : `Set ${entry.name} as commander`
                }
                title={entry.isCommander ? "Remove commander" : "Set commander"}
              >
                <CommanderIcon />
              </button>
            )}
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
        )}
      </div>
      {!readOnly && (
        <MoveMenu
          entryName={entry.name}
          currentBoard={boardView}
          onMove={onMove}
          wrapperClassName={`absolute left-1.5 ${moveTop} z-20 hidden lg:flex lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100`}
          buttonClassName="h-7 w-7 rounded-full bg-white/95 text-text-muted shadow ring-1 ring-black/10 transition hover:bg-white hover:text-accent"
          menuClassName="left-full top-0 ml-1"
          direction={boardView === "main" ? "right" : "left"}
        />
      )}
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
  boardView,
  readOnly,
  highlighted,
  onSetQty,
  onSetCommander,
  onMove,
  onHover,
  onSelect,
}: {
  entry: DeckEntry;
  boardView: BoardView;
  readOnly: boolean;
  highlighted?: boolean;
  onSetQty: (q: number) => void;
  onSetCommander: (isCommander: boolean) => void;
  onMove: (to: BoardView) => void;
  onHover: (p: { src?: string; x: number; y: number } | null) => void;
  onSelect: () => void;
}) {
  const isMain = boardView === "main";

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
          className="h-[72px] w-[52px] shrink-0 rounded-md object-cover shadow-sm ring-1 ring-black/10 sm:h-[100px] sm:w-[72px] sm:rounded-lg"
          loading="lazy"
        />
      ) : (
        <div className="h-[72px] w-[52px] shrink-0 rounded-md bg-surface-subtle sm:h-[100px] sm:w-[72px]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <div className="truncate text-sm font-semibold">{entry.name}</div>
          {entry.isCommander && isMain && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
              Commander
            </span>
          )}
        </div>
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
      {!readOnly && (
      <div className="hidden shrink-0 items-center gap-1 transition lg:flex lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
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
        {isMain && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSetCommander(!entry.isCommander);
            }}
            className={`deck-action-button ${
              entry.isCommander ? "deck-action-button-active" : ""
            }`}
            aria-pressed={entry.isCommander}
            aria-label={
              entry.isCommander
                ? `Remove ${entry.name} as commander`
                : `Set ${entry.name} as commander`
            }
            title={entry.isCommander ? "Remove commander" : "Set commander"}
          >
            <CommanderIcon />
          </button>
        )}
        <MoveMenu
          entryName={entry.name}
          currentBoard={boardView}
          onMove={onMove}
          wrapperClassName="relative"
          buttonClassName="deck-action-button"
          menuClassName="right-0 top-full mt-1"
          direction={boardView === "main" ? "right" : "left"}
        />
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
      )}
    </li>
  );
}

function MoveMenu({
  entryName,
  currentBoard,
  onMove,
  wrapperClassName,
  buttonClassName,
  menuClassName,
  direction,
}: {
  entryName: string;
  currentBoard: BoardView;
  onMove: (to: BoardView) => void;
  wrapperClassName: string;
  buttonClassName: string;
  menuClassName: string;
  direction: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const targets = BOARD_VIEWS.filter((view) => view !== currentBoard);

  return (
    <div
      className={wrapperClassName}
      onClick={(event) => event.stopPropagation()}
      onBlur={(event) => {
        const nextFocus = event.relatedTarget;
        if (
          !(nextFocus instanceof Node) ||
          !event.currentTarget.contains(nextFocus)
        ) {
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`flex items-center justify-center ${buttonClassName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Move ${entryName}`}
        title="Move card"
      >
        <MoveIcon direction={direction} />
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-30 min-w-32 overflow-hidden rounded-lg border border-border bg-white py-1 text-xs text-text shadow-lg ${menuClassName}`}
        >
          {targets.map((target) => (
            <button
              key={target}
              type="button"
              role="menuitem"
              className="block w-full px-3 py-1.5 text-left hover:bg-surface-subtle"
              onClick={() => {
                setOpen(false);
                onMove(target);
              }}
            >
              Move to {BOARD_LABELS[target]}
            </button>
          ))}
        </div>
      )}
    </div>
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
    <div className="group relative flex items-center self-center">
      <span
        className="inline-flex h-8 cursor-default items-center rounded-full border border-border bg-white/80 px-2.5 font-medium tabular-nums text-text shadow-sm"
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
      className="flex w-32 items-end justify-center gap-0.5 rounded-full border border-border bg-white/78 px-2 py-1 shadow-sm"
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

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`transition-transform ${expanded ? "rotate-180" : ""}`}
    >
      <path d="M5 8l5 5 5-5" />
    </svg>
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

function CommanderIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4 8 3 2.5L10 4l3 6.5L16 8l-1.4 7H5.4L4 8Z" />
      <path d="M6 16h8" />
    </svg>
  );
}

function MoveIcon({ direction }: { direction: "left" | "right" }) {
  const line = direction === "right" ? "M4 10h10" : "M16 10H6";
  const arrow = direction === "right" ? "m11 6 4 4-4 4" : "m9 6-4 4 4 4";
  const rail = direction === "right" ? "M4 5.5V14.5" : "M16 5.5v9";
  return (
    <svg
      viewBox="0 0 20 20"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={line} />
      <path d={arrow} />
      <path d={rail} />
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
