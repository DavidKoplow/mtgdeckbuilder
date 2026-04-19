"use client";

import { useEffect, useState } from "react";
import type { Deck } from "../lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  decks: Deck[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name?: string) => void;
  onDelete: (id: string) => void;
};

export function DeckSelector({
  open,
  onClose,
  decks,
  activeId,
  onSelect,
  onCreate,
  onDelete,
}: Props) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-black/25 transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-border bg-surface shadow-xl transition-transform ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Your decks</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onCreate()}
              className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition hover:bg-accent-hover"
            >
              + New
            </button>
            <button
              onClick={onClose}
              className="rounded-md border border-border p-1 text-text-muted hover:text-text"
              aria-label="Close deck panel"
              title="Close"
            >
              <svg
                viewBox="0 0 20 20"
                width={14}
                height={14}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              >
                <path d="M5 5l10 10M15 5l-10 10" />
              </svg>
            </button>
          </div>
        </div>
        <ul className="thin-scroll flex-1 min-h-0 overflow-y-auto py-2">
          {decks.map((d) => {
            const active = d.id === activeId;
            const cards = d.entries.reduce((n, e) => n + e.quantity, 0);
            return (
              <li key={d.id} className="px-2">
                <div
                  className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 transition ${
                    active
                      ? "bg-accent-subtle ring-1 ring-accent/30"
                      : "hover:bg-surface-subtle"
                  }`}
                  onClick={() => {
                    onSelect(d.id);
                    onClose();
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{d.name}</div>
                    <div className="text-[11px] text-text-subtle">
                      {cards} cards · {d.format}
                    </div>
                  </div>
                  {confirmingId === d.id ? (
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => {
                          onDelete(d.id);
                          setConfirmingId(null);
                        }}
                        className="rounded px-1.5 py-0.5 text-[11px] text-[color:var(--danger)] hover:bg-red-50"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmingId(null)}
                        className="rounded px-1.5 py-0.5 text-[11px] text-text-subtle hover:text-text"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmingId(d.id);
                      }}
                      className="shrink-0 rounded px-1 text-text-subtle opacity-0 transition hover:text-[color:var(--danger)] group-hover:opacity-100"
                      title="Delete deck"
                      aria-label={`Delete ${d.name}`}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-border px-4 py-2 text-[11px] text-text-subtle">
          Saved locally in your browser.
        </div>
      </aside>
    </>
  );
}
