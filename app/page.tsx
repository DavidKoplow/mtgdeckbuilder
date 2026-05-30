"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { AppIcon } from "./components/AppIcon";
import { AuthButton } from "./components/AuthButton";
import {
  OPEN_DECK_SELECTOR_HREF,
  builderDeckHref,
} from "./lib/builderNavigation";
import type {
  DeckColorBreakdown,
  PublicDeckSummary,
} from "./lib/types";

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const DATE_ONLY_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});
type DeckBrowserTab = "public" | "official";
type PublicDeckSource = "community" | "official";
const DECK_PAGE_SIZE = 36;

export default function PublicDecksPage() {
  const auth = useConvexAuth();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<DeckBrowserTab>("public");
  const [deckPage, setDeckPage] = useState(1);
  const deferredSearch = useDeferredValue(search);
  const trimmedSearch = deferredSearch.trim();
  const activeSource: PublicDeckSource =
    activeTab === "official" ? "official" : "community";
  const activeTabLabel =
    activeTab === "official" ? "Official MTG Decks" : "Public Decks";
  const searchArgs = useMemo(
    () => ({
      query: trimmedSearch,
      limit: DECK_PAGE_SIZE,
      page: deckPage,
      source: activeSource,
    }),
    [activeSource, deckPage, trimmedSearch]
  );
  const recentArgs = useMemo(
    () => ({ limit: 12, source: activeSource }),
    [activeSource]
  );
  const results = useQuery(api.decks.searchPublicDeckPage, searchArgs);
  const recent = useQuery(api.decks.listRecentPublicDecks, recentArgs);
  const ownedDecks = useQuery(
    api.decks.listDecks,
    auth.isAuthenticated ? {} : "skip"
  );
  const ownedDeckByPublicId = useMemo(() => {
    const byPublicId = new Map<string, string>();
    for (const deck of ownedDecks ?? []) {
      if (deck.publicId) byPublicId.set(deck.publicId, deck.id);
    }
    return byPublicId;
  }, [ownedDecks]);
  const showingSearch = trimmedSearch.length > 0;
  const mainDecks = results?.decks ?? [];
  const hasNextPage = results?.hasNextPage === true;

  function selectTab(tab: DeckBrowserTab) {
    setActiveTab(tab);
    setDeckPage(1);
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    setDeckPage(1);
  }

  return (
    <div className="app-shell-bg flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="app-header shrink-0 px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <Link
            href={OPEN_DECK_SELECTOR_HREF}
            className="header-brand-button shrink-0"
            aria-label="Open deck selector"
            title="Your decks"
          >
            <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl bg-white p-1 shadow-sm ring-1 ring-border/70">
              <AppIcon size={26} />
            </span>
            <div className="hidden leading-tight sm:block">
              <div className="text-sm font-semibold tracking-normal text-text">
                magicaldeckgatherer
              </div>
              <div className="text-[11px] font-medium text-text-subtle">
                Deck library
              </div>
            </div>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={OPEN_DECK_SELECTOR_HREF}
              className="control px-3 py-2 text-xs"
            >
              Builder
            </Link>
            <AuthButton />
          </div>
        </div>
      </header>

      <main className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4 lg:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <section className="workspace-panel rainbow-edge rounded-lg p-3 sm:p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="inline-flex shrink-0 rounded-md border border-border bg-white/70 p-1 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => selectTab("public")}
                  className={`rounded px-3 py-2 transition ${
                    activeTab === "public"
                      ? "bg-surface-raised text-text shadow-sm"
                      : "text-text-subtle hover:text-text"
                  }`}
                >
                  Public Decks
                </button>
                <button
                  type="button"
                  onClick={() => selectTab("official")}
                  className={`rounded px-3 py-2 transition ${
                    activeTab === "official"
                      ? "bg-surface-raised text-text shadow-sm"
                      : "text-text-subtle hover:text-text"
                  }`}
                >
                  Official MTG Decks
                </button>
              </div>
              <label className="min-w-0 flex-1">
                <span className="sr-only">Search {activeTabLabel}</span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => handleSearchChange(event.target.value)}
                  placeholder={`Search ${activeTabLabel}`}
                  className="input min-h-11 text-sm"
                />
              </label>
            </div>
          </section>

          <div
            className={`grid min-w-0 gap-4 ${
              showingSearch ? "lg:grid-cols-[minmax(0,1fr)_22rem]" : ""
            }`}
          >
            <section className="min-w-0">
              <div className="mb-2 flex items-end justify-between gap-3">
                <div>
                  <h1 className="text-lg font-semibold text-text">
                    {showingSearch ? "Search results" : activeTabLabel}
                  </h1>
                  <div className="text-xs text-text-subtle">
                    {results === undefined
                        ? "Loading"
                        : `${mainDecks.length} deck${mainDecks.length === 1 ? "" : "s"} · Page ${deckPage}`}
                  </div>
                </div>
                <DeckPagination
                  page={deckPage}
                  loading={results === undefined}
                  hasNextPage={hasNextPage}
                  onPageChange={setDeckPage}
                />
              </div>
              <DeckList
                decks={mainDecks}
                loading={results === undefined}
                ownedDeckByPublicId={ownedDeckByPublicId}
                emptyLabel={`No ${activeTabLabel.toLowerCase()} found.`}
                loadingLabel={`Loading ${activeTabLabel.toLowerCase()}`}
              />
              <div className="mt-3">
                <DeckPagination
                  page={deckPage}
                  loading={results === undefined}
                  hasNextPage={hasNextPage}
                  onPageChange={setDeckPage}
                />
              </div>
            </section>

            {showingSearch && (
              <aside className="min-w-0">
                <div className="mb-2">
                  <h2 className="text-sm font-semibold text-text">
                    Recently updated
                  </h2>
                </div>
                <DeckList
                  compact
                  decks={recent ?? []}
                  loading={recent === undefined}
                  ownedDeckByPublicId={ownedDeckByPublicId}
                  emptyLabel={`No recent ${activeTabLabel.toLowerCase()} found.`}
                  loadingLabel={`Loading recent ${activeTabLabel.toLowerCase()}`}
                />
              </aside>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function DeckList({
  decks,
  loading,
  ownedDeckByPublicId,
  compact = false,
  emptyLabel = "No public decks found.",
  loadingLabel = "Loading public decks",
}: {
  decks: PublicDeckSummary[];
  loading: boolean;
  ownedDeckByPublicId: Map<string, string>;
  compact?: boolean;
  emptyLabel?: string;
  loadingLabel?: string;
}) {
  if (loading) {
    return (
      <div className="workspace-panel rounded-lg p-5 text-sm text-text-subtle">
        {loadingLabel}
      </div>
    );
  }

  if (decks.length === 0) {
    return (
      <div className="workspace-panel rounded-lg p-5 text-sm text-text-subtle">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className={`grid gap-3 ${compact ? "" : "md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}`}>
      {decks.map((deck) => (
        <PublicDeckCard
          key={deck.publicId}
          deck={deck}
          ownedDeckId={ownedDeckByPublicId.get(deck.publicId)}
        />
      ))}
    </div>
  );
}

function DeckPagination({
  page,
  loading,
  hasNextPage,
  onPageChange,
}: {
  page: number;
  loading: boolean;
  hasNextPage: boolean;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1 || loading}
        className="control px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
      >
        Previous
      </button>
      <span className="min-w-16 text-center text-xs font-semibold text-text-subtle">
        Page {page}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={!hasNextPage || loading}
        className="control px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}

function PublicDeckCard({
  deck,
  ownedDeckId,
}: {
  deck: PublicDeckSummary;
  ownedDeckId?: string;
}) {
  const savedDeckId = ownedDeckId ?? deck.ownedDeckId;
  const href = savedDeckId
    ? builderDeckHref(savedDeckId)
    : `/builder/?publicDeck=${encodeURIComponent(deck.publicId)}`;
  const hasArt = typeof deck.featuredImage === "string" && deck.featuredImage.length > 0;
  const artCropLikely = hasArt && deck.featuredImage?.includes("/art_crop/");
  const viewsLabel = formatDeckViews(deck.viewCount);
  const sourceLabel = [deck.sourceDeckType, deck.sourceDeckCode]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" · ");
  const countsLabel = `${deck.cardCount} deck · ${deck.sideboardCount} sideboard · ${deck.maybeboardCount} maybe`;
  const dateLabel = deck.sourceReleaseDate
    ? DATE_ONLY_FORMAT.format(new Date(`${deck.sourceReleaseDate}T00:00:00`))
    : DATE_FORMAT.format(new Date(deck.updatedAt));

  return (
    <Link href={href} className="group block min-w-0" aria-label={`Open ${deck.name}`}>
      <article
        className={`interactive-card relative min-h-56 overflow-hidden rounded-lg border p-4 shadow-sm ${
          hasArt
            ? "border-black/20 bg-slate-950 text-white"
            : "border-border bg-white/88 text-text"
        }`}
      >
        {hasArt && (
          <>
            <div
              className="absolute inset-0 transition-transform duration-300 group-hover:scale-[1.03]"
              style={{
                backgroundImage: `url("${deck.featuredImage}")`,
                backgroundPosition: artCropLikely ? "center" : "center 18%",
                backgroundRepeat: "no-repeat",
                backgroundSize: artCropLikely ? "cover" : "119% auto",
              }}
              aria-hidden
            />
            <div
              className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,16,26,0.30),rgba(10,16,26,0.82)_58%,rgba(10,16,26,0.92))]"
              aria-hidden
            />
          </>
        )}
        <div className="relative flex min-h-32 flex-col">
          <div className="flex min-w-0 items-start gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">
                {deck.name}
              </h3>
              <div
                className={`mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 text-[11px] ${
                  hasArt ? "text-white/78" : "text-text-subtle"
                }`}
              >
                <span className="min-w-0">
                  {sourceLabel ? `${sourceLabel} · ${countsLabel}` : countsLabel}
                </span>
                <span className="justify-self-end text-right tabular-nums">
                  {viewsLabel}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-auto pt-5">
            <div className="mb-3 grid gap-2">
              <PublicManaCurve curve={deck.manaCurve} dark={hasArt} />
              <PublicColorBreakdown
                colors={deck.colorBreakdown}
                dark={hasArt}
              />
            </div>

            <div
              className={`mt-3 flex min-w-0 flex-wrap items-center justify-between gap-2 border-t pt-3 text-[11px] ${
                hasArt
                  ? "border-white/18 text-white/70"
                  : "border-border text-text-subtle"
              }`}
            >
              <span>{dateLabel}</span>
              <span className="ml-auto max-w-full truncate text-right">
                {deck.authorName}
              </span>
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}

function formatDeckViews(viewCount: number | undefined) {
  const count =
    typeof viewCount === "number" && Number.isFinite(viewCount)
      ? Math.max(0, Math.floor(viewCount))
      : 0;
  return `${count.toLocaleString()} view${count === 1 ? "" : "s"}`;
}

function PublicManaCurve({
  curve,
  dark,
}: {
  curve?: number[];
  dark: boolean;
}) {
  const buckets =
    Array.isArray(curve) && curve.length > 0 ? curve : [0, 0, 0, 0, 0, 0, 0, 0];
  const max = Math.max(1, ...buckets);
  return (
    <div
      className={`rounded-md border px-2 py-2 ${
        dark ? "border-white/16 bg-black/20" : "border-border bg-white/75"
      }`}
    >
      <div className="flex h-9 items-end gap-1">
        {buckets.map((count, index) => (
          <div key={index} className="flex min-w-0 flex-1 items-end">
            <div
              className={dark ? "w-full rounded-sm bg-white/72" : "accent-bar w-full rounded-sm"}
              style={{ height: `${(count / max) * 24 + 2}px` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function PublicColorBreakdown({
  colors,
  dark,
}: {
  colors?: DeckColorBreakdown;
  dark: boolean;
}) {
  const order: Array<keyof DeckColorBreakdown> = ["W", "U", "B", "R", "G", "C"];
  const values: DeckColorBreakdown = {
    W: colors?.W ?? 0,
    U: colors?.U ?? 0,
    B: colors?.B ?? 0,
    R: colors?.R ?? 0,
    G: colors?.G ?? 0,
    C: colors?.C ?? 0,
  };
  const swatches: Record<keyof DeckColorBreakdown, string> = {
    W: "var(--mana-w)",
    U: "var(--mana-u)",
    B: "var(--mana-b)",
    R: "var(--mana-r)",
    G: "var(--mana-g)",
    C: "#d7ddd9",
  };
  const total = order.reduce((sum, color) => sum + values[color], 0);

  return (
    <div
      className={`rounded-md border px-2 py-2 ${
        dark ? "border-white/16 bg-black/20" : "border-border bg-white/75"
      }`}
    >
      <div className="flex h-3 overflow-hidden rounded-full bg-white/25 ring-1 ring-black/5">
        {total === 0 ? (
          <div className="h-full w-full bg-white/40" />
        ) : (
          order.map((color) =>
            values[color] > 0 ? (
              <div
                key={color}
                style={{
                  width: `${(values[color] / total) * 100}%`,
                  background: swatches[color],
                }}
              />
            ) : null
          )
        )}
      </div>
    </div>
  );
}
