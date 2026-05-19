"use client";

import { useEffect, useRef, useState } from "react";
import type { Deck } from "../lib/types";
import {
  EXPORT_FORMATS,
  type ExportFormat,
  downloadDeck,
  serializeDeckForExport,
} from "../lib/export";

type Props = {
  deck: Deck;
  disabled?: boolean;
};

export function ExportButton({ deck, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<ExportFormat | null>(null);
  const [busy, setBusy] = useState<{
    format: ExportFormat;
    action: "copy" | "save";
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    setBusy({ format, action: "copy" });
    setError(null);
    try {
      const text = await serializeDeckForExport(deck, format);
      await navigator.clipboard.writeText(text);
      setCopied(format);
      setTimeout(() => setCopied((c) => (c === format ? null : c)), 1500);
    } catch {
      try {
        // Clipboard unavailable — fall back to download.
        await downloadDeck(deck, format);
      } catch (err) {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(null);
    }
  }

  async function onDownload(format: ExportFormat) {
    setBusy({ format, action: "save" });
    setError(null);
    try {
      await downloadDeck(deck, format);
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
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
        className="control flex items-center gap-1.5 px-3 py-2 text-xs font-medium disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-surface-raised disabled:hover:text-text-muted"
      >
        <ExportIcon />
        <span>Export</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-[80] mt-2 w-80 overflow-hidden rounded-xl border border-border bg-white shadow-xl"
        >
          <div className="border-b border-border bg-surface-raised px-3 py-2 text-[11px] font-semibold uppercase text-text-muted">
            Export format
          </div>
          <ul className="max-h-[60vh] overflow-y-auto py-1">
            {EXPORT_FORMATS.map((f) => (
              <li key={f.id} className="px-1">
                <div className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-subtle">
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
                      disabled={busy !== null}
                      className="control px-2 py-1 text-[11px] disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-surface-raised disabled:hover:text-text-muted"
                      title={`Copy ${f.label} to clipboard`}
                    >
                      {busy?.format === f.id && busy.action === "copy"
                        ? "Copying..."
                        : copied === f.id
                          ? "Copied!"
                          : "Copy"}
                    </button>
                    <button
                      onClick={() => onDownload(f.id)}
                      disabled={busy !== null}
                      className="control px-2 py-1 text-[11px] disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-surface-raised disabled:hover:text-text-muted"
                      title={`Download as .${f.extension}`}
                    >
                      {busy?.format === f.id && busy.action === "save"
                        ? "Saving..."
                        : "Save"}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {error && (
            <div
              role="status"
              className="border-t border-border bg-red-50 px-3 py-2 text-[11px] text-red-700"
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Export failed";
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
