"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { ScryfallCard } from "../lib/types";
import { getHybridCandidateOracleIds } from "../lib/cardFilterIndex";
import { oracleIdForCard } from "../lib/cardIdentity";
import {
  type AdvancedFilters,
  buildQuery,
  getCardBackImage,
  getCardImage,
  getCardsByIdentifiers,
  searchCards,
} from "../lib/scryfall";
import { searchOfflineCards } from "../lib/offline";
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
  offlineActive?: boolean;
  offlineReady?: boolean;
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
const HYBRID_RESULT_LIMIT = 32;
const HYBRID_POST_FILTER_FETCH_LIMIT = 256;
const MAX_EXACT_VECTOR_CANDIDATE_IDS = 1024;
export const MAX_SIMILARITY_SEEDS = 8;

function dedupeCards(cards: ScryfallCard[]): ScryfallCard[] {
  const byIdentity = new Map<string, ScryfallCard>();

  for (const card of cards) {
    const key = oracleIdForCard(card) ?? card.id;
    if (!byIdentity.has(key)) {
      byIdentity.set(key, card);
    }
  }

  return Array.from(byIdentity.values());
}

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
  offlineActive = false,
  offlineReady = false,
  similaritySeeds,
  onRemoveSimilaritySeed,
}: Props) {
  const [filters, setFilters] = useState<AdvancedFilters>({
    sort: "name",
    colorMode: "identity",
  });
  const [filtersExpanded, setFiltersExpanded] = useState(false);
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
      window.queueMicrotask(() => {
        if (runRef.current !== runId) return;
        setLoading(false);
        setError(null);
        setTotal(null);
      });
      return;
    }

    if (offlineActive && !offlineReady) {
      window.queueMicrotask(() => {
        if (runRef.current !== runId) return;
        setLoading(false);
        setError("Offline cache is not ready. Open Settings to download it.");
        setResults([]);
        setResultsKey(key);
        setTotal(null);
      });
      return;
    }

    debounceRef.current = window.setTimeout(async () => {
      debounceRef.current = null;
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      setError(null);
      try {
        if (offlineActive) {
          if (mode === "hybrid") {
            throw new Error(
              "Semantic and similarity search are unavailable while offline."
            );
          }
          const resp = await searchOfflineCards(filters, {
            limit: 75,
            signal: ac.signal,
          });
          if (runRef.current !== runId || abortRef.current !== ac || ac.signal.aborted) {
            return;
          }
          const deduped = dedupeCards(resp.data);
          setResults(deduped);
          setResultsKey(key);
          setTotal(deduped.length);
          return;
        }

        if (mode === "hybrid") {
          const constraintFilters = buildVectorConstraintFilters(
            filters,
            semanticRules
          );
          let candidateOracleIds: string[] | undefined;
          let postFilterOracleIds: Set<string> | undefined;
          if (filterQuery) {
            candidateOracleIds = await getHybridCandidateOracleIds(
              constraintFilters,
              ac.signal
            );
            if (runRef.current !== runId || ac.signal.aborted) return;
            if (candidateOracleIds.length === 0) {
              setResults([]);
              setResultsKey(key);
              setTotal(0);
              return;
            }
            if (candidateOracleIds.length > MAX_EXACT_VECTOR_CANDIDATE_IDS) {
              postFilterOracleIds = new Set(candidateOracleIds);
              candidateOracleIds = undefined;
            }
          }

          const matches = (await hybridCards({
            query: vectorQuery,
            oracleIds: seedOracleIds,
            candidateOracleIds,
            limit: postFilterOracleIds
              ? HYBRID_POST_FILTER_FETCH_LIMIT
              : HYBRID_RESULT_LIMIT,
          })) as SimilarCardMatch[];
          if (runRef.current !== runId || abortRef.current !== ac || ac.signal.aborted) {
            return;
          }
          let cards = await hydrateSimilarityMatches(matches, ac.signal);
          if (runRef.current !== runId || abortRef.current !== ac || ac.signal.aborted) {
            return;
          }
          if (postFilterOracleIds) {
            cards = cards
              .filter((card) => {
                const oracleId = oracleIdForCard(card);
                return oracleId ? postFilterOracleIds.has(oracleId) : false;
              })
              .slice(0, HYBRID_RESULT_LIMIT);
          }
          const deduped = dedupeCards(cards);
          setResults(deduped);
          setResultsKey(key);
          setTotal(deduped.length);
          return;
        }

        const resp = await searchCards(q, {
          order: filters.sort,
          signal: ac.signal,
        });
        if (runRef.current !== runId || abortRef.current !== ac || ac.signal.aborted) {
          return;
        }
        const deduped = dedupeCards(resp.data);
        setResults(deduped);
        setResultsKey(key);
        setTotal(deduped.length);
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
  }, [filters, semanticRules, seedKey, hybridCards, offlineActive, offlineReady]);

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
    setFiltersExpanded(false);
  }

  const activeFilterCount = countActiveFilters(filters, semanticRules);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={`search-filter-panel panel-heading thin-scroll shrink-0 overflow-visible border-b border-border px-3 py-2.5 ${
          filtersExpanded ? "search-filter-panel-expanded" : ""
        }`}
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-base font-semibold text-text lg:text-sm">Find cards</div>
            <div className="hidden text-[11px] text-text-subtle lg:block">
              {offlineActive ? "Local offline catalog" : "Scryfall catalog"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFiltersExpanded((expanded) => !expanded)}
              aria-expanded={filtersExpanded}
              className="control flex min-h-11 items-center gap-1.5 px-3 text-xs font-semibold lg:hidden"
            >
              Filters
              {activeFilterCount > 0 ? (
                <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {activeFilterCount}
                </span>
              ) : null}
            </button>
            <button
              onClick={clearAll}
              className="control min-h-11 px-3 text-xs font-semibold lg:min-h-0 lg:px-2 lg:py-1 lg:text-[11px] lg:font-normal"
            >
              Reset
            </button>
          </div>
        </div>

        {!filtersExpanded && (
          <div className="mb-2 lg:hidden">
            <Field label="Name">
              <input
                type="text"
                value={filters.name ?? ""}
                onChange={(e) => update("name", e.target.value)}
                className="input"
                placeholder="Search by card name"
              />
            </Field>
          </div>
        )}

        <div
          className={`grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 xl:grid-cols-4 ${
            filtersExpanded ? "" : "hidden lg:grid"
          }`}
        >
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
                    disabled={offlineActive}
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
                <option value="rarity">Rarity</option>
                <option value="released">Release date</option>
                <option value="usd">Price (USD)</option>
                <option value="edhrec">EDHREC popularity</option>
              </select>
            </Field>

            <div className="flex items-center justify-between min-[480px]:col-span-2 xl:col-span-4">
              <code className="min-w-0 truncate rounded-lg border border-border bg-white/70 px-2 py-1 font-mono text-[11px] text-text-muted shadow-sm">
                {queryPreview || "(empty query)"}
              </code>
            </div>
            {similaritySeeds.length > 0 && (
              <div className="min-[480px]:col-span-2 xl:col-span-4">
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
            const normal = offlineActive ? thumb : getCardImage(card, "normal");
            const back = offlineActive ? undefined : getCardBackImage(card, "normal");
            const isPreviewed = previewCardId != null && card.id === previewCardId;
            const oracleText = truncateText(
              getOracleText(card),
              CARD_TEXT_PREVIEW_LIMIT
            );
            return (
              <li
                key={oracleIdForCard(card) ?? card.id}
                aria-current={isPreviewed ? "true" : undefined}
                className={`mobile-search-result animate-row group relative grid cursor-pointer grid-cols-[56px_minmax(0,1fr)_2.75rem] items-center gap-2 px-3 py-2.5 transition sm:grid-cols-[72px_minmax(12rem,18rem)_minmax(4rem,auto)_2rem] sm:gap-3 sm:px-4 sm:py-3 xl:grid-cols-[72px_minmax(13rem,18rem)_minmax(0,1fr)_minmax(5rem,auto)_2rem] ${
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
                    className="h-[72px] w-[52px] shrink-0 rounded-md object-cover shadow-sm ring-1 ring-black/10 transition group-hover:shadow-md sm:h-[100px] sm:w-[72px] sm:rounded-lg"
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
                  className="search-add-btn control-primary flex shrink-0 items-center justify-center text-lg font-semibold sm:h-8 sm:w-8 sm:text-base"
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
    <div className="flex h-[72px] w-[52px] shrink-0 flex-col justify-between rounded-md border border-border bg-surface-subtle p-1 text-[8px] leading-tight text-text-muted ring-1 ring-black/5 sm:h-[100px] sm:w-[72px] sm:p-1.5 sm:text-[9px]">
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
  labelAccessory?: ReactNode;
  children: ReactNode;
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

function countActiveFilters(
  filters: AdvancedFilters,
  semanticRules: boolean
): number {
  let count = 0;
  if (filters.name?.trim()) count += 1;
  if (filters.oracle?.trim()) count += 1;
  if (filters.excludeOracle?.trim()) count += 1;
  if (filters.type?.trim()) count += 1;
  if (filters.set) count += 1;
  if (filters.colors?.length) count += 1;
  if (filters.rarity?.length) count += 1;
  if (filters.cmcMin !== undefined || filters.cmcMax !== undefined) count += 1;
  if (filters.power?.trim() || filters.toughness?.trim()) count += 1;
  if (filters.usdMin !== undefined || filters.usdMax !== undefined) count += 1;
  if (filters.format) count += 1;
  if (filters.sort && filters.sort !== "name") count += 1;
  if (semanticRules) count += 1;
  return count;
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
