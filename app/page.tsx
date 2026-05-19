"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useDecks } from "./lib/decks";
import {
  MAX_SIMILARITY_SEEDS,
  SearchPanel,
} from "./components/SearchPanel";
import { DeckPanel } from "./components/DeckPanel";
import { DeckSelector } from "./components/DeckSelector";
import { CardHover } from "./components/CardHover";
import { CardDetail } from "./components/CardDetail";
import { ExportButton } from "./components/ExportButton";
import { ImportButton } from "./components/ImportButton";
import { AuthButton } from "./components/AuthButton";
import { AppIcon } from "./components/AppIcon";
import { SettingsButton } from "./components/SettingsButton";
import type { ScryfallCard } from "./lib/types";
import { oracleIdForCard } from "./lib/cardIdentity";
import { getCardById } from "./lib/scryfall";
import { getOfflineCardById, resolveLinesOffline, useOfflineMode } from "./lib/offline";

type HoverState = {
  src?: string;
  backSrc?: string;
  x: number;
  y: number;
};

export default function Home() {
  const offline = useOfflineMode();
  const decks = useDecks({
    offlineEnabled: offline.settings.enabled,
    offlineActive: offline.offlineActive,
    online: offline.online,
    onOfflineSyncingChange: offline.setSyncing,
    onPendingDeckChangesChange: offline.refreshPendingDeckChanges,
  });
  const [hover, setHover] = useState<HoverState | null>(null);
  const [selected, setSelected] = useState<ScryfallCard | null>(null);
  const [semanticRules, setSemanticRules] = useState(false);
  const [similaritySeeds, setSimilaritySeeds] = useState<ScryfallCard[]>([]);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [leftPct, setLeftPct] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    function endDrag() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    function onMove(e: MouseEvent) {
      if (!draggingRef.current) return;
      // If the mouse button was released outside the window, mouseup never
      // fired — detect that here so drags can't silently persist and hijack
      // subsequent motion (e.g. typing in the search input).
      if (e.buttons === 0) {
        endDrag();
        return;
      }
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.max(20, Math.min(80, pct)));
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("blur", endDrag);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", endDrag);
      window.removeEventListener("blur", endDrag);
    };
  }, [leftPct]);

  function startResize() {
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  const handleDeckCardClick = useCallback(async (cardId: string) => {
    try {
      const card = offline.offlineActive
        ? await getOfflineCardById(cardId)
        : await getCardById(cardId);
      if (card) setSelected(card);
    } catch {
      // ignore — deck tile remains clickable but we silently fail the fetch
    }
  }, [offline.offlineActive]);

  const activeIdForCardData = decks.activeId;
  const refreshCardDataFn = decks.refreshCardData;
  const handleRefreshCardData = useCallback(() => {
    if (!activeIdForCardData) return;
    refreshCardDataFn(activeIdForCardData);
  }, [activeIdForCardData, refreshCardDataFn]);

  const handleToggleSimilaritySeed = useCallback((card: ScryfallCard) => {
    const oracleId = oracleIdForCard(card);
    if (!oracleId) return;

    setSimilaritySeeds((seeds) => {
      if (seeds.some((seed) => oracleIdForCard(seed) === oracleId)) {
        return seeds.filter((seed) => oracleIdForCard(seed) !== oracleId);
      }
      if (seeds.length >= MAX_SIMILARITY_SEEDS) return seeds;
      return [...seeds, card];
    });
  }, []);

  const handleRemoveSimilaritySeed = useCallback((oracleId: string) => {
    setSimilaritySeeds((seeds) =>
      seeds.filter((seed) => oracleIdForCard(seed) !== oracleId)
    );
  }, []);

  const { undo, redo, canUndo, canRedo } = decks;

  const handleUndo = useCallback(() => {
    if (canUndo) undo();
  }, [canUndo, undo]);
  const handleRedo = useCallback(() => {
    if (canRedo) redo();
  }, [canRedo, redo]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // Don't hijack editing inside text inputs that handle their own undo
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const editable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (t && (t as HTMLElement).isContentEditable);
      if (editable) return;
      if (e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if (e.key.toLowerCase() === "y" && !e.shiftKey) {
        e.preventDefault();
        handleRedo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleUndo, handleRedo]);

  const active = decks.activeDeck;
  const handlePreviewDeckQuantityChange = useCallback(
    (card: ScryfallCard, quantity: number) => {
      if (!active) return;
      const safeQuantity = Math.max(0, Math.min(255, Math.floor(quantity)));
      const current = active.entries.find((entry) => entry.cardId === card.id);

      if (current) {
        decks.setQuantity(active.id, card.id, safeQuantity);
        return;
      }

      if (safeQuantity > 0) {
        decks.addCard(active.id, card, safeQuantity);
      }
    },
    [active, decks]
  );

  const handleCommanderChange = useCallback(
    (card: ScryfallCard, isCommander: boolean) => {
      if (!active) return;
      decks.setCommander(active.id, isCommander ? card.id : null);
    },
    [active, decks]
  );

  if (!decks.hydrated) {
    return (
      <div className="app-shell-bg flex min-h-0 flex-1 items-center justify-center p-8 text-sm text-text-subtle">
        <div className="empty-pill flex items-center gap-3 rounded-full px-4 py-2">
          <span className="accent-dot h-2.5 w-2.5 animate-pulse rounded-full" />
          Loading deck workspace
        </div>
      </div>
    );
  }

  if (!decks.isAuthenticated) {
    return (
      <div className="app-shell-bg flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="workspace-panel rainbow-edge animate-panel flex w-full max-w-md flex-col items-center gap-5 overflow-hidden rounded-lg px-8 py-10 text-center">
          <AppIcon size={56} className="shadow-sm" />
          <div>
            <h1 className="text-2xl font-semibold text-text">
              magicaldeckgatherer
            </h1>
            <p className="mt-2 text-sm leading-6 text-text-muted">
              A focused Magic deck workspace with saved decks, card search, and
              playtesting.
            </p>
          </div>
          <AuthButton />
        </div>
      </div>
    );
  }

  const activeCardCount =
    active?.entries.reduce((n, entry) => n + entry.quantity, 0) ?? 0;
  const activeSideboardCount =
    active?.sideboard.reduce((n, entry) => n + entry.quantity, 0) ?? 0;
  const selectedOracleId = selected ? oracleIdForCard(selected) : undefined;
  const selectedIsSimilaritySeed =
    selectedOracleId !== undefined &&
    similaritySeeds.some((seed) => oracleIdForCard(seed) === selectedOracleId);
  const similaritySeedDisabled =
    selected !== null &&
    !selectedIsSimilaritySeed &&
    similaritySeeds.length >= MAX_SIMILARITY_SEEDS;
  const selectedDeckEntry = selected
    ? active?.entries.find((entry) => entry.cardId === selected.id)
    : undefined;
  const selectedDeckQuantity = selectedDeckEntry?.quantity ?? 0;
  const selectedIsCommander = selectedDeckEntry?.isCommander === true;

  return (
    <div className="app-shell-bg flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="app-header shrink-0 px-3 py-3 sm:px-4">
        <div className="flex w-full min-w-0 flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center">
            <button
              onClick={() => setSelectorOpen(true)}
              className="header-brand-button shrink-0"
              aria-label="Open deck list"
              title="Your decks"
            >
              <AppIcon size={34} className="shadow-sm ring-1 ring-border/70" />
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-normal text-text">
                  magicaldeckgatherer
                </div>
                <div className="text-[11px] font-medium text-text-subtle">
                  MTG deck workspace
                </div>
              </div>
            </button>

            <div className="hidden h-8 w-px bg-border md:block" />

            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {active ? (
                <>
                  <DeckNameEditor
                    key={active.id}
                    name={active.name}
                    onRename={(n) => decks.renameDeck(active.id, n)}
                  />
                  <span className="header-meta-pill">
                    <span className="tabular-nums">{activeCardCount}</span>
                    <span>cards</span>
                  </span>
                  <span className="header-meta-pill">
                    <span className="tabular-nums">{activeSideboardCount}</span>
                    <span>sideboard</span>
                  </span>
                  <ClearDeckButton
                    disabled={
                      active.entries.length === 0 &&
                      active.sideboard.length === 0
                    }
                    onClear={() => decks.clearDeck(active.id)}
                  />
                </>
              ) : (
                <span className="ml-1 text-sm text-text-subtle">
                  No active deck
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5 md:justify-end">
            {active && (
              <ImportButton
                onImport={(entries, sideboard, mode) =>
                  decks.importEntries(active.id, entries, sideboard, mode)
                }
                onDeckNameHint={(name) => decks.renameDeck(active.id, name)}
                resolveLines={offline.offlineActive ? resolveLinesOffline : undefined}
              />
            )}
            {active && (
              <ExportButton
                deck={active}
                disabled={
                  active.entries.length === 0 &&
                  active.sideboard.length === 0
                }
              />
            )}
            {active && active.entries.length > 0 && (
              <Link
                href={`/play/?deck=${encodeURIComponent(active.id)}`}
                className="control-primary"
                title="Playtest this deck"
              >
                Playtest
              </Link>
            )}
            {active && (
              <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
            )}
            <SettingsButton offline={offline} />
            <AuthButton />
          </div>
        </div>
      </header>

      {decks.notice && (
        <div
          role="status"
          className="flex items-center justify-between border-b border-amber-200 bg-amber-50/90 px-4 py-2 text-xs text-amber-900 shadow-sm"
        >
          <span>{decks.notice}</span>
          <button
            onClick={decks.clearNotice}
            className="rounded px-1.5 py-0.5 text-amber-800 hover:bg-amber-100"
            aria-label="Dismiss notice"
          >
            ×
          </button>
        </div>
      )}

      <DeckSelector
        open={selectorOpen}
        onClose={() => setSelectorOpen(false)}
        decks={decks.decks}
        activeId={decks.activeId}
        onSelect={decks.setActive}
        onCreate={decks.createDeck}
        onDelete={decks.deleteDeck}
      />

      <main
        ref={containerRef}
        className="flex min-h-0 flex-1 flex-col gap-3 p-2 sm:p-3 lg:flex-row lg:gap-4 lg:p-4"
      >
        <section
          className="workspace-panel rainbow-edge animate-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg lg:flex-none"
          style={{ flexBasis: `${leftPct}%` }}
        >
          <SearchPanel
            previewCardId={selected?.id ?? null}
            semanticRules={semanticRules}
            onSemanticRulesChange={setSemanticRules}
            offlineActive={offline.offlineActive}
            offlineReady={offline.cacheReady}
            similaritySeeds={similaritySeeds}
            onRemoveSimilaritySeed={handleRemoveSimilaritySeed}
            onSelect={(card) => setSelected(card)}
            onAdd={(card) => active && decks.addCard(active.id, card)}
            onHover={(h) => setHover(h)}
          />
        </section>
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            startResize();
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize search and deck panels"
          className="group -mx-2 hidden shrink-0 cursor-col-resize items-stretch rounded-full transition hover:bg-white/60 lg:flex"
          style={{ width: 10 }}
        >
          <div className="m-auto h-14 w-[3px] rounded-full bg-border-strong transition-colors group-hover:bg-[image:var(--rainbow)]" />
        </div>
        <section className="workspace-panel rainbow-edge animate-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg">
          <div
            className="flex shrink-0 flex-col overflow-hidden border-b border-border"
            style={selected ? undefined : { height: "var(--workspace-top-height)" }}
          >
            {selected ? (
              <CardDetail
                card={selected}
                onBack={() => setSelected(null)}
                deckQuantity={selectedDeckQuantity}
                onDeckQuantityChange={handlePreviewDeckQuantityChange}
                isCommander={selectedIsCommander}
                onCommanderChange={handleCommanderChange}
                onToggleSimilaritySeed={handleToggleSimilaritySeed}
                isSimilaritySeed={selectedIsSimilaritySeed}
                similaritySeedDisabled={similaritySeedDisabled}
                offlineActive={offline.offlineActive}
              />
            ) : (
              <PreviewPlaceholder />
            )}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {active ? (
              <DeckPanel
                deck={active}
                previewCardId={selected?.id ?? null}
                onSetQty={(cardId, qty) =>
                  decks.setQuantity(active.id, cardId, qty)
                }
                onSetSideboardQty={(cardId, qty) =>
                  decks.setQuantity(active.id, cardId, qty, "sideboard")
                }
                onMoveCard={(cardId, to) =>
                  decks.moveCard(active.id, cardId, to)
                }
                onSetCommander={(cardId, isCommander) =>
                  decks.setCommander(active.id, isCommander ? cardId : null)
                }
                onHover={(h) => setHover(h)}
                onSelect={handleDeckCardClick}
                onRefreshCardData={handleRefreshCardData}
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-surface p-8 text-sm text-text-subtle">
                <div className="empty-pill rounded-full px-4 py-2">No active deck</div>
              </div>
            )}
          </div>
        </section>
      </main>

      <CardHover
        src={hover?.src}
        backSrc={hover?.backSrc}
        x={hover?.x ?? 0}
        y={hover?.y ?? 0}
        visible={!!hover?.src}
      />
    </div>
  );
}

function DeckNameEditor({
  name,
  onRename,
}: {
  name: string;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState({ source: name, value: name });
  const value = draft.source === name ? draft.value : name;
  function setValue(nextValue: string) {
    setDraft({ source: name, value: nextValue });
  }
  function commit() {
    const trimmed = value.trim();
    if (trimmed && trimmed !== name) onRename(trimmed);
    else setValue(name);
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        else if (e.key === "Escape") {
          setValue(name);
          (e.target as HTMLInputElement).blur();
        }
      }}
      aria-label="Deck name"
      className="min-w-48 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm font-semibold outline-none transition hover:border-border hover:bg-white focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/15"
    />
  );
}

function ClearDeckButton({
  disabled,
  onClear,
}: {
  disabled: boolean;
  onClear: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  if (confirm) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => {
            onClear();
            setConfirm(false);
          }}
          className="rounded-lg bg-[color:var(--danger)] px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:-translate-y-0.5 hover:brightness-110"
        >
          Clear deck
        </button>
        <button
          onClick={() => setConfirm(false)}
          className="control px-2.5 py-1.5 text-xs"
        >
          Cancel
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={() => setConfirm(true)}
      disabled={disabled}
      title="Remove all cards"
      aria-label="Remove all cards"
      className="control p-2 hover:border-[color:var(--danger)] hover:text-[color:var(--danger)] disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-surface-raised disabled:hover:text-text-muted"
    >
      <TrashIcon />
    </button>
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

function PreviewPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center bg-surface p-8 text-center">
      <div className="flex flex-col items-center gap-3 text-text-subtle">
        <div className="empty-pill flex h-14 w-14 items-center justify-center rounded-full">
          <svg
            viewBox="0 0 40 40"
            width={34}
            height={34}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="opacity-70"
          >
            <rect x="9" y="5" width="22" height="30" rx="3" />
            <path d="M13 13h14M13 19h10" />
          </svg>
        </div>
        <div>
          <div className="text-sm font-medium text-text-muted">
            No card selected
          </div>
          <div className="mt-1 text-xs">Card details appear here.</div>
        </div>
      </div>
    </div>
  );
}
