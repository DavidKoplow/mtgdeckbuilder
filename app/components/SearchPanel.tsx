"use client";

import { useEffect, useRef, useState } from "react";
import type { ScryfallCard } from "../lib/types";
import {
  AdvancedFilters,
  buildQuery,
  getCardBackImage,
  getCardImage,
  searchCards,
} from "../lib/scryfall";
import { ManaCost, ManaPip } from "./ManaCost";
import { SetCombobox } from "./SetCombobox";

type Props = {
  onSelect: (card: ScryfallCard) => void;
  onAdd: (card: ScryfallCard) => void;
  onHover: (
    payload: { src?: string; backSrc?: string; x: number; y: number } | null
  ) => void;
  /** Scryfall card id — row is highlighted when it matches the preview pane */
  previewCardId?: string | null;
};

const COLORS: { sym: string; name: string }[] = [
  { sym: "W", name: "White" },
  { sym: "U", name: "Blue" },
  { sym: "B", name: "Black" },
  { sym: "R", name: "Red" },
  { sym: "G", name: "Green" },
];
const RARITIES = ["common", "uncommon", "rare", "mythic"];

export function SearchPanel({
  onSelect,
  onAdd,
  onHover,
  previewCardId = null,
}: Props) {
  const [filters, setFilters] = useState<AdvancedFilters>({
    sort: "name",
    colorMode: "identity",
  });
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queryPreview, setQueryPreview] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    const q = buildQuery(filters);
    setQueryPreview(q);
    if (!q) {
      setResults([]);
      setTotal(null);
      setError(null);
      return;
    }

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      setError(null);
      try {
        const resp = await searchCards(q, {
          order: filters.sort,
          signal: ac.signal,
        });
        setResults(resp.data);
        setTotal(resp.total_cards ?? resp.data.length);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
        setResults([]);
        setTotal(null);
      } finally {
        setLoading(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [filters]);

  function update<K extends keyof AdvancedFilters>(
    key: K,
    value: AdvancedFilters[K]
  ) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  function toggleColor(sym: string) {
    setFilters((f) => {
      const current = new Set(f.colors ?? []);
      if (current.has(sym)) current.delete(sym);
      else current.add(sym);
      return { ...f, colors: Array.from(current) };
    });
  }

  function toggleRarity(r: string) {
    setFilters((f) => {
      const current = new Set(f.rarity ?? []);
      if (current.has(r)) current.delete(r);
      else current.add(r);
      return { ...f, rarity: Array.from(current) };
    });
  }

  function clearAll() {
    setFilters({ sort: "name", colorMode: "identity" });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="thin-scroll shrink-0 overflow-y-auto border-b border-border bg-surface px-4 py-3"
        style={{ height: "40vh" }}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Name contains">
              <input
                type="text"
                value={filters.name ?? ""}
                onChange={(e) => update("name", e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Rules Text">
              <input
                type="text"
                value={filters.oracle ?? ""}
                onChange={(e) => update("oracle", e.target.value)}
                placeholder="e.g. draw, flying, sacrifice"
                className="input"
              />
            </Field>
            <Field label="Exclude rules text">
              <input
                type="text"
                value={filters.excludeOracle ?? ""}
                onChange={(e) => update("excludeOracle", e.target.value)}
                placeholder="comma-separated, e.g. discard, exile"
                className="input"
              />
            </Field>
            <Field label="Type line">
              <input
                type="text"
                value={filters.type ?? ""}
                onChange={(e) => update("type", e.target.value)}
                placeholder="e.g. creature, instant, goblin"
                className="input"
              />
            </Field>
            <Field label="Set">
              <SetCombobox
                value={filters.set}
                onChange={(code) => update("set", code)}
              />
            </Field>

            <Field label="Colors">
              <div className="flex flex-wrap items-center gap-1.5">
                {COLORS.map((c) => {
                  const on = (filters.colors ?? []).includes(c.sym);
                  return (
                    <button
                      key={c.sym}
                      onClick={() => toggleColor(c.sym)}
                      title={c.name}
                      aria-pressed={on}
                      className={`flex h-7 w-7 items-center justify-center rounded-full ring-2 transition ${
                        on
                          ? "ring-accent"
                          : "ring-transparent opacity-60 hover:opacity-100"
                      }`}
                    >
                      <ManaPip symbol={c.sym} size={20} />
                    </button>
                  );
                })}
                <select
                  value={filters.colorMode ?? "identity"}
                  onChange={(e) =>
                    update(
                      "colorMode",
                      e.target.value as AdvancedFilters["colorMode"]
                    )
                  }
                  className="ml-2 rounded-md border border-border bg-white px-2 py-1 text-xs"
                >
                  <option value="identity">Identity ⊆</option>
                  <option value="exact">Exactly =</option>
                  <option value="including">Including ⊇</option>
                  <option value="at-most">At most ⊆</option>
                </select>
              </div>
            </Field>

            <Field label="Rarity">
              <div className="flex flex-wrap gap-1.5">
                {RARITIES.map((r) => {
                  const on = (filters.rarity ?? []).includes(r);
                  return (
                    <button
                      key={r}
                      onClick={() => toggleRarity(r)}
                      className={`rounded-full border px-2.5 py-0.5 text-xs capitalize transition ${
                        on
                          ? "border-accent bg-accent-subtle text-accent"
                          : "border-border bg-surface text-text-muted hover:text-text"
                      }`}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Mana value (CMC)">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={filters.cmcMin ?? ""}
                  onChange={(e) =>
                    update(
                      "cmcMin",
                      e.target.value === "" ? undefined : Number(e.target.value)
                    )
                  }
                  className="input w-20"
                  placeholder="min"
                />
                <span className="text-text-subtle">–</span>
                <input
                  type="number"
                  min={0}
                  value={filters.cmcMax ?? ""}
                  onChange={(e) =>
                    update(
                      "cmcMax",
                      e.target.value === "" ? undefined : Number(e.target.value)
                    )
                  }
                  className="input w-20"
                  placeholder="max"
                />
              </div>
            </Field>

            <Field label="Power / Toughness">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={filters.power ?? ""}
                  onChange={(e) => update("power", e.target.value)}
                  placeholder="power (e.g. >=4)"
                  className="input"
                />
                <input
                  type="text"
                  value={filters.toughness ?? ""}
                  onChange={(e) => update("toughness", e.target.value)}
                  placeholder="toughness"
                  className="input"
                />
              </div>
            </Field>

            <Field label="Price (USD)">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={filters.usdMin ?? ""}
                  onChange={(e) =>
                    update(
                      "usdMin",
                      e.target.value === "" ? undefined : Number(e.target.value)
                    )
                  }
                  className="input w-24"
                  placeholder="min $"
                />
                <span className="text-text-subtle">–</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={filters.usdMax ?? ""}
                  onChange={(e) =>
                    update(
                      "usdMax",
                      e.target.value === "" ? undefined : Number(e.target.value)
                    )
                  }
                  className="input w-24"
                  placeholder="max $"
                />
              </div>
            </Field>

            <Field label="Format legality">
              <select
                value={filters.format ?? ""}
                onChange={(e) => update("format", e.target.value || undefined)}
                className="input"
              >
                <option value="">Any</option>
                <option value="standard">Standard</option>
                <option value="pioneer">Pioneer</option>
                <option value="modern">Modern</option>
                <option value="legacy">Legacy</option>
                <option value="vintage">Vintage</option>
                <option value="commander">Commander</option>
                <option value="pauper">Pauper</option>
              </select>
            </Field>

            <Field label="Sort">
              <select
                value={filters.sort ?? "name"}
                onChange={(e) =>
                  update("sort", e.target.value as AdvancedFilters["sort"])
                }
                className="input"
              >
                <option value="name">Name</option>
                <option value="cmc">Mana value</option>
                <option value="color">Color</option>
                <option value="released">Release date</option>
                <option value="usd">Price (USD)</option>
                <option value="edhrec">EDHREC popularity</option>
              </select>
            </Field>

          <div className="md:col-span-2 flex items-center justify-between pt-1">
            <code className="truncate rounded bg-surface-subtle px-2 py-1 font-mono text-xs text-text-muted">
              {queryPreview || "(empty query)"}
            </code>
            <button
              onClick={clearAll}
              className="text-xs text-text-subtle hover:text-text"
            >
              Clear all
            </button>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between border-b border-border bg-surface-subtle px-4 py-1.5 text-xs text-text-muted">
        <span>
          {loading ? (
            "Searching…"
          ) : error ? (
            <span className="text-[color:var(--danger)]">{error}</span>
          ) : total === null ? (
            "Use filters above to search"
          ) : (
            `${total.toLocaleString()} cards`
          )}
        </span>
        {results.length > 0 && (
          <span className="text-text-subtle">
            Click a card for details · + to add to deck
          </span>
        )}
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-surface">
        {results.length === 0 && !loading && !error && queryPreview && (
          <div className="flex h-full items-center justify-center p-8 text-sm text-text-subtle">
            No cards matched that search.
          </div>
        )}
        {!queryPreview && !loading && <EmptyState />}
        <ul className="divide-y divide-border">
          {results.map((card) => {
            const thumb = getCardImage(card, "small");
            const normal = getCardImage(card, "normal");
            const back = getCardBackImage(card, "normal");
            const isPreviewed = previewCardId != null && card.id === previewCardId;
            return (
              <li
                key={card.id}
                aria-current={isPreviewed ? "true" : undefined}
                className={`group flex cursor-pointer items-center gap-3 px-4 py-2.5 transition ${
                  isPreviewed
                    ? "bg-accent-subtle ring-2 ring-inset ring-accent/70"
                    : "hover:bg-accent-subtle"
                }`}
                onClick={() => onSelect(card)}
                onMouseEnter={(e) =>
                  onHover({
                    src: normal,
                    backSrc: back,
                    x: e.clientX,
                    y: e.clientY,
                  })
                }
                onMouseMove={(e) =>
                  onHover({
                    src: normal,
                    backSrc: back,
                    x: e.clientX,
                    y: e.clientY,
                  })
                }
                onMouseLeave={() => onHover(null)}
              >
                {thumb ? (
                  <img
                    src={thumb}
                    alt=""
                    width={72}
                    height={100}
                    className="h-[100px] w-[72px] shrink-0 rounded-md ring-1 ring-black/10"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-[100px] w-[72px] shrink-0 rounded-md bg-surface-subtle" />
                )}
                <div className="min-w-0 basis-[38%] shrink-0">
                  <div className="truncate text-sm font-medium">
                    {card.name}
                  </div>
                  <div className="truncate text-xs text-text-muted">
                    {card.type_line || card.card_faces?.[0]?.type_line}
                  </div>
                  <div className="mt-1 truncate text-[11px] text-text-subtle">
                    {card.set_name}
                    {card.rarity ? ` · ${card.rarity}` : ""}
                  </div>
                </div>
                <div className="min-w-0 flex-1 whitespace-pre-wrap text-[11px] leading-snug text-text-muted line-clamp-5">
                  {getOracleText(card) || (
                    <span className="italic text-text-subtle">—</span>
                  )}
                </div>
                <ManaCost
                  cost={card.mana_cost || card.card_faces?.[0]?.mana_cost}
                  size={20}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdd(card);
                  }}
                  className="shrink-0 rounded-md border border-border bg-white px-2.5 py-1.5 text-sm font-medium text-text-muted transition hover:border-accent hover:bg-accent hover:text-white"
                  aria-label={`Add ${card.name} to deck`}
                  title="Add to deck"
                >
                  +
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function getOracleText(card: ScryfallCard): string {
  if (card.oracle_text?.trim()) return card.oracle_text;
  const faces = card.card_faces
    ?.map((f) => f.oracle_text?.trim())
    .filter(Boolean);
  return faces?.join("\n//\n") ?? "";
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium text-text-muted">{label}</span>
      {children}
    </label>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="text-sm text-text-muted">
        enter search information to see results
      </div>
    </div>
  );
}
