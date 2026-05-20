"use client";

import { useEffect, useState } from "react";
import type { DeckSummary } from "../lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  decks: DeckSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name?: string) => void;
  onDelete: (id: string) => void;
  onTogglePublic: (id: string, isPublic: boolean) => void;
  canCreate?: boolean;
  canDelete?: boolean;
  canTogglePublic?: boolean;
  onCreateBlocked?: () => void;
  onDeleteBlocked?: () => void;
  onTogglePublicBlocked?: () => void;
  footerLabel?: string;
};

export function DeckSelector({
  open,
  onClose,
  decks,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  onTogglePublic,
  canCreate = true,
  canDelete = true,
  canTogglePublic = true,
  onCreateBlocked,
  onDeleteBlocked,
  onTogglePublicBlocked,
  footerLabel = "Cloud synced",
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
        className={`fixed inset-0 z-[70] bg-black/35 backdrop-blur-sm transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={`fixed inset-y-0 left-0 z-[80] flex w-80 max-w-[86vw] flex-col border-r border-border bg-surface shadow-2xl transition-transform ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-border bg-surface-raised px-4 py-4">
          <div>
            <h2 className="text-sm font-semibold">Your decks</h2>
            <div className="text-xs text-text-subtle">
              {decks.length} saved deck{decks.length === 1 ? "" : "s"}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                if (canCreate) onCreate();
                else onCreateBlocked?.();
              }}
              className="control-primary px-3 py-2 text-xs font-semibold"
            >
              New
            </button>
            <button
              onClick={onClose}
              className="control p-2"
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
        <ul className="thin-scroll min-h-0 flex-1 overflow-y-auto py-3">
          {decks.map((d) => {
            const active = d.id === activeId;
            return (
              <li key={d.id} className="px-3">
                <div
                  className={`group flex cursor-pointer items-center gap-2 rounded-xl px-3 py-3 transition ${
                    active
                      ? "bg-[image:var(--rainbow-soft)] ring-1 ring-accent/35"
                      : "hover:bg-surface-subtle"
                  }`}
                  onClick={() => {
                    onSelect(d.id);
                    onClose();
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{d.name}</div>
                    <div className="mt-0.5 text-[11px] capitalize text-text-subtle">
                      {d.cardCount} cards · {d.sideboardCount} sideboard ·{" "}
                      {d.maybeboardCount} maybe
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
                    <div
                      className="flex shrink-0 items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (canTogglePublic) {
                            onTogglePublic(d.id, !d.isPublic);
                          } else {
                            onTogglePublicBlocked?.();
                          }
                        }}
                        className={`rounded-md p-1.5 text-text-subtle transition hover:bg-white hover:text-accent disabled:cursor-not-allowed disabled:opacity-30 ${
                          d.isPublic ? "opacity-100" : "opacity-80"
                        }`}
                        title={
                          canTogglePublic
                            ? d.isPublic
                              ? "Make private"
                              : "Publish deck"
                            : "Sign in to publish saved decks"
                        }
                        aria-label={
                          d.isPublic
                            ? `Make ${d.name} private`
                            : `Publish ${d.name}`
                        }
                      >
                        {d.isPublic ? <PublicIcon /> : <PrivateIcon />}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (canDelete) setConfirmingId(d.id);
                          else onDeleteBlocked?.();
                        }}
                        className="rounded-md px-1.5 py-1 text-text-subtle opacity-0 transition hover:bg-white hover:text-[color:var(--danger)] group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
                        title={
                          canDelete
                            ? "Delete deck"
                            : "Sign in to manage saved decks"
                        }
                        aria-label={`Delete ${d.name}`}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-border bg-surface-raised px-4 py-3 text-[11px] text-text-subtle">
          {footerLabel}
        </div>
      </aside>
    </>
  );
}

function PublicIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      width={15}
      height={15}
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

function PrivateIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      width={15}
      height={15}
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
