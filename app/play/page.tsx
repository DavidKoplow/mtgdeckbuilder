"use client";

import { Suspense, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useDeck } from "../lib/decks";
import {
  PlayCard,
  Zone,
  usePlaytest,
} from "../lib/playtest";
import { PlayCardView } from "../components/playtest/PlayCardView";
import {
  MulliganBottomModal,
  ScryModal,
  ScryPrompt,
  SearchModal,
  TokenCreator,
} from "../components/playtest/Modals";
import { CardHover } from "../components/CardHover";
import { AuthButton } from "../components/AuthButton";
import { AppIcon } from "../components/AppIcon";
import type { Deck } from "../lib/types";

type Hover = { src?: string; x: number; y: number } | null;

function isLand(typeLine: string | undefined): boolean {
  return !!typeLine && /\bland\b/i.test(typeLine);
}

function PlayPageContent() {
  const searchParams = useSearchParams();
  const deckId = searchParams.get("deck") ?? "";
  const { deck, hydrated, isAuthenticated } = useDeck(deckId || null);

  if (!hydrated) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-bg p-8 text-sm text-text-subtle">
        <div className="flex items-center gap-3 rounded-full border border-border bg-white px-4 py-2 shadow-sm">
          <span className="accent-dot h-2.5 w-2.5 animate-pulse rounded-full" />
          Loading playtest
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-sm text-text-muted">
        <p>Sign in to playtest cloud decks.</p>
        <AuthButton />
      </div>
    );
  }

  if (!deckId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-sm text-text-muted">
        <p>No deck selected.</p>
        <Link href="/" className="text-accent hover:underline">
          Back to builder
        </Link>
      </div>
    );
  }

  if (!deck) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-sm text-text-muted">
        <p>Deck not found.</p>
        <Link href="/" className="text-accent hover:underline">
          Back to builder
        </Link>
      </div>
    );
  }

  if (deck.entries.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-sm text-text-muted">
        <p>This deck has no cards to play with.</p>
        <Link href="/" className="text-accent hover:underline">
          Back to builder
        </Link>
      </div>
    );
  }

  return <Playtest deck={deck} />;
}

export default function PlayPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Suspense
        fallback={
          <div className="flex min-h-0 flex-1 items-center justify-center bg-bg p-8 text-sm text-text-subtle">
            <div className="flex items-center gap-3 rounded-full border border-border bg-white px-4 py-2 shadow-sm">
              <span className="accent-dot h-2.5 w-2.5 animate-pulse rounded-full" />
              Loading playtest
            </div>
          </div>
        }
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <PlayPageContent />
        </div>
      </Suspense>
    </div>
  );
}

function Playtest({ deck }: { deck: Deck }) {
  const pt = usePlaytest(deck);
  const { state } = pt;
  const [hover, setHover] = useState<Hover>(null);
  const [scryPromptOpen, setScryPromptOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);

  const isCommander = deck.format === "commander";

  function onHover(src: string | undefined, x: number, y: number) {
    setHover(src ? { src, x, y } : null);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg">
      <header className="soft-divider flex shrink-0 flex-wrap items-center justify-between gap-3 bg-surface-raised px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/"
            className="control flex items-center gap-2 px-3 py-2 text-sm"
          >
            <AppIcon size={20} className="rounded-md" />
            Builder
          </Link>
          <div className="min-w-0 truncate text-sm font-semibold">
            {deck.name}
          </div>
          <span className="rounded-full border border-border bg-white px-2.5 py-1 text-[11px] capitalize text-text-subtle">
            {deck.format}
          </span>
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-sm">
          <LifeCounter life={state.life} onDelta={pt.lifeDelta} onSet={pt.setLife} />
          <div className="flex items-center gap-1 rounded-lg border border-border bg-white px-2 py-1 text-xs">
            <span className="text-text-muted">Turn</span>
            <span className="font-semibold tabular-nums">{state.turn}</span>
            <button
              onClick={pt.endTurn}
              className="control ml-2 px-2 py-1 text-[11px]"
              title="End turn (untaps all)"
            >
              End turn
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <ToolButton onClick={() => pt.draw(1)}>Draw</ToolButton>
            <ToolButton onClick={pt.shuffleLib}>Shuffle</ToolButton>
            <ToolButton onClick={pt.untapAll}>Untap all</ToolButton>
            <ToolButton onClick={() => setScryPromptOpen(true)}>Scry</ToolButton>
            <ToolButton onClick={() => pt.searchOpen("hand")}>Search</ToolButton>
            <ToolButton onClick={() => setTokenOpen(true)}>Token</ToolButton>
            <ToolButton
              onClick={() => pt.newGame(isCommander ? 40 : 20)}
              danger
            >
              New game
            </ToolButton>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 bg-bg p-3">
        {/* Battlefield */}
        <DropZone
          to="battlefield"
          onDrop={(from, id) => pt.move(id, from, "battlefield")}
          className="workspace-panel relative flex flex-1 flex-col overflow-auto rounded-xl p-4"
        >
          <ZoneHeader label="Battlefield" count={state.battlefield.length} />
          {(() => {
            const lands = state.battlefield.filter((c) => isLand(c.typeLine));
            const nonLands = state.battlefield.filter(
              (c) => !isLand(c.typeLine)
            );
            return (
              <div className="mt-2 flex flex-1 flex-col gap-4">
                <div className="flex flex-wrap content-start gap-3">
                  {nonLands.map((c) => (
                    <div key={c.instanceId} className="group">
                      <PlayCardView
                        card={c}
                        zone="battlefield"
                        onTap={() => pt.tapToggle(c.instanceId)}
                        onMove={(to) =>
                          pt.move(c.instanceId, "battlefield", to)
                        }
                        onCounter={(kind, delta) =>
                          pt.counter(c.instanceId, kind, delta)
                        }
                        onHover={onHover}
                      />
                    </div>
                  ))}
                  {state.battlefield.length === 0 && (
                    <div className="rounded-full border border-border bg-surface-raised px-4 py-2 text-xs text-text-subtle shadow-sm">
                      Battlefield empty
                    </div>
                  )}
                </div>
                <div className="mt-auto flex flex-col gap-2 rounded-xl bg-surface-raised p-3 ring-1 ring-border/70">
                  <span className="text-[11px] font-semibold uppercase text-text-muted">
                    Lands <span className="text-text-subtle tabular-nums">{lands.length}</span>
                  </span>
                  <div className="flex flex-wrap content-start gap-3">
                    {lands.map((c) => (
                      <div key={c.instanceId} className="group">
                        <PlayCardView
                          card={c}
                          zone="battlefield"
                          onTap={() => pt.tapToggle(c.instanceId)}
                          onMove={(to) =>
                            pt.move(c.instanceId, "battlefield", to)
                          }
                          onCounter={(kind, delta) =>
                            pt.counter(c.instanceId, kind, delta)
                          }
                          onHover={onHover}
                        />
                      </div>
                    ))}
                    {lands.length === 0 && (
                      <div className="px-1 text-xs text-text-subtle">
                        No lands in play
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </DropZone>

        {/* Hand + zones */}
        <section className="workspace-panel flex flex-none flex-col gap-2 rounded-xl bg-surface p-3">
          <div className="flex items-start gap-4">
            <div className="flex flex-1 flex-col">
              <ZoneHeader label="Hand" count={state.hand.length} />
              <DropZone
                to="hand"
                onDrop={(from, id) => pt.move(id, from, "hand")}
                className="thin-scroll mt-2 flex min-h-[300px] gap-2 overflow-x-auto rounded-xl bg-surface-raised p-2"
              >
                {state.hand.map((c) => (
                  <PlayCardView
                    key={c.instanceId}
                    card={c}
                    zone="hand"
                    width={200}
                    onMove={(to) => pt.move(c.instanceId, "hand", to)}
                    onHover={onHover}
                  />
                ))}
                {state.hand.length === 0 && (
                  <div className="px-2 py-2 text-xs text-text-subtle">
                    Hand is empty.
                  </div>
                )}
              </DropZone>
            </div>

            <StackZone
              label="Library"
              cards={state.library}
              facedown
              onHover={onHover}
              onDropFrom={(from, id) =>
                pt.move(id, from, "library", "top")
              }
              extra={
                <button
                  onClick={() => pt.draw(1)}
                  className="control mt-1 w-full px-2 py-1.5 text-xs"
                >
                  Draw 1
                </button>
              }
            />
            <StackZone
              label="Graveyard"
              cards={state.graveyard}
              onHover={onHover}
              onDropFrom={(from, id) => pt.move(id, from, "graveyard")}
              onMoveTop={(to) => {
                const top = state.graveyard[state.graveyard.length - 1];
                if (top) pt.move(top.instanceId, "graveyard", to);
              }}
            />
            <StackZone
              label="Exile"
              cards={state.exile}
              onHover={onHover}
              onDropFrom={(from, id) => pt.move(id, from, "exile")}
              onMoveTop={(to) => {
                const top = state.exile[state.exile.length - 1];
                if (top) pt.move(top.instanceId, "exile", to);
              }}
            />
          </div>
        </section>
      </main>

      {/* Modals */}
      {state.phase === "mulligan-deciding" && (
        <MulliganPrompt
          mulligansTaken={state.mulligansTaken}
          handSize={state.hand.length}
          onKeep={pt.keepHand}
          onMulligan={pt.mulligan}
        />
      )}

      {state.phase === "mulligan-bottoming" && (
        <MulliganBottomModal
          hand={state.hand}
          count={Math.min(state.mulligansTaken, state.hand.length)}
          onConfirm={pt.bottomCards}
        />
      )}

      {state.search && (
        <SearchModal
          library={state.library}
          dest={state.search.dest}
          onPick={pt.searchPick}
          onCancel={pt.searchCancel}
        />
      )}

      {scryPromptOpen && !state.scry && (
        <ScryPrompt
          onCancel={() => setScryPromptOpen(false)}
          onChoose={(n) => {
            setScryPromptOpen(false);
            pt.scryStart(n);
          }}
        />
      )}
      {state.scry && (
        <ScryModal
          cards={state.scry}
          onFinish={pt.scryFinish}
          onCancel={() => pt.scryFinish([], state.scry!.map((c) => c.instanceId))}
        />
      )}

      <TokenCreator
        open={tokenOpen}
        onClose={() => setTokenOpen(false)}
        onCreate={pt.addToken}
      />

      <CardHover
        src={hover?.src}
        x={hover?.x ?? 0}
        y={hover?.y ?? 0}
        visible={!!hover?.src}
      />
    </div>
  );
}

function ToolButton({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${
        danger
          ? "border-border bg-white text-text-muted hover:border-[color:var(--danger)] hover:text-[color:var(--danger)]"
          : "border-border bg-white text-text-muted hover:border-border-strong hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function ZoneHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[11px] font-semibold uppercase text-text-muted">
        {label}
      </span>
      <span className="text-[11px] text-text-subtle tabular-nums">
        {count}
      </span>
    </div>
  );
}

function StackZone({
  label,
  cards,
  facedown,
  onHover,
  onMoveTop,
  onDropFrom,
  extra,
}: {
  label: string;
  cards: PlayCard[];
  facedown?: boolean;
  onHover: (src: string | undefined, x: number, y: number) => void;
  onMoveTop?: (to: Zone) => void;
  onDropFrom?: (from: Zone, instanceId: string) => void;
  extra?: React.ReactNode;
}) {
  const top = cards[cards.length - 1];
  const hoverSrc = facedown ? undefined : top?.imageNormal;
  const zoneName = label.toLowerCase() as Zone;
  return (
    <div className="flex w-[220px] shrink-0 flex-col gap-1">
      <ZoneHeader label={label} count={cards.length} />
      <DropZone
        to={zoneName}
        onDrop={(from, id) => onDropFrom?.(from, id)}
        className="relative h-[280px] w-[200px] rounded-xl bg-surface-raised shadow-sm ring-1 ring-border"
        onMouseEnter={(e) => onHover(hoverSrc, e.clientX, e.clientY)}
        onMouseMove={(e) => onHover(hoverSrc, e.clientX, e.clientY)}
        onMouseLeave={() => onHover(undefined, 0, 0)}
      >
        {cards.length === 0 ? (
          <div className="flex h-full w-full items-center justify-center rounded-xl bg-surface-subtle text-xs text-text-subtle">
            Empty
          </div>
        ) : facedown ? (
          <div className="flex h-full w-full items-center justify-center rounded-xl bg-[radial-gradient(circle_at_35%_25%,#384841,#17201d)] text-xl font-semibold text-white/80">
            {cards.length}
          </div>
        ) : top?.imageNormal ? (
          <img
            src={top.imageNormal}
            alt={top.name}
            className="h-full w-full rounded-xl object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-xl bg-surface-subtle px-1 text-center text-xs">
            {top?.name}
          </div>
        )}
      </DropZone>
      {onMoveTop && cards.length > 0 && (
        <select
          onChange={(e) => {
            const v = e.target.value as Zone | "";
            if (v) onMoveTop(v);
            e.currentTarget.value = "";
          }}
          defaultValue=""
          className="control px-2 py-1.5 text-xs"
        >
          <option value="" disabled>
            Move top…
          </option>
          <option value="hand">→ Hand</option>
          <option value="battlefield">→ Battlefield</option>
          <option value="library">→ Library top</option>
          {label !== "Graveyard" && <option value="graveyard">→ Graveyard</option>}
          {label !== "Exile" && <option value="exile">→ Exile</option>}
        </select>
      )}
      {extra}
    </div>
  );
}

function DropZone({
  to,
  onDrop,
  className,
  children,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
}: {
  to: Zone;
  onDrop: (from: Zone, instanceId: string) => void;
  className?: string;
  children: React.ReactNode;
  onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
  onMouseMove?: React.MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  return (
    <div
      className={`${className ?? ""} ${
        over ? "outline outline-2 outline-accent/70 outline-offset-2" : ""
      }`}
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const raw = e.dataTransfer.getData("application/x-playcard");
        if (!raw) return;
        try {
          const { instanceId, from } = JSON.parse(raw) as {
            instanceId: string;
            from: Zone;
          };
          if (from && instanceId && from !== to) onDrop(from, instanceId);
        } catch {
          // ignore malformed drops
        }
      }}
    >
      {children}
    </div>
  );
}

function LifeCounter({
  life,
  onDelta,
  onSet,
}: {
  life: number;
  onDelta: (d: number) => void;
  onSet: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-white px-2 py-1 text-xs">
      <span className="text-text-muted">Life</span>
      <button
        onClick={() => onDelta(-1)}
        className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-subtle hover:bg-border"
        aria-label="Lose 1 life"
      >
        −
      </button>
      <input
        type="number"
        value={life}
        onChange={(e) => onSet(Number(e.target.value) || 0)}
        className="w-12 rounded-md border border-border bg-white px-1 py-0.5 text-center text-sm font-semibold tabular-nums outline-none focus:border-accent"
      />
      <button
        onClick={() => onDelta(+1)}
        className="accent-fill flex h-6 w-6 items-center justify-center rounded-md"
        aria-label="Gain 1 life"
      >
        +
      </button>
    </div>
  );
}

function MulliganPrompt({
  mulligansTaken,
  handSize,
  onKeep,
  onMulligan,
}: {
  mulligansTaken: number;
  handSize: number;
  onKeep: () => void;
  onMulligan: () => void;
}) {
  return (
    <div className="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-full bg-white px-4 py-2 shadow-lg ring-1 ring-black/10">
      <span className="text-sm text-text-muted">
        {mulligansTaken === 0
          ? "Opening hand"
          : `Mulligan ${mulligansTaken}`}
        {" · "}
        <span className="font-semibold text-text">{handSize} cards</span>
      </span>
      <button
        onClick={onKeep}
        className="control-primary px-3 py-1 text-sm font-semibold"
      >
        Keep
      </button>
      <button
        onClick={onMulligan}
        className="control px-3 py-1 text-sm"
      >
        Mulligan
      </button>
    </div>
  );
}
