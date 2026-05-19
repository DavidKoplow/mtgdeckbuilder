"use client";

import { useState } from "react";
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
    <div className="flex flex-col">
      <div className="panel-heading flex items-center justify-between border-b border-border px-3 py-2.5 sm:px-4">
        <div className="text-sm font-semibold text-text">
          Card Preview
        </div>
        <div className="flex items-center gap-2">
          <a
            href={card.scryfall_uri}
            target="_blank"
            rel="noreferrer"
            className="control px-2.5 py-1.5 text-xs"
          >
            Scryfall
          </a>
          <button
            onClick={onBack}
            className="control p-2"
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

      <div className="thin-scroll bg-surface">
        <div className="grid items-stretch grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <div className="flex flex-col items-center gap-2">
            {img ? (
              <img
                src={img}
                alt={name}
                className="w-full max-w-[15rem] rounded-xl shadow-lg ring-1 ring-black/10 sm:max-w-[16rem] xl:max-w-[18rem]"
                draggable={false}
              />
            ) : (
              <div className="aspect-[488/680] w-full rounded-[14px] bg-surface-subtle" />
            )}
          </div>

          <div className="flex min-h-0 min-w-0 flex-col gap-2.5">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold leading-tight">{name}</h2>
                <ManaCost cost={mana} size={18} />
              </div>
              <div className="mt-0.5 text-xs text-text-muted">{typeLine}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                {card.set_name && (
                  <span className="rounded-full border border-border bg-white/80 px-2 py-0.5 text-text-muted shadow-sm">
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
                  <span className="rounded-full border border-border bg-white/80 px-2 py-0.5 text-text-muted shadow-sm">
                    MV {card.cmc}
                  </span>
                )}
                {card.prices?.usd && (
                  <span className="rounded-full border border-border bg-white/80 px-2 py-0.5 text-text-muted shadow-sm">
                    ${card.prices.usd}
                  </span>
                )}
              </div>
            </div>

            <section className="flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-7 items-center justify-between gap-2">
                <h3 className="text-[11px] font-semibold uppercase text-text-subtle">
                  Rules Text
                </h3>
                {hasFaces && (
                  <button
                    onClick={() => setFace((f) => (f === 0 ? 1 : 0))}
                    className="control px-2 py-1 text-[11px] font-medium"
                  >
                    Flip
                  </button>
                )}
              </div>
              <div className="thin-scroll mt-1 min-h-24 flex-1 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-white/78 p-2.5 text-[12px] leading-snug shadow-sm">
                {text || (
                  <span className="text-text-subtle">
                    (No rules text for this card.)
                  </span>
                )}
              </div>
            </section>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {power && toughness && (
                  <span className="flex h-9 items-center rounded-md border border-border bg-white/78 px-2.5 text-xs text-text-muted shadow-sm">
                    <span className="font-semibold text-text">P/T:</span>
                    <span className="ml-1 tabular-nums">
                      {power}/{toughness}
                    </span>
                  </span>
                )}
                {loyalty && (
                  <span className="flex h-9 items-center rounded-md border border-border bg-white/78 px-2.5 text-xs text-text-muted shadow-sm">
                    <span className="font-semibold text-text">Loyalty:</span>
                    <span className="ml-1 tabular-nums">{loyalty}</span>
                  </span>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                <div className="flex h-9 items-center rounded-md border border-border bg-white/86 shadow-sm">
                  <span className="border-r border-border px-2.5 text-[11px] font-semibold uppercase text-text-subtle">
                    Deck
                  </span>
                  <button
                    onClick={() =>
                      onDeckQuantityChange(card, Math.max(0, deckQuantity - 1))
                    }
                    className="flex h-8 w-8 items-center justify-center text-base font-semibold text-text-muted transition hover:bg-surface-subtle hover:text-text"
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
                    className="quantity-input h-8 w-12 border-x border-border bg-white/80 text-sm font-semibold text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                  <button
                    onClick={() =>
                      onDeckQuantityChange(
                        card,
                        Math.min(255, deckQuantity + 1)
                      )
                    }
                    className="flex h-8 w-8 items-center justify-center text-base font-semibold text-text-muted transition hover:bg-surface-subtle hover:text-text"
                    aria-label={`Add one ${name} to deck`}
                    title="Add one"
                  >
                    +
                  </button>
                </div>
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
                    className={`h-9 rounded-md border px-3 text-xs font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
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
                    className={`h-9 rounded-md border px-3 text-xs font-semibold shadow-sm transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-40 ${
                      isSimilaritySeed
                        ? "border-accent bg-accent-subtle text-accent"
                        : "border-border bg-white/86 text-text-muted hover:text-text"
                    }`}
                  >
                    {isSimilaritySeed
                      ? "Search seed"
                      : "Add to search"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
