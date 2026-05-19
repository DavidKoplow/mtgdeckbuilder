"use client";

import { useEffect, useRef, useState } from "react";
import { useFinePointer } from "../../hooks/useMediaQuery";
import type { PlayCard, Zone } from "../../lib/playtest";

type Props = {
  card: PlayCard;
  zone: Zone;
  width?: number; // base card width in px; height = width * 1.4
  onTap?: () => void;
  onMove?: (to: Zone) => void;
  onCounter?: (kind: string, delta: number) => void;
  onHover?: (src: string | undefined, x: number, y: number) => void;
  selectable?: boolean;
  selected?: boolean;
  onSelectToggle?: () => void;
};

const COUNTER_KINDS = ["+1/+1", "-1/-1", "charge", "loyalty"];

export function PlayCardView({
  card,
  zone,
  width = 100,
  onTap,
  onMove,
  onCounter,
  onHover,
  selectable,
  selected,
  onSelectToggle,
}: Props) {
  const height = Math.round(width * 1.4);
  const tapped = zone === "battlefield" && card.tapped;
  const slotW = tapped ? height : width;
  const slotH = tapped ? width : height;
  const [menuOpen, setMenuOpen] = useState(false);
  const [counterMenuOpen, setCounterMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const finePointer = useFinePointer();

  useEffect(() => {
    if (!menuOpen && !counterMenuOpen) return;
    function onDoc(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setCounterMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen, counterMenuOpen]);

  function handleClick() {
    if (selectable) {
      onSelectToggle?.();
      return;
    }
    if (zone === "battlefield" && onTap) onTap();
  }

  const allDestinations: { zone: Zone; label: string }[] = [
    { zone: "command", label: "→ Command" },
    { zone: "hand", label: "→ Hand" },
    { zone: "battlefield", label: "→ Battlefield" },
    { zone: "graveyard", label: "→ Graveyard" },
    { zone: "exile", label: "→ Exile" },
    { zone: "library", label: "→ Library (top)" },
  ];
  const destinations = allDestinations.filter(
    (d) => d.zone !== zone && (d.zone !== "command" || card.isCommander)
  );

  function onDragStart(e: React.DragEvent) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(
      "application/x-playcard",
      JSON.stringify({ instanceId: card.instanceId, from: zone })
    );
    // fallback for browsers that require a text payload
    e.dataTransfer.setData("text/plain", card.instanceId);
  }

  return (
    <div
      className="relative"
      style={{
        width: slotW,
        height: slotH,
        transition: "width 180ms ease, height 180ms ease",
      }}
      onMouseEnter={(e) =>
        onHover?.(card.imageNormal, e.clientX, e.clientY)
      }
      onMouseMove={(e) =>
        onHover?.(card.imageNormal, e.clientX, e.clientY)
      }
      onMouseLeave={() => onHover?.(undefined, 0, 0)}
    >
      <div
        className={`absolute left-0 top-0 select-none ${
          finePointer
            ? "cursor-grab active:cursor-grabbing"
            : "cursor-pointer touch-manipulation"
        }`}
        draggable={!selectable && finePointer}
        onDragStart={onDragStart}
        style={{
          width,
          height,
          transformOrigin: `${width / 2}px ${height / 2}px`,
          transform: tapped
            ? `translate(${(height - width) / 2}px, ${(width - height) / 2}px) rotate(90deg)`
            : "rotate(0deg)",
          transition: "transform 180ms ease",
        }}
        onClick={handleClick}
      >
        {card.imageNormal ? (
          <img
            src={card.imageNormal}
            alt={card.name}
            draggable={false}
            className={`h-full w-full rounded-lg object-cover shadow-sm ring-1 ring-black/20 transition ${
              selected ? "ring-2 ring-accent" : ""
            }`}
          />
        ) : (
          <div
            className={`flex h-full w-full flex-col items-center justify-center rounded-lg bg-surface-subtle p-1 text-center text-[10px] text-text-muted ring-1 ring-black/20 ${
              selected ? "ring-2 ring-accent" : ""
            }`}
          >
            <div className="font-semibold">{card.name}</div>
            {card.tokenNote && (
              <div className="mt-1 text-[10px]">{card.tokenNote}</div>
            )}
            {card.isToken && (
              <div className="mt-1 text-[9px] uppercase opacity-70">
                Token
              </div>
            )}
          </div>
        )}
      </div>

      {Object.entries(card.counters).length > 0 && (
        <div className="pointer-events-none absolute left-1 top-1 flex flex-col gap-0.5">
          {Object.entries(card.counters).map(([k, v]) => (
            <span
              key={k}
              className="rounded-full bg-black/80 px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-nums shadow"
              title={`${k} counters`}
            >
              {k === "+1/+1" || k === "-1/-1" ? `${k}×${v}` : `${k}: ${v}`}
            </span>
          ))}
        </div>
      )}

      {card.isCommander && (
        <div className="pointer-events-none absolute bottom-1 left-1 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white shadow">
          Cmd
        </div>
      )}

      {zone === "battlefield" && (
        <div
          ref={menuRef}
          className="absolute right-0 top-0 flex flex-col items-end gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            aria-label="Card actions"
            onClick={() => {
              setMenuOpen((v) => !v);
              setCounterMenuOpen(false);
            }}
            className={`flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-[11px] leading-none text-white transition hover:bg-black/90 ${
              finePointer
                ? "opacity-0 group-hover:opacity-100"
                : "opacity-100"
            }`}
            style={{ opacity: menuOpen || counterMenuOpen ? 1 : undefined }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="z-10 flex flex-col gap-0.5 rounded-lg border border-border bg-white p-1 text-xs shadow-lg">
              <button
                className="rounded-md px-2 py-1 text-left hover:bg-surface-subtle"
                onClick={() => {
                  setMenuOpen(false);
                  onTap?.();
                }}
              >
                {card.tapped ? "Untap" : "Tap"}
              </button>
              <button
                className="rounded-md px-2 py-1 text-left hover:bg-surface-subtle"
                onClick={() => {
                  setMenuOpen(false);
                  setCounterMenuOpen(true);
                }}
              >
                Counters…
              </button>
              {destinations.map((d) => (
                <button
                  key={d.zone}
                  className="rounded-md px-2 py-1 text-left hover:bg-surface-subtle"
                  onClick={() => {
                    setMenuOpen(false);
                    onMove?.(d.zone);
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}
          {counterMenuOpen && (
            <div className="z-10 flex flex-col gap-1 rounded-lg border border-border bg-white p-2 text-xs shadow-lg">
              {COUNTER_KINDS.map((k) => (
                <div
                  key={k}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="font-medium">{k}</span>
                  <div className="flex items-center gap-1">
                    <button
                      className="flex h-5 w-5 items-center justify-center rounded-md bg-surface-subtle hover:bg-border"
                      onClick={() => onCounter?.(k, -1)}
                    >
                      −
                    </button>
                    <span className="w-6 text-center tabular-nums">
                      {card.counters[k] ?? 0}
                    </span>
                    <button
                      className="accent-fill flex h-5 w-5 items-center justify-center rounded-md"
                      onClick={() => onCounter?.(k, 1)}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
              <CustomCounterRow
                card={card}
                onCounter={(kind, delta) => onCounter?.(kind, delta)}
              />
            </div>
          )}
        </div>
      )}

      {zone !== "battlefield" && !selectable && onMove && (
        <div
          ref={menuRef}
          className="absolute right-0 top-0"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            aria-label="Card actions"
            onClick={() => setMenuOpen((v) => !v)}
            className={`flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-[11px] leading-none text-white hover:bg-black/90 ${
              finePointer ? "" : "opacity-100"
            }`}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="z-10 mt-1 flex flex-col gap-0.5 rounded-lg border border-border bg-white p-1 text-xs shadow-lg">
              {destinations.map((d) => (
                <button
                  key={d.zone}
                  className="rounded-md px-2 py-1 text-left hover:bg-surface-subtle"
                  onClick={() => {
                    setMenuOpen(false);
                    onMove?.(d.zone);
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CustomCounterRow({
  card,
  onCounter,
}: {
  card: PlayCard;
  onCounter: (kind: string, delta: number) => void;
}) {
  const [name, setName] = useState("");
  const extras = Object.keys(card.counters).filter(
    (k) => !COUNTER_KINDS.includes(k)
  );
  return (
    <div className="mt-1 border-t border-border pt-1">
      {extras.map((k) => (
        <div key={k} className="flex items-center justify-between gap-2">
          <span className="font-medium">{k}</span>
          <div className="flex items-center gap-1">
            <button
              className="flex h-5 w-5 items-center justify-center rounded-md bg-surface-subtle hover:bg-border"
              onClick={() => onCounter(k, -1)}
            >
              −
            </button>
            <span className="w-6 text-center tabular-nums">
              {card.counters[k]}
            </span>
            <button
              className="accent-fill flex h-5 w-5 items-center justify-center rounded-md"
              onClick={() => onCounter(k, 1)}
            >
              +
            </button>
          </div>
        </div>
      ))}
      <div className="mt-1 flex items-center gap-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="custom…"
          className="min-w-0 flex-1 rounded-md border border-border bg-white px-1 py-0.5 text-[11px] outline-none focus:border-accent"
        />
        <button
          disabled={!name.trim()}
          onClick={() => {
            if (!name.trim()) return;
            onCounter(name.trim(), 1);
            setName("");
          }}
          className="accent-fill rounded-md px-1.5 py-0.5 text-[11px] disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}
