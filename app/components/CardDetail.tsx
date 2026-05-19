"use client";

import { useState, type ReactNode } from "react";
import type { ScryfallCard } from "../lib/types";
import { getCardImage } from "../lib/scryfall";
import { ManaCost } from "./ManaCost";

type Props = {
  card: ScryfallCard;
  onBack: () => void;
  deckQuantity: number;
  onDeckQuantityChange: (card: ScryfallCard, quantity: number) => void;
  isCommander?: boolean;
  onCommanderChange?: (card: ScryfallCard, isCommander: boolean) => void;
  onToggleSimilaritySeed?: (card: ScryfallCard) => void;
  isSimilaritySeed?: boolean;
  similaritySeedDisabled?: boolean;
  offlineActive?: boolean;
  headerAccessory?: ReactNode;
};

export function CardDetail({
  card,
  onBack,
  deckQuantity,
  onDeckQuantityChange,
  isCommander = false,
  onCommanderChange,
  onToggleSimilaritySeed,
  isSimilaritySeed = false,
  similaritySeedDisabled = false,
  offlineActive = false,
  headerAccessory,
}: Props) {
  const [face, setFace] = useState(0);

  const hasFaces = (card.card_faces?.length ?? 0) >= 2;
  const activeFace = hasFaces ? card.card_faces![face] : undefined;

  const img = offlineActive
    ? hasFaces
      ? activeFace?.image_uris?.small ?? getCardImage(card, "small")
      : getCardImage(card, "small")
    : hasFaces
      ? activeFace?.image_uris?.large ??
        activeFace?.image_uris?.normal ??
        getCardImage(card, "large")
      : getCardImage(card, "large") ?? getCardImage(card, "normal");

  const name = activeFace?.name ?? card.name;
  const mana = activeFace?.mana_cost ?? card.mana_cost;
  const typeLine = activeFace?.type_line ?? card.type_line;
  const text = activeFace?.oracle_text ?? card.oracle_text;
  const power = activeFace?.power ?? card.power;
  const toughness = activeFace?.toughness ?? card.toughness;
  const loyalty = card.loyalty;

  return (
    <div className="mobile-card-sheet-content flex h-full min-h-0 flex-col">
      <div className="panel-heading hidden items-center justify-between border-b border-border px-2 py-1.5 sm:px-3 sm:py-2 lg:flex lg:px-4 lg:py-2.5">
        <div className="text-xs font-semibold text-text sm:text-sm">
          Card Preview
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          {headerAccessory}
          <a
            href={card.scryfall_uri}
            target="_blank"
            rel="noreferrer"
            className="control px-2 py-1 text-[11px] sm:px-2.5 sm:py-1.5 sm:text-xs"
          >
            Scryfall
          </a>
          <button
            onClick={onBack}
            className="control p-1.5 sm:p-2"
            aria-label="Close preview"
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

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto bg-surface">
        <div className="card-detail-layout grid h-full min-h-0 grid-cols-[minmax(4.75rem,7rem)_minmax(0,1fr)] items-stretch gap-3 p-3 lg:h-auto lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] lg:gap-4 lg:p-4 xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <div className="card-detail-media flex h-full min-h-0 flex-col items-stretch gap-2 lg:h-auto lg:items-center">
            <div className="flex min-h-0 flex-1 items-center justify-center lg:block lg:flex-none">
              {img ? (
                <img
                  src={img}
                  alt={name}
                  className="w-full max-w-[7rem] rounded-lg shadow-md ring-1 ring-black/10 lg:max-w-[16rem] lg:rounded-xl lg:shadow-lg xl:max-w-[18rem]"
                  draggable={false}
                />
              ) : (
                <div className="aspect-[488/680] w-full rounded-[14px] bg-surface-subtle" />
              )}
            </div>
            <div className="card-detail-mobile-stats flex w-full flex-wrap justify-start gap-1 lg:hidden">
              {power && toughness && (
                <span className="flex h-7 items-center rounded-md border border-border bg-white/78 px-2 text-[10px] text-text-muted shadow-sm">
                  <span className="font-semibold text-text">P/T:</span>
                  <span className="ml-1 tabular-nums">
                    {power}/{toughness}
                  </span>
                </span>
              )}
              {loyalty && (
                <span className="flex h-7 items-center rounded-md border border-border bg-white/78 px-2 text-[10px] text-text-muted shadow-sm">
                  <span className="font-semibold text-text">Loyalty:</span>
                  <span className="ml-1 tabular-nums">{loyalty}</span>
                </span>
              )}
            </div>
          </div>

          <div className="card-detail-body flex h-full min-h-0 min-w-0 flex-col gap-2 overflow-hidden lg:gap-2.5">
            <div className="card-detail-summary">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="line-clamp-2 text-sm font-semibold leading-tight lg:text-lg">
                  {name}
                </h2>
                <ManaCost cost={mana} size={18} />
              </div>
              <div className="mt-0.5 line-clamp-1 text-[10px] text-text-muted sm:text-[11px] lg:text-xs">
                {typeLine}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                {card.set_name && (
                  <span className="card-detail-desktop-tag hidden rounded-full border border-border bg-white/80 px-2 py-0.5 text-text-muted shadow-sm lg:inline-flex">
                    {card.set_name} ·{" "}
                    <span className="font-mono uppercase">{card.set}</span>
                  </span>
                )}
                {card.rarity && (
                  <span className="rounded-full border border-border bg-white/80 px-2 py-0.5 capitalize text-text-muted shadow-sm">
                    {card.rarity}
                  </span>
                )}
                {typeof card.cmc === "number" && (
                  <span className="card-detail-desktop-tag hidden rounded-full border border-border bg-white/80 px-2 py-0.5 text-text-muted shadow-sm lg:inline-flex">
                    Mana value {card.cmc}
                  </span>
                )}
                {card.prices?.usd && (
                  <span className="rounded-full border border-border bg-white/80 px-2 py-0.5 text-text-muted shadow-sm">
                    ${card.prices.usd}
                  </span>
                )}
              </div>
            </div>

            <section className="card-detail-rules flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex min-h-6 items-center justify-between gap-2 lg:min-h-7">
                <h3 className="text-[11px] font-semibold uppercase text-text-subtle">
                  Rules Text
                </h3>
                {hasFaces && (
                  <button
                    onClick={() => setFace((f) => (f === 0 ? 1 : 0))}
                    className="control px-2 py-0.5 text-[10px] font-medium lg:py-1 lg:text-[11px]"
                  >
                    Flip
                  </button>
                )}
              </div>
              <div className="card-rules-text thin-scroll mt-0.5 min-h-16 flex-1 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-white/78 p-1.5 text-[10px] leading-tight shadow-sm lg:mt-1 lg:min-h-24 lg:rounded-lg lg:p-2.5 lg:text-[12px] lg:leading-snug">
                {text || (
                  <span className="text-text-subtle">
                    (No rules text for this card.)
                  </span>
                )}
              </div>
            </section>

            <div className="card-detail-controls flex flex-wrap items-center gap-2 pt-1">
              <div className="card-detail-stats hidden shrink-0 flex-wrap items-center gap-1.5 lg:flex lg:gap-2">
                {power && toughness && (
                  <span className="flex h-7 items-center rounded-md border border-border bg-white/78 px-2 text-[10px] text-text-muted shadow-sm lg:h-9 lg:px-2.5 lg:text-xs">
                    <span className="font-semibold text-text">P/T:</span>
                    <span className="ml-1 tabular-nums">
                      {power}/{toughness}
                    </span>
                  </span>
                )}
                {loyalty && (
                  <span className="flex h-7 items-center rounded-md border border-border bg-white/78 px-2 text-[10px] text-text-muted shadow-sm lg:h-9 lg:px-2.5 lg:text-xs">
                    <span className="font-semibold text-text">Loyalty:</span>
                    <span className="ml-1 tabular-nums">{loyalty}</span>
                  </span>
                )}
              </div>
              <div className="card-detail-action-buttons flex w-full min-w-0 items-center justify-between gap-1.5 lg:ml-auto lg:w-auto lg:flex-1 lg:flex-wrap lg:justify-end lg:gap-2">
                <div className="card-detail-quantity flex h-7 shrink-0 items-center rounded-md border border-border bg-white/86 shadow-sm lg:h-9">
                  <span className="border-r border-border px-1.5 text-[10px] font-semibold text-text-subtle lg:px-2.5 lg:text-[11px]">
                    Deck
                  </span>
                  <button
                    onClick={() =>
                      onDeckQuantityChange(card, Math.max(0, deckQuantity - 1))
                    }
                    className="flex h-6 w-6 items-center justify-center text-sm font-semibold text-text-muted transition hover:bg-surface-subtle hover:text-text lg:h-8 lg:w-8 lg:text-base"
                    aria-label={`Remove one ${name} from deck`}
                    title="Remove one"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={deckQuantity}
                    onChange={(e) =>
                      onDeckQuantityChange(
                        card,
                        Math.min(255, Math.max(0, Number(e.target.value) || 0))
                      )
                    }
                    className="quantity-input h-6 w-9 border-x border-border bg-white/80 text-xs font-semibold text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 lg:h-8 lg:w-12 lg:text-sm"
                  />
                  <button
                    onClick={() =>
                      onDeckQuantityChange(
                        card,
                        Math.min(255, deckQuantity + 1)
                      )
                    }
                    className="flex h-6 w-6 items-center justify-center text-sm font-semibold text-text-muted transition hover:bg-surface-subtle hover:text-text lg:h-8 lg:w-8 lg:text-base"
                    aria-label={`Add one ${name} to deck`}
                    title="Add one"
                  >
                    +
                  </button>
                </div>
                <div className="card-detail-secondary-actions grid min-w-0 flex-1 grid-cols-2 gap-1.5 lg:flex lg:flex-none lg:items-center lg:gap-2">
                  {onCommanderChange && (
                    <button
                      onClick={() => onCommanderChange(card, !isCommander)}
                      disabled={deckQuantity === 0}
                      aria-pressed={isCommander}
                      title={
                        deckQuantity === 0
                          ? "Add this card to the deck before making it commander"
                          : isCommander
                            ? "Remove commander tag"
                            : "Make this card the commander"
                      }
                      className={`card-detail-secondary-action h-7 min-w-0 rounded-md border px-1.5 text-[9px] font-semibold leading-tight shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40 sm:text-[10px] lg:h-9 lg:px-3 lg:text-xs ${
                        isCommander
                          ? "border-accent bg-accent text-white"
                          : "border-border bg-white/86 text-text-muted hover:border-accent hover:text-text"
                      }`}
                    >
                      {isCommander ? "Commander" : "Set commander"}
                    </button>
                  )}
                  {onToggleSimilaritySeed && (
                    <button
                      onClick={() => onToggleSimilaritySeed(card)}
                      disabled={similaritySeedDisabled}
                      className={`card-detail-secondary-action h-7 min-w-0 rounded-md border px-1.5 text-[9px] font-semibold leading-tight shadow-sm transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-40 sm:text-[10px] lg:h-9 lg:px-3 lg:text-xs ${
                        isSimilaritySeed
                          ? "border-accent bg-accent-subtle text-accent"
                          : "border-border bg-white/86 text-text-muted hover:text-text"
                      }`}
                    >
                      {isSimilaritySeed ? "Similarity seed" : "Add to search"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
