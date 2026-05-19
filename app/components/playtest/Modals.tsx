"use client";

import { useEffect, useMemo, useState } from "react";
import type { PlayCard, PlayTokenTemplate, Zone } from "../../lib/playtest";

function Backdrop({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose?: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="max-h-full w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10">
        {children}
      </div>
    </div>
  );
}

function CardTile({
  card,
  selected,
  onClick,
}: {
  card: PlayCard;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative block overflow-hidden rounded-lg shadow-sm ring-1 transition ${
        selected ? "ring-2 ring-accent" : "ring-black/10 hover:ring-accent/50"
      }`}
      style={{ width: 100, height: 140 }}
      title={card.name}
    >
      {card.imageNormal ? (
        <img
          src={card.imageNormal}
          alt={card.name}
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-surface-subtle px-1 text-center text-[10px]">
          {card.name}
        </div>
      )}
    </button>
  );
}

export function MulliganBottomModal({
  hand,
  count,
  onConfirm,
}: {
  hand: PlayCard[];
  count: number;
  onConfirm: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  function toggle(id: string) {
    setPicked((p) =>
      p.includes(id)
        ? p.filter((x) => x !== id)
        : p.length < count
          ? [...p, id]
          : p
    );
  }
  return (
    <Backdrop>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">
              Bottom {count} card{count === 1 ? "" : "s"}
            </h2>
            <p className="text-xs text-text-muted">
              Select {count} card{count === 1 ? "" : "s"} to put on the bottom
              of your library in selection order.
            </p>
          </div>
          <div className="text-xs text-text-muted">
            {picked.length}/{count} chosen
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {hand.map((c) => {
            const idx = picked.indexOf(c.instanceId);
            return (
              <div key={c.instanceId} className="relative">
                <CardTile
                  card={c}
                  selected={idx >= 0}
                  onClick={() => toggle(c.instanceId)}
                />
                {idx >= 0 && (
                  <div className="accent-fill pointer-events-none absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold">
                    {idx + 1}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex justify-end">
          <button
            disabled={picked.length !== count}
            onClick={() => onConfirm(picked)}
            className="control-primary px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
          >
            Confirm
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

export function ScryModal({
  cards,
  onFinish,
  onCancel,
}: {
  cards: PlayCard[];
  onFinish: (top: string[], bottom: string[]) => void;
  onCancel: () => void;
}) {
  // Each card has a destination: "top" | "bottom" | undefined
  const [dest, setDest] = useState<Record<string, "top" | "bottom">>({});
  const [order, setOrder] = useState<string[]>(
    cards.map((c) => c.instanceId)
  );

  const topIds = order.filter((id) => dest[id] === "top");
  const bottomIds = order.filter((id) => dest[id] === "bottom");
  const allAssigned = cards.every((c) => dest[c.instanceId]);

  function setFor(id: string, where: "top" | "bottom") {
    setDest((d) => ({ ...d, [id]: where }));
  }

  function move(id: string, delta: number) {
    setOrder((o) => {
      const idx = o.indexOf(id);
      const nIdx = idx + delta;
      if (idx < 0 || nIdx < 0 || nIdx >= o.length) return o;
      const next = o.slice();
      [next[idx], next[nIdx]] = [next[nIdx], next[idx]];
      return next;
    });
  }

  return (
    <Backdrop onClose={onCancel}>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Scry {cards.length}</h2>
            <p className="text-xs text-text-muted">
              Choose top or bottom for each; reorder with arrows. Order within
              each bucket matches the displayed order (first shown = nearest
              top/bottom).
            </p>
          </div>
          <button
            onClick={onCancel}
            className="rounded border border-border px-2 py-1 text-xs hover:text-text"
          >
            Cancel
          </button>
        </div>
        <ul className="flex flex-wrap gap-3">
          {order.map((id, i) => {
            const card = cards.find((c) => c.instanceId === id);
            if (!card) return null;
            const d = dest[id];
            return (
              <li
                key={id}
                className="flex flex-col items-center gap-1 rounded-md border border-border p-2"
              >
                <CardTile card={card} />
                <div className="flex gap-1">
                  <button
                    className={`rounded-md px-2 py-0.5 text-[11px] ${
                      d === "top"
                        ? "bg-[image:var(--rainbow-soft)] text-text ring-1 ring-accent/30"
                        : "border border-border hover:bg-surface-subtle"
                    }`}
                    onClick={() => setFor(id, "top")}
                  >
                    Top
                  </button>
                  <button
                    className={`rounded-md px-2 py-0.5 text-[11px] ${
                      d === "bottom"
                        ? "bg-[image:var(--rainbow-soft)] text-text ring-1 ring-accent/30"
                        : "border border-border hover:bg-surface-subtle"
                    }`}
                    onClick={() => setFor(id, "bottom")}
                  >
                    Bottom
                  </button>
                </div>
                <div className="flex gap-1 text-[11px] text-text-muted">
                  <button
                    disabled={i === 0}
                    onClick={() => move(id, -1)}
                    className="control px-1.5 disabled:opacity-30"
                  >
                    ←
                  </button>
                  <button
                    disabled={i === order.length - 1}
                    onClick={() => move(id, +1)}
                    className="control px-1.5 disabled:opacity-30"
                  >
                    →
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>
            Top ({topIds.length}) · Bottom ({bottomIds.length})
          </span>
          <button
            disabled={!allAssigned}
            onClick={() => onFinish(topIds, bottomIds)}
            className="control-primary px-3 py-1.5 text-sm font-semibold disabled:opacity-40"
          >
            Put back
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

export function SearchModal({
  library,
  dest,
  onPick,
  onCancel,
}: {
  library: PlayCard[];
  dest: Zone;
  onPick: (instanceId: string, shuffle: boolean) => void;
  onCancel: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [shuffleAfter, setShuffleAfter] = useState(true);
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return library;
    return library.filter(
      (c) =>
        c.name.toLowerCase().includes(f) ||
        c.typeLine?.toLowerCase().includes(f)
    );
  }, [library, filter]);

  return (
    <Backdrop onClose={onCancel}>
      <div className="flex max-h-[80vh] flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">
              Search library → {dest}
            </h2>
            <p className="text-xs text-text-muted">
              {library.length} cards. Click one to move it.
            </p>
          </div>
          <label className="flex items-center gap-1 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={shuffleAfter}
              onChange={(e) => setShuffleAfter(e.target.checked)}
            />
            Shuffle after
          </label>
          <button
            onClick={onCancel}
          className="control px-2 py-1 text-xs"
          >
            Cancel
          </button>
        </div>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or type…"
          className="input"
        />
        <div className="thin-scroll grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-2 overflow-y-auto">
          {filtered.map((c) => (
            <CardTile
              key={c.instanceId}
              card={c}
              onClick={() => onPick(c.instanceId, shuffleAfter)}
            />
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full py-8 text-center text-sm text-text-subtle">
              No matching cards.
            </div>
          )}
        </div>
      </div>
    </Backdrop>
  );
}

export function TokenCreator({
  open,
  recentTokens,
  onClose,
  onCreate,
}: {
  open: boolean;
  recentTokens: PlayTokenTemplate[];
  onClose: () => void;
  onCreate: (token: PlayTokenTemplate) => void;
}) {
  const [name, setName] = useState("");
  const [pt, setPt] = useState("");
  const [subtype, setSubtype] = useState("");
  function createToken(token: PlayTokenTemplate) {
    onCreate(token);
    setName("");
    setPt("");
    setSubtype("");
    onClose();
  }

  if (!open) return null;
  return (
    <Backdrop onClose={onClose}>
      <div className="flex flex-col gap-3 p-4">
        <h2 className="text-base font-semibold">Create token</h2>
        {recentTokens.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text-muted">
              Recent tokens
            </span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {recentTokens.map((token) => (
                <button
                  key={`${token.name}:${token.typeLine ?? ""}:${token.tokenNote ?? ""}`}
                  type="button"
                  onClick={() => createToken(token)}
                  className="min-h-14 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-left text-xs transition hover:border-border-strong hover:bg-surface"
                >
                  <span className="block truncate font-semibold text-text">
                    {token.name}
                  </span>
                  <span className="block truncate text-text-subtle">
                    {token.tokenNote ? `${token.tokenNote} ` : ""}
                    {token.typeLine ?? "Token Creature"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-text-muted">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Goblin"
              className="input"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-text-muted">P/T</span>
            <input
              value={pt}
              onChange={(e) => setPt(e.target.value)}
              placeholder="1/1"
              className="input"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-text-muted">Subtype</span>
            <input
              value={subtype}
              onChange={(e) => setSubtype(e.target.value)}
              placeholder="Goblin"
              className="input"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="control px-2 py-1 text-xs"
          >
            Cancel
          </button>
          <button
            disabled={!name.trim()}
            onClick={() => {
              const n = name.trim() || "Token";
              const typeLine = subtype.trim()
                ? `Token Creature — ${subtype.trim()}`
                : "Token Creature";
              createToken({
                name: n,
                typeLine,
                tokenNote: pt.trim() || undefined,
              });
            }}
            className="control-primary px-3 py-1 text-sm font-semibold disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

export function ScryPrompt({
  onChoose,
  onCancel,
}: {
  onChoose: (n: number) => void;
  onCancel: () => void;
}) {
  const [n, setN] = useState(1);
  return (
    <Backdrop onClose={onCancel}>
      <div className="flex flex-col gap-3 p-4">
        <h2 className="text-base font-semibold">Scry</h2>
        <label className="flex items-center gap-2 text-sm">
          <span>Look at top</span>
          <input
            type="number"
            min={1}
            max={10}
            value={n}
            onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))}
            className="input w-16"
          />
          <span>cards</span>
        </label>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="control px-2 py-1 text-xs"
          >
            Cancel
          </button>
          <button
            onClick={() => onChoose(n)}
            className="control-primary px-3 py-1 text-sm font-semibold"
          >
            Scry
          </button>
        </div>
      </div>
    </Backdrop>
  );
}
