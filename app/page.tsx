"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDecks } from "./lib/decks";
import { SearchPanel } from "./components/SearchPanel";
import { DeckPanel } from "./components/DeckPanel";
import { DeckSelector } from "./components/DeckSelector";
import { CardHover } from "./components/CardHover";
import { CardDetail } from "./components/CardDetail";
import { ExportButton } from "./components/ExportButton";
import type { ScryfallCard } from "./lib/types";
import { getCardById } from "./lib/scryfall";

type HoverState = {
  src?: string;
  backSrc?: string;
  x: number;
  y: number;
};

const SPLIT_KEY = "deckwright:split:v1";

export default function Home() {
  const decks = useDecks();
  const [hover, setHover] = useState<HoverState | null>(null);
  const [selected, setSelected] = useState<ScryfallCard | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [leftPct, setLeftPct] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const savedH = window.localStorage.getItem(SPLIT_KEY);
    if (savedH) {
      const n = Number(savedH);
      if (Number.isFinite(n) && n >= 20 && n <= 80) setLeftPct(n);
    }
  }, []);

  useEffect(() => {
    function endDrag() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.localStorage.setItem(SPLIT_KEY, String(leftPct));
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
      const card = await getCardById(cardId);
      if (card) setSelected(card);
    } catch {
      // ignore — deck tile remains clickable but we silently fail the fetch
    }
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

  if (!decks.hydrated) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-text-subtle">
        Loading…
      </div>
    );
  }

  const active = decks.activeDeck;

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSelectorOpen(true)}
            className="flex items-center gap-2 rounded-md border border-border bg-white px-2.5 py-1.5 text-sm text-text-muted transition hover:border-accent hover:text-accent"
            aria-label="Open deck list"
            title="Your decks"
          >
            <MenuIcon />
            <span className="hidden sm:inline">Decks</span>
            <span className="rounded-full bg-surface-subtle px-1.5 py-0.5 text-[10px] tabular-nums text-text-subtle">
              {decks.decks.length}
            </span>
          </button>
          {active ? (
            <>
              <DeckNameEditor
                key={active.id}
                name={active.name}
                onRename={(n) => decks.renameDeck(active.id, n)}
              />
              <select
                value={active.format}
                onChange={(e) => decks.setFormat(active.id, e.target.value)}
                className="rounded-md border border-border bg-white px-2 py-1 text-xs text-text-muted"
                aria-label="Deck format"
              >
                <option value="commander">Commander</option>
                <option value="standard">Standard</option>
                <option value="pioneer">Pioneer</option>
                <option value="modern">Modern</option>
                <option value="legacy">Legacy</option>
                <option value="vintage">Vintage</option>
                <option value="pauper">Pauper</option>
                <option value="casual">Casual</option>
              </select>
              <ClearDeckButton
                disabled={active.entries.length === 0}
                onClear={() => decks.clearDeck(active.id)}
              />
            </>
          ) : (
            <span className="ml-2 text-sm text-text-subtle">No active deck</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {active && (
            <ExportButton
              deck={active}
              disabled={active.entries.length === 0}
            />
          )}
          {active && active.entries.length > 0 && (
            <a
              href={`/play/${active.id}`}
              className="mr-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-accent-hover"
              title="Playtest this deck"
            >
              Playtest
            </a>
          )}
          <button
            onClick={handleUndo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            aria-label="Undo"
            className="rounded-md border border-border bg-white p-1.5 text-text-muted transition hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-muted"
          >
            <UndoIcon />
          </button>
          <button
            onClick={handleRedo}
            disabled={!canRedo}
            title="Redo (⌘⇧Z)"
            aria-label="Redo"
            className="rounded-md border border-border bg-white p-1.5 text-text-muted transition hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-muted"
          >
            <RedoIcon />
          </button>
        </div>
      </header>

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
        className="flex min-h-0 flex-1 flex-col lg:flex-row"
      >
        <section
          className="flex min-h-0 flex-1 flex-col border-b border-border lg:flex-none lg:border-b-0 lg:border-r"
          style={{ flexBasis: `${leftPct}%` }}
        >
          <SearchPanel
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
          className="group hidden shrink-0 cursor-col-resize items-stretch bg-border hover:bg-accent/30 lg:flex"
          style={{ width: 6 }}
        >
          <div className="m-auto h-12 w-[3px] rounded-full bg-border-strong transition-colors group-hover:bg-accent" />
        </div>
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            className="flex shrink-0 flex-col overflow-hidden border-b border-border"
            style={{ height: "40vh" }}
          >
            {selected ? (
              <CardDetail
                card={selected}
                onBack={() => setSelected(null)}
                onAdd={(card, qty) =>
                  active && decks.addCard(active.id, card, qty)
                }
              />
            ) : (
              <PreviewPlaceholder />
            )}
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {active ? (
              <DeckPanel
                deck={active}
                onSetQty={(cardId, qty) =>
                  decks.setQuantity(active.id, cardId, qty)
                }
                onHover={(h) => setHover(h)}
                onSelect={handleDeckCardClick}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-8 text-sm text-text-subtle">
                No active deck. Open the Decks menu to create one.
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
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
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
      className="ml-2 min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 text-base font-semibold tracking-tight outline-none transition hover:border-border focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20"
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
          className="rounded-md bg-[color:var(--danger)] px-2.5 py-1 text-xs font-medium text-white hover:brightness-110"
        >
          Clear deck
        </button>
        <button
          onClick={() => setConfirm(false)}
          className="rounded-md border border-border bg-white px-2 py-1 text-xs text-text-muted hover:text-text"
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
      className="rounded-md border border-border bg-white p-1.5 text-text-muted transition hover:border-[color:var(--danger)] hover:text-[color:var(--danger)] disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-muted"
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
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div className="flex flex-col items-center gap-3 text-text-subtle">
        <svg
          viewBox="0 0 40 40"
          width={40}
          height={40}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="opacity-60"
        >
          <rect x="9" y="5" width="22" height="30" rx="3" />
          <path d="M13 13h14M13 19h10" />
        </svg>
        <div className="text-sm">Click a search result to preview it here.</div>
      </div>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <path d="M4 6h12M4 10h12M4 14h12" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 8H14a3 3 0 0 1 0 6H8" />
      <path d="M10 5L6 8l4 3" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 8H6a3 3 0 0 0 0 6h6" />
      <path d="M10 5l4 3-4 3" />
    </svg>
  );
}
