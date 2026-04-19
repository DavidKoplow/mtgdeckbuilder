"use client";

import { useEffect, useRef, useState } from "react";
import type { Deck } from "../lib/types";
import {
  EXPORT_FORMATS,
  type ExportFormat,
  downloadDeck,
  serializeDeck,
} from "../lib/export";

type Props = {
  deck: Deck;
  disabled?: boolean;
};

export function ExportButton({ deck, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<ExportFormat | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function onCopy(format: ExportFormat) {
    const text = serializeDeck(deck, format);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(format);
      setTimeout(() => setCopied((c) => (c === format ? null : c)), 1500);
    } catch {
      // Clipboard unavailable — fall back to download.
      downloadDeck(deck, format);
    }
  }

  function onDownload(format: ExportFormat) {
    downloadDeck(deck, format);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        title="Export deck"
        aria-label="Export deck"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-text-muted transition hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-muted"
      >
        <ExportIcon />
        <span>Export</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-md border border-border bg-white shadow-lg"
        >
          <div className="border-b border-border bg-surface-subtle px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            Export format
          </div>
          <ul className="max-h-[60vh] overflow-y-auto py-1">
            {EXPORT_FORMATS.map((f) => (
              <li key={f.id} className="px-1">
                <div className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-surface-subtle">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-text">
                      {f.label}
                    </div>
                    <div className="truncate text-[11px] text-text-subtle">
                      {f.description}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => onCopy(f.id)}
                      className="rounded border border-border bg-white px-1.5 py-0.5 text-[11px] text-text-muted transition hover:border-accent hover:text-accent"
                      title={`Copy ${f.label} to clipboard`}
                    >
                      {copied === f.id ? "Copied!" : "Copy"}
                    </button>
                    <button
                      onClick={() => onDownload(f.id)}
                      className="rounded border border-border bg-white px-1.5 py-0.5 text-[11px] text-text-muted transition hover:border-accent hover:text-accent"
                      title={`Download as .${f.extension}`}
                    >
                      Save
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ExportIcon() {
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
    >
      <path d="M10 3v10" />
      <path d="M6 7l4-4 4 4" />
      <path d="M4 14v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2" />
    </svg>
  );
}
