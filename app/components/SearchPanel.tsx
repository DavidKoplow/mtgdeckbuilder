"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { ScryfallCard } from "../lib/types";
import { oracleIdForCard } from "../lib/cardIdentity";
import {
  type AdvancedFilters,
  buildQuery,
  getCardBackImage,
  getCardImage,
  getCardsByIdentifiers,
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
  semanticRules: boolean;
  onSemanticRulesChange: (enabled: boolean) => void;
  similaritySeeds: ScryfallCard[];
  onRemoveSimilaritySeed: (oracleId: string) => void;
};

const COLORS: { sym: string; name: string }[] = [
  { sym: "W", name: "White" },
  { sym: "U", name: "Blue" },
  { sym: "B", name: "Black" },
  { sym: "R", name: "Red" },
  { sym: "G", name: "Green" },
];
const RARITIES = ["common", "uncommon", "rare", "mythic"];
const SEARCH_DEBOUNCE_MS = 250;
const CARD_TEXT_PREVIEW_LIMIT = 1024;
export const MAX_SIMILARITY_SEEDS = 8;
type SearchRunMode = "raw" | "hybrid";

type SimilarCardMatch = {
  oracle_id: string;
  similarity: number;
};

export function SearchPanel({
  onSelect,
  onAdd,
  onHover,
  previewCardId = null,
  semanticRules,
  onSemanticRulesChange,
  similaritySeeds,
  onRemoveSimilaritySeed,
}: Props) {
  const [filters, setFilters] = useState<AdvancedFilters>({
    sort: "name",
    colorMode: "identity",
  });
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [resultsKey, setResultsKey] = useState("");
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hybridCards = useAction(api.cardEmbeddings.hybridCards);
  const seedOracleIds = similaritySeeds
    .map(oracleIdForCard)
    .filter((oracleId): oracleId is string => oracleId !== undefined);
  const seedKey = seedOracleIds.join("|");
  const searchRequest = buildSearchRequest(filters, semanticRules, seedOracleIds);
  const queryPreview = searchRequest.query;
  const hasCurrentResults = resultsKey === searchRequest.key;
  const visibleResults =
    searchRequest.ready && hasCurrentResults ? results : [];
  const visibleTotal = hasCurrentResults ? total : null;

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);
  const runRef = useRef(0);

  useEffect(() => {
    const {
      query: q,
      mode,
      key,
      filterQuery,
      vectorQuery,
      seedOracleIds,
      ready,
    } = buildSearchRequest(filters, semanticRules, seedKey ? seedKey.split("|") : []);
    const runId = runRef.current + 1;
    runRef.current = runId;

    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    abortRef.current?.abort();
      abortRef.current = null;

      if (!ready) {
        setLoading(false);
        setError(null);
        setTotal(null);
        return;
      }

    debounceRef.current = window.setTimeout(async () => {
      debounceRef.current = null;
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      setError(null);
      try {
        if (mode === "hybrid") {
          let candidateOracleIds: string[] | undefined;
          if (filterQuery) {
            const filtered = await searchCards(filterQuery, {
              order: filters.sort,
              signal: ac.signal,
            });
            if (runRef.current !== runId || ac.signal.aborted) return;
            candidateOracleIds = filtered.data
              .map(oracleIdForCard)
              .filter((oracleId): oracleId is string => oracleId !== undefined);
            if (candidateOracleIds.length === 0) {
              setResults([]);
              setResultsKey(key);
              setTotal(0);
              return;
            }
          }

          const matches = (await hybridCards({
            query: vectorQuery,
            oracleIds: seedOracleIds,
            candidateOracleIds,
            limit: 32,
          })) as SimilarCardMatch[];
          if (runRef.current !== runId || abortRef.current !== ac || ac.signal.aborted) {
            return;
          }
          const cards = await hydrateSimilarityMatches(matches, ac.signal);
          if (runRef.current !== runId || abortRef.current !== ac || ac.signal.aborted) {
            return;
          }
          setResults(cards);
          setResultsKey(key);
          setTotal(cards.length);
          return;
        }

        const resp = await searchCards(q, {
          order: filters.sort,
          signal: ac.signal,
        });
        if (runRef.current !== runId || abortRef.current !== ac || ac.signal.aborted) {
          return;
        }
        setResults(resp.data);
        setResultsKey(key);
        setTotal(resp.total_cards ?? resp.data.length);
      } catch (e) {
        if (runRef.current !== runId || abortRef.current !== ac || ac.signal.aborted) {
          return;
        }
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
        setResults([]);
        setTotal(null);
      } finally {
        if (runRef.current === runId && abortRef.current === ac) {
          abortRef.current = null;
          setLoading(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      abortRef.current?.abort();
      abortRef.current = null;
      runRef.current += 1;
    };
  }, [filters, semanticRules, seedKey, hybridCards]);

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
    onSemanticRulesChange(false);
    setFilters({ sort: "name", colorMode: "identity" });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="search-filter-panel panel-heading shrink-0 overflow-visible border-b border-border px-3 py-2.5"
        style={{ height: "var(--workspace-top-height)" }}
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-text">Find cards</div>
            <div className="text-[11px] text-text-subtle">Scryfall catalog</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={clearAll} className="control px-2 py-1 text-[11px]">
              Reset
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            <Field label="Name">
              <input
                type="text"
                value={filters.name ?? ""}
                onChange={(e) => update("name", e.target.value)}
                className="input"
              />
            </Field>
            <Field
              label="Rules text"
              labelAccessory={
                <label className="flex items-center gap-1 text-[10px] font-medium text-text-muted">
                  <input
                    type="checkbox"
                    checked={semanticRules}
                    onChange={(e) => onSemanticRulesChange(e.target.checked)}
                    className="h-3 w-3 accent-accent"
                  />
                  Semantic
                </label>
              }
            >
              <input
                type="text"
                value={filters.oracle ?? ""}
                onChange={(e) => update("oracle", e.target.value)}
                placeholder={
                  semanticRules
                    ? "cheap protection, sacrifice payoff"
                    : "draw, flying, sacrifice"
                }
                className="input"
              />
            </Field>
            <Field label="Exclude">
              <input
                type="text"
                value={filters.excludeOracle ?? ""}
                onChange={(e) => update("excludeOracle", e.target.value)}
                placeholder="discard, exile"
                className="input"
              />
            </Field>
            <Field label="Type">
              <input
                type="text"
                value={filters.type ?? ""}
                onChange={(e) => update("type", e.target.value)}
                placeholder="creature, instant"
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
              <div className="flex flex-wrap items-center gap-1">
                {COLORS.map((c) => {
                  const on = (filters.colors ?? []).includes(c.sym);
                  return (
                    <button
                      key={c.sym}
                      onClick={() => toggleColor(c.sym)}
                      title={c.name}
                      aria-pressed={on}
                      className={`flex h-6 w-6 items-center justify-center rounded-full ring-2 transition ${
                        on
                          ? "ring-accent"
                          : "ring-transparent opacity-60 hover:opacity-100"
                      }`}
                    >
                      <ManaPip symbol={c.sym} size={18} />
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
                  className="control ml-1 px-2 py-1 text-[11px]"
                >
                  <option value="identity">Identity ⊆</option>
                  <option value="exact">Exactly =</option>
                  <option value="including">Including ⊇</option>
                  <option value="at-most">At most ⊆</option>
                </select>
              </div>
            </Field>

            <Field label="Rarity">
              <div className="flex flex-wrap gap-1">
                {RARITIES.map((r) => {
                  const on = (filters.rarity ?? []).includes(r);
                  return (
                    <button
                      key={r}
                      onClick={() => toggleRarity(r)}
                    className={`rounded-full border px-2 py-0.5 text-[11px] capitalize transition ${
                        on
                          ? "border-transparent bg-[image:var(--rainbow-soft)] text-text shadow-sm ring-1 ring-accent/30"
                          : "border-border bg-surface-raised text-text-muted hover:border-border-strong hover:text-text"
                      }`}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Mana value (CMC)">
              <div className="flex items-center gap-1.5">
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
                  className="input w-16"
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
                  className="input w-16"
                  placeholder="max"
                />
              </div>
            </Field>

            <Field label="Power / toughness">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={filters.power ?? ""}
                  onChange={(e) => update("power", e.target.value)}
                  placeholder="power"
                  className="input"
                />
                <input
                  type="text"
                  value={filters.toughness ?? ""}
                  onChange={(e) => update("toughness", e.target.value)}
                  placeholder="tough."
                  className="input"
                />
              </div>
            </Field>

            <Field label="Price">
              <div className="flex items-center gap-1.5">
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
                  className="input w-20"
                  placeholder="min"
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
                  className="input w-20"
                  placeholder="max"
                />
              </div>
            </Field>

            <Field label="Format">
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

            <div className="flex items-center justify-between xl:col-span-4">
              <code className="min-w-0 truncate rounded-lg border border-border bg-white/70 px-2 py-1 font-mono text-[11px] text-text-muted shadow-sm">
                {queryPreview || "(empty query)"}
              </code>
            </div>
            {similaritySeeds.length > 0 && (
              <div className="xl:col-span-4">
                <SimilaritySeedPreview
                  seeds={similaritySeeds}
                  onRemove={onRemoveSimilaritySeed}
                />
              </div>
            )}
          </div>
      </div>

      <div className="flex shrink-0 items-center justify-between border-b border-border bg-surface-subtle/80 px-3 py-2 text-xs text-text-muted sm:px-4">
        <span>
          {!searchRequest.ready ? (
            "No query active"
          ) : loading ? (
            "Searching…"
          ) : error ? (
            <span className="text-[color:var(--danger)]">{error}</span>
          ) : visibleTotal === null ? (
            "No query active"
          ) : (
            `${visibleTotal.toLocaleString()} cards`
          )}
        </span>
        {visibleResults.length > 0 && (
          <span className="text-text-subtle">Results</span>
        )}
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-surface">
        {visibleResults.length === 0 && !loading && !error && searchRequest.ready && (
          <div className="flex h-full items-center justify-center p-8 text-sm text-text-subtle">
            <div className="empty-pill rounded-full px-4 py-2">No cards matched that search.</div>
          </div>
        )}
        {!searchRequest.ready && <EmptyState />}
        <ul className="divide-y divide-border">
          {visibleResults.map((card, index) => {
            const thumb = getCardImage(card, "small");
            const normal = getCardImage(card, "normal");
            const back = getCardBackImage(card, "normal");
            const isPreviewed = previewCardId != null && card.id === previewCardId;
            const oracleText = truncateText(
              getOracleText(card),
              CARD_TEXT_PREVIEW_LIMIT
            );
            return (
              <li
                key={card.id}
                aria-current={isPreviewed ? "true" : undefined}
                className={`animate-row group relative grid cursor-pointer grid-cols-[62px_minmax(0,1fr)_2rem] items-start gap-2 px-3 py-3 transition sm:grid-cols-[72px_minmax(12rem,18rem)_minmax(4rem,auto)_2rem] sm:gap-3 sm:px-4 xl:grid-cols-[72px_minmax(13rem,18rem)_minmax(0,1fr)_minmax(5rem,auto)_2rem] ${
                  isPreviewed
                    ? "bg-[image:var(--rainbow-soft)] ring-2 ring-inset ring-accent/60"
                    : "hover:bg-surface-tint/80"
                }`}
                style={{
                  animationDelay: `${Math.min(160, index * 18)}ms`,
                }}
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
                    className="h-[86px] w-[62px] shrink-0 rounded-lg object-cover shadow-sm ring-1 ring-black/10 transition group-hover:shadow-md sm:h-[100px] sm:w-[72px]"
                    loading="lazy"
                  />
                ) : (
                  <LocalCardThumb card={card} />
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-text">
                    {card.name}
                  </div>
                  <div className="truncate text-xs text-text-muted">
                    {card.type_line || card.card_faces?.[0]?.type_line}
                  </div>
                  <div className="mt-1 truncate text-[11px] capitalize text-text-subtle">
                    {card.set_name}
                    {card.rarity ? ` · ${card.rarity}` : ""}
                    {typeof card.rerank_score === "number"
                      ? ` · ${(card.rerank_score * 100).toFixed(1)}%`
                      : typeof card.similarity === "number"
                      ? ` · ${(card.similarity * 100).toFixed(1)}%`
                      : ""}
                  </div>
                </div>
                <div className="hidden min-w-0 whitespace-pre-wrap text-[11px] leading-snug text-text-muted line-clamp-5 xl:block">
                  {oracleText || (
                    <span className="italic text-text-subtle">—</span>
                  )}
                </div>
                <div className="hidden min-h-8 min-w-0 justify-end sm:flex">
                  <ManaCost
                    cost={card.mana_cost || card.card_faces?.[0]?.mana_cost}
                    size={20}
                  />
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdd(card);
                  }}
                  className="control-primary flex h-8 w-8 shrink-0 items-center justify-center text-base font-semibold"
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

function LocalCardThumb({ card }: { card: ScryfallCard }) {
  return (
    <div className="flex h-[86px] w-[62px] shrink-0 flex-col justify-between rounded-md border border-border bg-surface-subtle p-1.5 text-[9px] leading-tight text-text-muted ring-1 ring-black/5 sm:h-[100px] sm:w-[72px]">
      <div className="min-w-0">
        <div className="line-clamp-3 font-semibold text-text">{card.name}</div>
        <div className="mt-1 line-clamp-2">{card.type_line}</div>
      </div>
      <div className="flex items-center justify-between gap-1">
        <ManaCost cost={card.mana_cost || card.card_faces?.[0]?.mana_cost} size={12} />
        {typeof card.cmc === "number" && (
          <span className="rounded bg-white/80 px-1 font-mono text-[8px]">
            {card.cmc}
          </span>
        )}
      </div>
    </div>
  );
}

function SimilaritySeedPreview({
  seeds,
  onRemove,
}: {
  seeds: ScryfallCard[];
  onRemove: (oracleId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-white/60 p-2 shadow-sm">
      <div className="mb-1.5 flex items-center justify-between text-[10px] text-text-muted">
        <span className="font-medium">Selected similar cards</span>
        <span className="tabular-nums text-text-subtle">
          {seeds.length}/{MAX_SIMILARITY_SEEDS}
        </span>
      </div>
      <div className="thin-scroll flex gap-1.5 overflow-x-auto pb-0.5">
        {seeds.map((card) => {
          const oracleId = oracleIdForCard(card);
          const thumb = getCardImage(card, "small");
          return (
            <div
              key={oracleId ?? card.id}
              className="flex w-32 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-white p-1 shadow-sm"
            >
              {thumb ? (
                <img
                  src={thumb}
                  alt=""
                  className="h-10 w-7 shrink-0 rounded object-cover ring-1 ring-black/10"
                />
              ) : (
                <div className="h-10 w-7 shrink-0 rounded bg-surface-subtle" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10px] font-medium text-text">
                  {card.name}
                </div>
                <button
                  type="button"
                  onClick={() => oracleId && onRemove(oracleId)}
                  className="mt-0.5 text-[10px] font-medium text-text-subtle transition hover:text-accent"
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
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

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

async function hydrateSimilarityMatches(
  matches: SimilarCardMatch[],
  signal: AbortSignal
): Promise<ScryfallCard[]> {
  const oracleIds = matches
    .map((match) => match.oracle_id)
    .filter((oracleId) => oracleId.length > 0);
  if (oracleIds.length === 0) return [];

  const hydrated = await getCardsByIdentifiers(
    oracleIds.map((oracle_id) => ({ oracle_id })),
    signal
  );
  const hydratedByOracleId = new Map(
    hydrated
      .map((card) => {
        const oracleId = oracleIdForCard(card);
        return oracleId ? ([oracleId, card] as const) : null;
      })
      .filter((entry): entry is readonly [string, ScryfallCard] => entry !== null)
  );

  const cards: ScryfallCard[] = [];
  for (const match of matches) {
    const card = hydratedByOracleId.get(match.oracle_id);
    if (!card) continue;
    cards.push({ ...card, similarity: match.similarity });
  }
  return cards;
}

function Field({
  label,
  labelAccessory,
  children,
}: {
  label: string;
  labelAccessory?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 text-[11px]">
      <div className="flex min-h-4 items-center justify-between gap-2 px-0.5">
        <span className="font-medium text-text-muted">{label}</span>
        {labelAccessory}
      </div>
      {children}
    </div>
  );
}

function buildSearchRequest(
  filters: AdvancedFilters,
  semanticRules: boolean,
  seedOracleIds: string[]
) {
  const rulesText = filters.oracle?.trim() ?? "";
  const vectorQuery = semanticRules ? rulesText : "";
  const usesVector = vectorQuery.length > 0 || seedOracleIds.length > 0;

  if (usesVector) {
    const filterQuery = buildQuery(buildVectorConstraintFilters(filters, semanticRules));
    const parts: string[] = [];
    if (vectorQuery) parts.push(`semantic rules: ${vectorQuery}`);
    if (seedOracleIds.length > 0) {
      parts.push(
        `similar to ${seedOracleIds.length} selected card${
          seedOracleIds.length === 1 ? "" : "s"
        }`
      );
    }
    return {
      mode: "hybrid" as SearchRunMode,
      key: `hybrid:${semanticRules}:${seedOracleIds.join("|")}:${JSON.stringify(filters)}`,
      query: `${parts.join(" + ")}${filterQuery ? ` within ${filterQuery}` : ""}`,
      filterQuery,
      ready: true,
      vectorQuery,
      seedOracleIds,
    };
  }

  const query = buildQuery(filters);

  return {
    mode: "raw" as SearchRunMode,
    key: `raw:${query}:${JSON.stringify(filters)}`,
    query,
    filterQuery: "",
    ready: query.length > 0,
    vectorQuery: "",
    seedOracleIds,
  };
}

function buildVectorConstraintFilters(
  filters: AdvancedFilters,
  semanticRules: boolean
): AdvancedFilters {
  const rest = { ...filters };
  delete rest.text;
  delete rest.sort;
  if (semanticRules) delete rest.oracle;
  return rest;
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="empty-pill rounded-full px-4 py-2 text-sm text-text-muted">
        Ready
      </div>
    </div>
  );
}
