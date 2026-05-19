"use client";

import { useEffect, useRef, useState } from "react";
import type { DeckEntry } from "../lib/types";
import {
  parseDeckInput,
  resolveLines,
  type ImportResult,
  type ParsedLine,
} from "../lib/import";

type Props = {
  onImport: (
    entries: DeckEntry[],
    sideboard: DeckEntry[],
    mode: "merge" | "replace"
  ) => void;
  onDeckNameHint?: (name: string) => void;
  resolveLines?: (lines: ParsedLine[]) => Promise<ImportResult>;
  disabled?: boolean;
};

type Stage = "idle" | "resolving" | "preview" | "error";

export function ImportButton({
  onImport,
  onDeckNameHint,
  resolveLines: resolveLinesOverride,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [stage, setStage] = useState<Stage>("idle");
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [parsedName, setParsedName] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function reset() {
    setText("");
    setPreview(null);
    setParsedName(undefined);
    setStage("idle");
    setError(null);
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function onPreview() {
    const { lines, deckName } = parseDeckInput(text);
    if (lines.length === 0) {
      setError("No cards found. Expected lines like “3 Lightning Bolt”.");
      setStage("error");
      return;
    }
    setParsedName(deckName);
    setStage("resolving");
    setError(null);
    try {
      const resolver = resolveLinesOverride ?? resolveLines;
      const result = await resolver(lines);
      setPreview(result);
      setStage("preview");
    } catch (e) {
      setError((e as Error).message || "Failed to resolve cards");
      setStage("error");
    }
  }

  function onConfirm() {
    if (!preview) return;
    onImport(preview.entries, preview.sideboard, mode);
    if (parsedName && onDeckNameHint && mode === "replace") {
      onDeckNameHint(parsedName);
    }
    close();
  }

  async function onFile(file: File) {
    const body = await file.text();
    setText(body);
  }

  const parsedLines: ParsedLine[] = preview
    ? [
        ...preview.entries.map((e) => ({
          quantity: e.quantity,
          name: e.name,
          zone: "main" as const,
        })),
        ...preview.sideboard.map((e) => ({
          quantity: e.quantity,
          name: e.name,
          zone: "sideboard" as const,
        })),
        ...preview.unresolved,
      ]
    : [];
  const totalResolved =
    (preview?.entries.reduce((n, e) => n + e.quantity, 0) ?? 0) +
    (preview?.sideboard.reduce((n, e) => n + e.quantity, 0) ?? 0);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        title="Import deck"
        aria-label="Import deck"
        className="control flex items-center gap-1.5 px-3 py-2 text-xs font-medium disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-surface-raised disabled:hover:text-text-muted"
      >
        <ImportIcon />
        <span>Import</span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
          onClick={close}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Import deck"
          >
            <div className="flex items-center justify-between border-b border-border bg-surface-raised px-4 py-3">
              <h2 className="text-sm font-semibold">Import deck</h2>
              <button
                onClick={close}
                className="control p-2"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
              {stage !== "preview" ? (
                <>
                  <p className="text-xs text-text-muted">
                    Paste a deck list, or load a <code>.txt</code> / MTGA /
                    <code>.dek</code> / JSON file. Lines like{" "}
                    <code>3 Lightning Bolt</code> or{" "}
                    <code>1 Sol Ring (C21) 263</code> are recognized.
                  </p>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={"4 Lightning Bolt\n1 Sol Ring\n..."}
                    className="thin-scroll h-56 w-full resize-y rounded-xl border border-border bg-surface-raised p-3 font-mono text-xs outline-none focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20"
                    spellCheck={false}
                  />

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".txt,.dek,.mwDeck,.json,.csv,text/plain,application/json,application/xml"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onFile(f);
                        e.target.value = "";
                      }}
                    />
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="control px-2.5 py-1.5 text-text-muted"
                    >
                      Load file…
                    </button>
                    <div className="ml-auto flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-text-muted">
                        <input
                          type="radio"
                          name="import-mode"
                          checked={mode === "merge"}
                          onChange={() => setMode("merge")}
                        />
                        Merge
                      </label>
                      <label className="flex items-center gap-1.5 text-text-muted">
                        <input
                          type="radio"
                          name="import-mode"
                          checked={mode === "replace"}
                          onChange={() => setMode("replace")}
                        />
                        Replace
                      </label>
                    </div>
                  </div>

                  {stage === "error" && error && (
                    <div className="rounded-lg border border-[color:var(--danger)]/40 bg-[color:var(--danger)]/5 px-3 py-2 text-xs text-[color:var(--danger)]">
                      {error}
                    </div>
                  )}
                </>
              ) : (
                <ImportPreview
                  lines={parsedLines}
                  totalResolved={totalResolved}
                  unresolved={preview?.unresolved ?? []}
                  mode={mode}
                  onModeChange={setMode}
                  parsedName={parsedName}
                />
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-raised px-4 py-3">
              {stage === "preview" ? (
                <>
                  <button
                    onClick={() => {
                      setStage("idle");
                      setPreview(null);
                    }}
                    className="control px-3 py-1.5 text-xs"
                  >
                    Back
                  </button>
                  <button
                    onClick={onConfirm}
                    disabled={
                      !preview ||
                      (preview.entries.length === 0 &&
                        preview.sideboard.length === 0)
                    }
                    className="control-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                  >
                    {mode === "replace" ? "Replace deck" : "Add to deck"}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={close}
                    className="control px-3 py-1.5 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={onPreview}
                    disabled={!text.trim() || stage === "resolving"}
                    className="control-primary px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                  >
                    {stage === "resolving" ? "Resolving…" : "Preview"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ImportPreview({
  lines,
  totalResolved,
  unresolved,
  mode,
  onModeChange,
  parsedName,
}: {
  lines: ParsedLine[];
  totalResolved: number;
  unresolved: ParsedLine[];
  mode: "merge" | "replace";
  onModeChange: (m: "merge" | "replace") => void;
  parsedName?: string;
}) {
  const resolvedCount = lines.length - unresolved.length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-medium text-text">
          {totalResolved} card{totalResolved === 1 ? "" : "s"} ready
        </span>
        <span className="text-text-subtle">
          {resolvedCount}/{lines.length} lines matched
        </span>
        {parsedName && (
          <span className="text-text-subtle">
            Name hint: <span className="text-text">{parsedName}</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-text-muted">
            <input
              type="radio"
              name="import-mode-preview"
              checked={mode === "merge"}
              onChange={() => onModeChange("merge")}
            />
            Merge
          </label>
          <label className="flex items-center gap-1.5 text-text-muted">
            <input
              type="radio"
              name="import-mode-preview"
              checked={mode === "replace"}
              onChange={() => onModeChange("replace")}
            />
            Replace
          </label>
        </div>
      </div>

      {unresolved.length > 0 && (
        <div className="rounded-lg border border-[color:var(--danger)]/30 bg-[color:var(--danger)]/5 px-3 py-2 text-xs">
          <div className="mb-1 font-semibold text-[color:var(--danger)]">
            {unresolved.length} line{unresolved.length === 1 ? "" : "s"} not
            found
          </div>
          <ul className="max-h-24 overflow-y-auto text-text-muted">
            {unresolved.map((l, i) => (
              <li key={i} className="truncate">
                {l.quantity} {l.name}
                {l.set ? ` (${l.set.toUpperCase()})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="thin-scroll max-h-64 overflow-y-auto rounded-xl border border-border">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-surface-subtle text-text-muted">
            <tr>
              <th className="w-10 px-2 py-1">#</th>
              <th className="px-2 py-1">Card</th>
              <th className="w-24 px-2 py-1">Board</th>
            </tr>
          </thead>
          <tbody>
            {lines.slice(0, unresolved.length === 0 ? 500 : lines.length).map((l, i) => {
              const missing = unresolved.includes(l);
              return (
                <tr
                  key={i}
                  className={`border-t border-border ${
                    missing ? "text-[color:var(--danger)]" : ""
                  }`}
                >
                  <td className="px-2 py-1 tabular-nums">{l.quantity}</td>
                  <td className="px-2 py-1">{l.name}</td>
                  <td className="px-2 py-1 text-text-subtle">
                    {l.zone === "sideboard" ? "Sideboard" : "Main"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ImportIcon() {
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
      <path d="M10 13V3" />
      <path d="M6 9l4 4 4-4" />
      <path d="M4 14v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2" />
    </svg>
  );
}
