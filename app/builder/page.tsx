"use client";

import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useDecks } from "../lib/decks";
import {
  MAX_SIMILARITY_SEEDS,
  SearchPanel,
} from "../components/SearchPanel";
import { DeckPanel } from "../components/DeckPanel";
import { DeckSelector } from "../components/DeckSelector";
import { CardHover } from "../components/CardHover";
import { CardDetail } from "../components/CardDetail";
import { ExportButton } from "../components/ExportButton";
import { ImportButton } from "../components/ImportButton";
import { AuthButton } from "../components/AuthButton";
import { AppIcon } from "../components/AppIcon";
import { SettingsButton } from "../components/SettingsButton";
import { GuestTour } from "../components/GuestTour";
import { MobileAppHeader } from "../components/layout/MobileAppHeader";
import {
  MobileWorkspaceTabs,
  type MobileWorkspacePane,
} from "../components/layout/MobileWorkspaceTabs";
import { ResponsivePane } from "../components/layout/ResponsivePane";
import { useFinePointer, useIsWorkspaceDesktop } from "../hooks/useMediaQuery";
import type { ScryfallCard } from "../lib/types";
import { oracleIdForCard } from "../lib/cardIdentity";
import { getCardById } from "../lib/scryfall";
import { getOfflineCardById, resolveLinesOffline, useOfflineMode } from "../lib/offline";
import {
  PLAYTEST_MOBILE_WARNING,
  PLAYTEST_MOBILE_WARNING_QUERY_PARAM,
  isPlaytestSupportedViewport,
} from "../lib/playtestSupport";
import {
  OPEN_DECK_SELECTOR_QUERY_PARAM,
  SAVED_DECK_QUERY_PARAM,
} from "../lib/builderNavigation";

type HoverState = {
  src?: string;
  backSrc?: string;
  x: number;
  y: number;
};

const TOUR_SAMPLE_CARD_NAME = "Sol Ring";
const PUBLIC_DECK_QUERY_PARAM = "publicDeck";

function readTemporaryPublicDeckId(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get(
    PUBLIC_DECK_QUERY_PARAM
  );
  return value?.trim() || null;
}

function readSavedDeckId(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get(
    SAVED_DECK_QUERY_PARAM
  );
  return value?.trim() || null;
}

export default function Home() {
  const offline = useOfflineMode();
  const [temporaryPublicDeckId, setTemporaryPublicDeckId] = useState(
    readTemporaryPublicDeckId
  );
  const [requestedSavedDeckId, setRequestedSavedDeckId] = useState(
    readSavedDeckId
  );
  const decks = useDecks({
    offlineEnabled: offline.settings.enabled,
    offlineActive: offline.offlineActive,
    online: offline.online,
    temporaryPublicDeckId,
    onOfflineSyncingChange: offline.setSyncing,
    onPendingDeckChangesChange: offline.refreshPendingDeckChanges,
  });
  const [hover, setHover] = useState<HoverState | null>(null);
  const [selected, setSelected] = useState<ScryfallCard | null>(null);
  const [semanticRules, setSemanticRules] = useState(false);
  const [similaritySeeds, setSimilaritySeeds] = useState<ScryfallCard[]>([]);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [mobileHeaderOpen, setMobileHeaderOpen] = useState(false);
  const [playtestWarningVisible, setPlaytestWarningVisible] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobileWorkspacePane>("search");
  const [tourReplayKey, setTourReplayKey] = useState(0);
  const [tourSearchKey, setTourSearchKey] = useState(0);
  const [tourSelectResultKey, setTourSelectResultKey] = useState(0);
  const finePointer = useFinePointer();
  const workspaceDesktop = useIsWorkspaceDesktop();
  const canUseSemanticSearch = decks.isSignedIn && !offline.offlineActive;
  const active = decks.activeDeck;
  const activeIsTemporary = decks.activeDeckIsTemporary;
  const [leftPct, setLeftPct] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const showAccountRequired = useCallback(
    (action: string) => {
      decks.showNotice(
        `You need to log in or create a free account to ${action}.`
      );
    },
    [decks]
  );

  const clearBuilderRouteParams = useCallback((...params: string[]) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    let changed = false;
    for (const param of params) {
      if (!url.searchParams.has(param)) continue;
      url.searchParams.delete(param);
      changed = true;
    }
    if (!changed) return;
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(null, "", nextUrl || "/");
  }, []);

  const clearTemporaryDeckRoute = useCallback(() => {
    setTemporaryPublicDeckId(null);
    clearBuilderRouteParams(PUBLIC_DECK_QUERY_PARAM);
  }, [clearBuilderRouteParams]);

  useEffect(() => {
    function syncRouteDeckIds() {
      setTemporaryPublicDeckId(readTemporaryPublicDeckId());
      setRequestedSavedDeckId(readSavedDeckId());
    }
    window.addEventListener("popstate", syncRouteDeckIds);
    syncRouteDeckIds();
    return () => window.removeEventListener("popstate", syncRouteDeckIds);
  }, []);

  const missingTemporaryDeckRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      !temporaryPublicDeckId ||
      !decks.hydrated ||
      !decks.temporaryDeckNotFound ||
      missingTemporaryDeckRef.current === temporaryPublicDeckId
    ) {
      return;
    }
    missingTemporaryDeckRef.current = temporaryPublicDeckId;
    decks.showNotice("That public deck is no longer available.");
  }, [decks, temporaryPublicDeckId]);

  const handledOwnedPublicDeckRef = useRef<string | null>(null);
  useEffect(() => {
    const ownedDeckId = decks.temporaryDeckOwnedDeckId;
    if (
      !temporaryPublicDeckId ||
      !decks.hydrated ||
      !ownedDeckId ||
      handledOwnedPublicDeckRef.current === temporaryPublicDeckId
    ) {
      return;
    }

    handledOwnedPublicDeckRef.current = temporaryPublicDeckId;
    decks.setActive(ownedDeckId);
    clearBuilderRouteParams(PUBLIC_DECK_QUERY_PARAM);

    window.requestAnimationFrame(() => {
      setTemporaryPublicDeckId(null);
    });
  }, [clearBuilderRouteParams, decks, temporaryPublicDeckId]);

  const missingSavedDeckRef = useRef<string | null>(null);
  const handledSavedDeckRef = useRef<string | null>(null);
  useEffect(() => {
    if (!requestedSavedDeckId || !decks.hydrated) return;
    if (handledSavedDeckRef.current === requestedSavedDeckId) return;

    const savedDeckExists = decks.decks.some(
      (deck) => deck.id === requestedSavedDeckId
    );

    if (!savedDeckExists) {
      handledSavedDeckRef.current = requestedSavedDeckId;
      if (missingSavedDeckRef.current !== requestedSavedDeckId) {
        missingSavedDeckRef.current = requestedSavedDeckId;
        decks.showNotice("That deck is not available in your saved decks.");
      }
      clearBuilderRouteParams(SAVED_DECK_QUERY_PARAM);
      return;
    }

    handledSavedDeckRef.current = requestedSavedDeckId;
    if (decks.activeId !== requestedSavedDeckId) {
      decks.setActive(requestedSavedDeckId);
    }
    clearBuilderRouteParams(
      SAVED_DECK_QUERY_PARAM,
      PUBLIC_DECK_QUERY_PARAM
    );
  }, [clearBuilderRouteParams, decks, requestedSavedDeckId]);

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
      if (card) {
        setSelected(card);
      }
    } catch {
      // ignore — deck tile remains clickable but we silently fail the fetch
    }
  }, [offline.offlineActive]);

  const activeIdForCardData = activeIsTemporary ? null : decks.activeId;
  const refreshCardDataFn = decks.refreshCardData;
  const handleRefreshCardData = useCallback(() => {
    if (!activeIdForCardData) return;
    refreshCardDataFn(activeIdForCardData);
  }, [activeIdForCardData, refreshCardDataFn]);

  const handlePlaytestClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      if (!decks.isSignedIn) {
        event.preventDefault();
        setMobileHeaderOpen(false);
        showAccountRequired("playtest this deck");
        return;
      }

      if (isPlaytestSupportedViewport()) return;

      event.preventDefault();
      setMobileHeaderOpen(false);
      setPlaytestWarningVisible(true);
    },
    [decks.isSignedIn, showAccountRequired]
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(PLAYTEST_MOBILE_WARNING_QUERY_PARAM)) return;

    url.searchParams.delete(PLAYTEST_MOBILE_WARNING_QUERY_PARAM);
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(null, "", nextUrl || "/");

    const frame = window.requestAnimationFrame(() => {
      setPlaytestWarningVisible(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(OPEN_DECK_SELECTOR_QUERY_PARAM)) return;

    url.searchParams.delete(OPEN_DECK_SELECTOR_QUERY_PARAM);
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(null, "", nextUrl || "/");

    const frame = window.requestAnimationFrame(() => {
      setSelectorOpen(true);
      setMobileHeaderOpen(false);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  const handleToggleSimilaritySeed = useCallback(
    (card: ScryfallCard) => {
      if (!canUseSemanticSearch) {
        if (decks.isSignedIn) {
          decks.showNotice("Similarity search is unavailable while offline.");
        } else {
          showAccountRequired("use similarity search");
        }
        return;
      }

      const oracleId = oracleIdForCard(card);
      if (!oracleId) return;

      setSimilaritySeeds((seeds) => {
        if (seeds.some((seed) => oracleIdForCard(seed) === oracleId)) {
          return seeds.filter((seed) => oracleIdForCard(seed) !== oracleId);
        }
        if (seeds.length >= MAX_SIMILARITY_SEEDS) return seeds;
        return [...seeds, card];
      });
    },
    [canUseSemanticSearch, decks, showAccountRequired]
  );

  const handleRemoveSimilaritySeed = useCallback((oracleId: string) => {
    setSimilaritySeeds((seeds) =>
      seeds.filter((seed) => oracleIdForCard(seed) !== oracleId)
    );
  }, []);

  const handleSemanticRulesChange = useCallback(
    (enabled: boolean) => {
      if (enabled && !canUseSemanticSearch) {
        if (decks.isSignedIn) {
          decks.showNotice("Semantic search is unavailable while offline.");
        } else {
          showAccountRequired("use semantic search");
        }
        return;
      }
      setSemanticRules(enabled);
    },
    [canUseSemanticSearch, decks, showAccountRequired]
  );

  const { undo, redo, canUndo, canRedo } = decks;
  const closeMobileHeader = useCallback(() => {
    setMobileHeaderOpen(false);
  }, []);

  const openDeckSelector = useCallback(() => {
    setSelectorOpen(true);
    closeMobileHeader();
  }, [closeMobileHeader]);

  const handleSelectSavedDeck = useCallback(
    (id: string) => {
      clearTemporaryDeckRoute();
      decks.setActive(id);
    },
    [clearTemporaryDeckRoute, decks]
  );

  const handleCopyTemporaryDeck = useCallback(async () => {
    const copiedId = await decks.copyTemporaryDeck();
    if (copiedId) {
      clearTemporaryDeckRoute();
      setMobileHeaderOpen(false);
    }
  }, [clearTemporaryDeckRoute, decks]);

  const handleAddSearchCard = useCallback(
    (card: ScryfallCard) => {
      if (!active) return;
      if (activeIsTemporary) {
        decks.showNotice("Copy this temporary deck before making changes.");
        return;
      }
      decks.addCard(active.id, card);
    },
    [active, activeIsTemporary, decks]
  );

  const toggleMobileHeader = useCallback(() => {
    setMobileHeaderOpen((open) => !open);
  }, []);

  const handleUndo = useCallback(() => {
    if (canUndo) undo();
  }, [canUndo, undo]);
  const handleRedo = useCallback(() => {
    if (canRedo) redo();
  }, [canRedo, redo]);

  const handleTourStepChange = useCallback((stepId: string) => {
    if (
      stepId === "search" ||
      stepId === "semantic" ||
      stepId === "result" ||
      stepId === "preview"
    ) {
      setMobilePane("search");
    } else if (stepId === "deck") {
      setMobilePane("deck");
    }

    if (stepId === "search") {
      setSelected(null);
      setTourSearchKey((key) => key + 1);
    } else if (stepId === "result") {
      setTourSelectResultKey((key) => key + 1);
    }
  }, []);

  const handleReplayTour = useCallback(() => {
    setSelectorOpen(false);
    setMobileHeaderOpen(false);
    setTourReplayKey((key) => key + 1);
  }, []);

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

  const handlePreviewDeckQuantityChange = useCallback(
    (card: ScryfallCard, quantity: number) => {
      if (!active) return;
      if (activeIsTemporary) {
        decks.showNotice("Copy this temporary deck before making changes.");
        return;
      }
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
    [active, activeIsTemporary, decks]
  );

  const handleCommanderChange = useCallback(
    (card: ScryfallCard, isCommander: boolean) => {
      if (!active) return;
      if (activeIsTemporary) {
        decks.showNotice("Copy this temporary deck before making changes.");
        return;
      }
      decks.setCommander(active.id, isCommander ? card.id : null);
    },
    [active, activeIsTemporary, decks]
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

  const selectedOracleId = selected ? oracleIdForCard(selected) : undefined;
  const selectedIsSimilaritySeed =
    selectedOracleId !== undefined &&
    similaritySeeds.some((seed) => oracleIdForCard(seed) === selectedOracleId);
  const similaritySeedDisabled =
    selected !== null &&
    !selectedIsSimilaritySeed &&
    similaritySeeds.length >= MAX_SIMILARITY_SEEDS;
  const similaritySeedDisabledTitle = !canUseSemanticSearch
    ? decks.isSignedIn
      ? "Similarity search is unavailable while offline"
      : "Log in or create a free account to use similarity search"
    : similaritySeedDisabled
      ? "Remove a selected card before adding another"
      : undefined;
  const selectedDeckEntries =
    selected && active
      ? [
          ...active.entries,
          ...(active.sideboard ?? []),
          ...(active.maybeboard ?? []),
        ].filter((entry) => entry.cardId === selected.id)
      : [];
  const selectedDeckQuantity = selectedDeckEntries.reduce(
    (total, entry) => total + entry.quantity,
    0
  );
  const selectedIsCommander = selectedDeckEntries.some(
    (entry) => entry.isCommander === true
  );

  return (
    <div className="app-shell-bg flex min-h-0 flex-1 flex-col overflow-hidden">
      <header
        className="app-header shrink-0 px-3 py-2 sm:px-4 sm:py-3 lg:max-h-none lg:overflow-visible lg:py-3"
      >
        <div className="flex w-full min-w-0 flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <MobileAppHeader
            menuOpen={mobileHeaderOpen}
            onToggleMenu={toggleMobileHeader}
            onOpenDeckSelector={openDeckSelector}
            centerContent={
              <div className="mobile-workspace-menu-tabs lg:hidden">
                <MobileWorkspaceTabs
                  active={mobilePane}
                  onChange={setMobilePane}
                  placement="menu"
                  className="flex justify-center"
                />
              </div>
            }
            menuContent={
              <div className="mobile-header-deck-summary flex min-w-0 flex-col gap-2">
                {active ? (
                  <div className="mobile-menu-deck-row flex min-w-0 items-center gap-2">
                    {activeIsTemporary ? (
                      <>
                        <TemporaryDeckName name={active.name} />
                        <TemporaryDeckBadge />
                      </>
                    ) : (
                      <>
                        <DeckNameEditor
                          key={active.id}
                          name={active.name}
                          canRename={decks.canRenameDeck}
                          onRename={(n) => decks.renameDeck(active.id, n)}
                          onRenameBlocked={() =>
                            showAccountRequired("name and save this deck")
                          }
                        />
                        <PublicDeckButton
                          isPublic={active.isPublic}
                          canToggle={decks.canToggleDeckPublic}
                          onToggle={() =>
                            decks.setDeckPublic(active.id, !active.isPublic)
                          }
                          onBlocked={() =>
                            showAccountRequired("publish saved decks")
                          }
                        />
                        <ClearDeckButton
                          disabled={
                            active.entries.length === 0 &&
                            active.sideboard.length === 0 &&
                            active.maybeboard.length === 0
                          }
                          onClear={() => decks.clearDeck(active.id)}
                        />
                      </>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-text-subtle">No active deck</span>
                )}
              </div>
            }
            actions={
              <>
                {active && activeIsTemporary && (
                  <button
                    type="button"
                    onClick={handleCopyTemporaryDeck}
                    className="mobile-menu-action-full control-primary"
                  >
                    Copy deck
                  </button>
                )}
                {active && !activeIsTemporary && (
                  <div className="mobile-menu-action-cell">
                    <ImportButton
                      onImport={(entries, sideboard, maybeboard, mode) =>
                        decks.importEntries(
                          active.id,
                          entries,
                          sideboard,
                          maybeboard,
                          mode
                        )
                      }
                      onDeckNameHint={(name) => decks.renameDeck(active.id, name)}
                      resolveLines={
                        offline.offlineActive ? resolveLinesOffline : undefined
                      }
                    />
                  </div>
                )}
                {active && (
                  <div className="mobile-menu-action-cell">
                    <ExportButton
                      deck={active}
                      disabled={
                        active.entries.length === 0 &&
                        active.sideboard.length === 0 &&
                        active.maybeboard.length === 0
                      }
                    />
                  </div>
                )}
                {active && !activeIsTemporary && active.entries.length > 0 && (
                  <Link
                    href={`/play/?deck=${encodeURIComponent(active.id)}`}
                    onClick={handlePlaytestClick}
                    data-tour="tour-playtest"
                    className="mobile-menu-action-full control-primary"
                    title="Playtest this deck"
                  >
                    Playtest
                  </Link>
                )}
                <Link
                  href="/"
                  onClick={closeMobileHeader}
                  className="mobile-menu-action-cell control"
                  title="Browse public decks"
                >
                  Public decks
                </Link>
                {decks.isSignedIn && (
                  <div className="mobile-menu-action-cell">
                    <SettingsButton
                      offline={offline}
                      defaultDeckPublic={decks.defaultDeckPublic}
                      onDefaultDeckPublicChange={decks.setDefaultDeckPublic}
                      onReplayTour={handleReplayTour}
                    />
                  </div>
                )}
                <div className="mobile-menu-action-cell">
                  <AuthButton />
                </div>
              </>
            }
          />

          <div className="hidden w-full min-w-0 flex-col gap-2 lg:flex xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center">
              <button
                onClick={openDeckSelector}
                data-tour="tour-decks"
                className="header-brand-button shrink-0"
                aria-label="Open deck list"
                title="Your decks"
              >
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-xl bg-white p-1 shadow-sm ring-1 ring-border/70">
                  <AppIcon size={26} />
                </span>
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
                    {activeIsTemporary ? (
                      <>
                        <TemporaryDeckName name={active.name} />
                        <TemporaryDeckBadge />
                      </>
                    ) : (
                      <>
                        <DeckNameEditor
                          key={active.id}
                          name={active.name}
                          canRename={decks.canRenameDeck}
                          onRename={(n) => decks.renameDeck(active.id, n)}
                          onRenameBlocked={() =>
                            showAccountRequired("name and save this deck")
                          }
                        />
                        <PublicDeckButton
                          isPublic={active.isPublic}
                          canToggle={decks.canToggleDeckPublic}
                          onToggle={() =>
                            decks.setDeckPublic(active.id, !active.isPublic)
                          }
                          onBlocked={() =>
                            showAccountRequired("publish saved decks")
                          }
                        />
                        <ClearDeckButton
                          disabled={
                            active.entries.length === 0 &&
                            active.sideboard.length === 0 &&
                            active.maybeboard.length === 0
                          }
                          onClear={() => decks.clearDeck(active.id)}
                        />
                      </>
                    )}
                  </>
                ) : (
                  <span className="ml-1 text-sm text-text-subtle">
                    No active deck
                  </span>
                )}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-1.5 md:justify-end">
              {active && activeIsTemporary && (
                <button
                  type="button"
                  onClick={handleCopyTemporaryDeck}
                  className="control-primary"
                >
                  Copy deck
                </button>
              )}
              {active && !activeIsTemporary && (
                <ImportButton
                  onImport={(entries, sideboard, maybeboard, mode) =>
                    decks.importEntries(
                      active.id,
                      entries,
                      sideboard,
                      maybeboard,
                      mode
                    )
                  }
                  onDeckNameHint={(name) => decks.renameDeck(active.id, name)}
                  resolveLines={
                    offline.offlineActive ? resolveLinesOffline : undefined
                  }
                />
              )}
              {active && (
                <ExportButton
                  deck={active}
                  disabled={
                    active.entries.length === 0 &&
                    active.sideboard.length === 0 &&
                    active.maybeboard.length === 0
                  }
                />
              )}
              {active && !activeIsTemporary && active.entries.length > 0 && (
                <Link
                  href={`/play/?deck=${encodeURIComponent(active.id)}`}
                  onClick={handlePlaytestClick}
                  data-tour="tour-playtest"
                  className="control-primary"
                  title="Playtest this deck"
                >
                  Playtest
                </Link>
              )}
              <Link
                href="/"
                className="control"
                title="Browse public decks"
              >
                Public decks
              </Link>
              {active && (
                <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
              )}
              {decks.isSignedIn && (
                <SettingsButton
                  offline={offline}
                  defaultDeckPublic={decks.defaultDeckPublic}
                  onDefaultDeckPublicChange={decks.setDefaultDeckPublic}
                  onReplayTour={handleReplayTour}
                />
              )}
              <AuthButton tourId="tour-account" />
            </div>
          </div>
        </div>
      </header>

      {playtestWarningVisible && (
        <div
          role="alert"
          className="mx-3 mt-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm sm:mx-4 lg:mx-4"
        >
          <div className="flex min-w-0 items-start gap-3">
            <svg
              aria-hidden="true"
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.3 3.7 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
            <div className="min-w-0 flex-1">
              <div className="font-medium">Playtest unavailable on mobile</div>
              <div className="mt-1 text-amber-900">
                {PLAYTEST_MOBILE_WARNING}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPlaytestWarningVisible(false)}
              className="rounded-md px-1.5 py-0.5 text-amber-800 hover:bg-amber-100"
              aria-label="Dismiss playtest warning"
            >
              ×
            </button>
          </div>
        </div>
      )}

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
        onSelect={handleSelectSavedDeck}
        onCreate={decks.createDeck}
        onDelete={decks.deleteDeck}
        onTogglePublic={decks.setDeckPublic}
        canCreate={decks.canCreateDeck}
        canDelete={decks.canDeleteDeck}
        canTogglePublic={decks.canToggleDeckPublic}
        onCreateBlocked={() => showAccountRequired("create another deck")}
        onDeleteBlocked={() => showAccountRequired("manage saved decks")}
        onTogglePublicBlocked={() => showAccountRequired("publish saved decks")}
        footerLabel={decks.isSignedIn ? "Cloud synced" : "Local deck only"}
      />

      <main
        ref={containerRef}
        className="mobile-workspace-main flex min-h-0 flex-1 flex-col gap-2 px-2 py-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:gap-2 sm:px-3 sm:py-3 lg:flex-row lg:gap-4 lg:p-4 lg:pb-4"
      >
        <section
          data-tour="tour-preview"
          className="mobile-landscape-preview-pane workspace-panel rainbow-edge animate-panel min-h-0 min-w-0 flex-col overflow-hidden rounded-xl lg:hidden"
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
              similaritySeedDisabledTitle={similaritySeedDisabledTitle}
              offlineActive={offline.offlineActive}
              readOnly={activeIsTemporary}
              readOnlyReason="Copy this temporary deck before making changes"
            />
          ) : (
            <PreviewPlaceholder />
          )}
        </section>
        <section
          className="mobile-landscape-right-pane flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl lg:hidden"
        >
          <ResponsivePane
            mobileActive={mobilePane === "search"}
            tourId="tour-search"
            className="mobile-landscape-pane-content workspace-panel rainbow-edge animate-panel min-h-0 flex-1 flex-col overflow-hidden rounded-xl"
          >
            <div className="min-h-0 flex-1">
              <SearchPanel
                previewCardId={selected?.id ?? null}
                semanticRules={semanticRules}
                onSemanticRulesChange={handleSemanticRulesChange}
                canUseSemanticSearch={canUseSemanticSearch}
                offlineActive={offline.offlineActive}
                offlineReady={offline.cacheReady}
                similaritySeeds={similaritySeeds}
                onRemoveSimilaritySeed={handleRemoveSimilaritySeed}
                tourSearchName={TOUR_SAMPLE_CARD_NAME}
                tourSearchKey={tourSearchKey}
                tourSelectFirstResultKey={tourSelectResultKey}
                onTourSelectResult={setSelected}
                onSelect={(card) => {
                  setSelected(card);
                }}
                onAdd={handleAddSearchCard}
                onHover={(h) => setHover(h)}
              />
            </div>
          </ResponsivePane>

          <ResponsivePane
            mobileActive={mobilePane === "deck"}
            tourId="tour-deck"
            className="mobile-landscape-pane-content workspace-panel rainbow-edge animate-panel min-h-0 flex-1 flex-col overflow-hidden rounded-xl"
          >
            {active ? (
              <DeckPanel
                deck={active}
                readOnly={activeIsTemporary}
                previewCardId={selected?.id ?? null}
                onSetQty={(cardId, qty) =>
                  decks.setQuantity(active.id, cardId, qty)
                }
                onSetSideboardQty={(cardId, qty) =>
                  decks.setQuantity(active.id, cardId, qty, "sideboard")
                }
                onSetMaybeboardQty={(cardId, qty) =>
                  decks.setQuantity(active.id, cardId, qty, "maybeboard")
                }
                onMoveCard={(cardId, from, to) =>
                  decks.moveCard(active.id, cardId, from, to)
                }
                onSetCommander={(cardId, isCommander) =>
                  decks.setCommander(active.id, isCommander ? cardId : null)
                }
                onHover={(h) => setHover(h)}
                onSelect={handleDeckCardClick}
                onRefreshCardData={
                  activeIsTemporary ? undefined : handleRefreshCardData
                }
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-surface p-8 text-sm text-text-subtle">
                <div className="empty-pill rounded-full px-4 py-2">No active deck</div>
              </div>
            )}
          </ResponsivePane>
        </section>
        <section
          data-tour="tour-search"
          className="hidden workspace-panel rainbow-edge animate-panel min-h-0 flex-1 flex-col overflow-hidden rounded-lg lg:flex lg:flex-none"
          style={{ flexBasis: `${leftPct}%` }}
        >
          <SearchPanel
            previewCardId={selected?.id ?? null}
            semanticRules={semanticRules}
            onSemanticRulesChange={handleSemanticRulesChange}
            canUseSemanticSearch={canUseSemanticSearch}
            offlineActive={offline.offlineActive}
            offlineReady={offline.cacheReady}
            similaritySeeds={similaritySeeds}
            onRemoveSimilaritySeed={handleRemoveSimilaritySeed}
            tourSearchName={TOUR_SAMPLE_CARD_NAME}
            tourSearchKey={tourSearchKey}
            tourSelectFirstResultKey={tourSelectResultKey}
            onTourSelectResult={setSelected}
            onSelect={(card) => {
              setSelected(card);
            }}
            onAdd={handleAddSearchCard}
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
        <section
          className="hidden workspace-panel rainbow-edge animate-panel min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg lg:flex"
        >
          <div
            data-tour="tour-preview"
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
                similaritySeedDisabledTitle={similaritySeedDisabledTitle}
                offlineActive={offline.offlineActive}
                readOnly={activeIsTemporary}
                readOnlyReason="Copy this temporary deck before making changes"
              />
            ) : (
              <PreviewPlaceholder />
            )}
          </div>
          <div
            data-tour="tour-deck"
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            {active ? (
              <DeckPanel
                deck={active}
                readOnly={activeIsTemporary}
                previewCardId={selected?.id ?? null}
                onSetQty={(cardId, qty) =>
                  decks.setQuantity(active.id, cardId, qty)
                }
                onSetSideboardQty={(cardId, qty) =>
                  decks.setQuantity(active.id, cardId, qty, "sideboard")
                }
                onSetMaybeboardQty={(cardId, qty) =>
                  decks.setQuantity(active.id, cardId, qty, "maybeboard")
                }
                onMoveCard={(cardId, from, to) =>
                  decks.moveCard(active.id, cardId, from, to)
                }
                onSetCommander={(cardId, isCommander) =>
                  decks.setCommander(active.id, isCommander ? cardId : null)
                }
                onHover={(h) => setHover(h)}
                onSelect={handleDeckCardClick}
                onRefreshCardData={
                  activeIsTemporary ? undefined : handleRefreshCardData
                }
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
        visible={finePointer && !!hover?.src}
      />
      <GuestTour
        active={decks.isAnonymous && workspaceDesktop}
        replayKey={tourReplayKey}
        onStepChange={handleTourStepChange}
      />
    </div>
  );
}

function PublicDeckButton({
  isPublic,
  canToggle,
  onToggle,
  onBlocked,
}: {
  isPublic: boolean;
  canToggle: boolean;
  onToggle: () => void;
  onBlocked: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (canToggle) onToggle();
        else onBlocked();
      }}
      title={isPublic ? "Make private" : "Publish deck"}
      aria-label={isPublic ? "Make selected deck private" : "Publish selected deck"}
      className="deck-visibility-button control p-2 disabled:opacity-40"
    >
      {isPublic ? <PublicDeckIcon /> : <PrivateDeckIcon />}
    </button>
  );
}

function TemporaryDeckName({ name }: { name: string }) {
  return (
    <div
      className="min-w-48 flex-1 truncate rounded-md border border-amber-200 bg-amber-50/80 px-2 py-1.5 text-sm font-semibold text-amber-950"
      title={name}
    >
      {name}
    </div>
  );
}

function TemporaryDeckBadge() {
  return (
    <span
      className="header-meta-pill border-amber-200 bg-amber-50 text-amber-900"
      title="Temporary read-only deck preview"
    >
      Temporary
    </span>
  );
}

function PublicDeckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="10" cy="10" r="7" />
      <path d="M3 10h14M10 3c2 2.1 3 4.4 3 7s-1 4.9-3 7M10 3c-2 2.1-3 4.4-3 7s1 4.9 3 7" />
    </svg>
  );
}

function PrivateDeckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="8" width="12" height="8" rx="2" />
      <path d="M7 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

function DeckNameEditor({
  name,
  onRename,
  canRename = true,
  onRenameBlocked,
}: {
  name: string;
  onRename: (name: string) => void;
  canRename?: boolean;
  onRenameBlocked?: () => void;
}) {
  const [draft, setDraft] = useState({ source: name, value: name });
  const value = draft.source === name ? draft.value : name;
  function setValue(nextValue: string) {
    setDraft({ source: name, value: nextValue });
  }
  function commit() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) {
      setValue(name);
      return;
    }
    if (!canRename) {
      onRenameBlocked?.();
      setValue(name);
      return;
    }
    onRename(trimmed);
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
