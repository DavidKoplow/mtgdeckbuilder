"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ScryfallSet } from "../lib/types";
import { getAllSets } from "../lib/scryfall";

type Props = {
  value?: string; // selected set code
  onChange: (code: string | undefined) => void;
};

export function SetCombobox({ value, onChange }: Props) {
  const [sets, setSets] = useState<ScryfallSet[] | null>(null);
  const [draft, setDraft] = useState<{
    sourceValue: string | undefined;
    input: string;
  }>({ sourceValue: value, input: "" });
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    getAllSets()
      .then((s) => alive && setSets(s))
      .catch(() => alive && setSets([]));
    return () => {
      alive = false;
    };
  }, []);

  // Close on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const selectedText = useMemo(() => {
    if (!sets || !value) return "";
    const match = sets.find((s) => s.code === value);
    return match ? `${match.name} (${match.code.toUpperCase()})` : "";
  }, [sets, value]);
  const input = draft.sourceValue === value ? draft.input : selectedText;

  const matches = useMemo(() => {
    if (!sets) return [];
    const q = input.trim().toLowerCase();
    if (!q) return sets.slice(0, 60);
    const scored = sets
      .map((s) => ({ s, score: scoreSet(s, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
      .map((x) => x.s);
    return scored;
  }, [sets, input]);
  const activeHighlight = Math.min(highlight, Math.max(0, matches.length - 1));

  function select(set: ScryfallSet) {
    onChange(set.code);
    setDraft({
      sourceValue: value,
      input: `${set.name} (${set.code.toUpperCase()})`,
    });
    setOpen(false);
  }

  function clear() {
    onChange(undefined);
    setDraft({ sourceValue: undefined, input: "" });
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setDraft({ sourceValue: undefined, input: e.target.value });
            setOpen(true);
            // Free-text edits should invalidate the current selection
            if (value) onChange(undefined);
          }}
          onFocus={() => {
            setDraft({ sourceValue: value, input: selectedText || input });
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (!open) setOpen(true);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) =>
                Math.min(Math.max(0, matches.length - 1), h + 1)
              );
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(0, h - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const m = matches[activeHighlight];
              if (m) select(m);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={sets ? "Any set — type to filter" : "Loading sets…"}
          className="input pr-7"
        />
          {value ? (
          <button
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1 text-text-subtle hover:bg-surface-subtle hover:text-text"
            aria-label="Clear set filter"
            title="Clear"
          >
            ✕
          </button>
        ) : null}
      </div>

      {open && matches.length > 0 && (
        <ul className="thin-scroll absolute z-40 mt-2 max-h-72 w-[min(22rem,90vw)] overflow-y-auto rounded-xl border border-border bg-white p-1 shadow-xl">
          {matches.map((s, i) => (
            <li
              key={s.id}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                i === activeHighlight
                  ? "bg-[image:var(--rainbow-soft)] text-text"
                  : "hover:bg-surface-subtle"
              }`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                select(s);
              }}
            >
              {s.icon_svg_uri ? (
                <img
                  src={s.icon_svg_uri}
                  alt=""
                  width={18}
                  height={18}
                  className="h-[18px] w-[18px] shrink-0"
                  style={{ filter: "var(--set-icon-filter, none)" }}
                />
              ) : (
                <div className="h-[18px] w-[18px] shrink-0 rounded bg-surface-subtle" />
              )}
              <span className="flex-1 truncate">{s.name}</span>
              <span className="shrink-0 rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-[10px] uppercase text-text-muted">
                {s.code}
              </span>
              {s.released_at && (
                <span className="shrink-0 text-[10px] text-text-subtle tabular-nums">
                  {s.released_at.slice(0, 4)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function scoreSet(s: ScryfallSet, q: string): number {
  const name = s.name.toLowerCase();
  const code = s.code.toLowerCase();
  if (code === q) return 1000;
  if (name === q) return 900;
  if (code.startsWith(q)) return 700;
  if (name.startsWith(q)) return 500;
  if (code.includes(q)) return 300;
  if (name.includes(q)) return 200;
  // Initials match (e.g. "neo" → "Kamigawa: Neon Dynasty" "kn d")
  const initials = name
    .split(/[^a-z0-9]+/)
    .map((w) => w[0])
    .filter(Boolean)
    .join("");
  if (initials.includes(q)) return 100;
  return 0;
}
