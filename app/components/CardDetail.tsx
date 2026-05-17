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
  onToggleSimilaritySeed?: (card: ScryfallCard) => void;
  isSimilaritySeed?: boolean;
  similaritySeedDisabled?: boolean;
};

export function CardDetail({
  card,
  onBack,
  deckQuantity,
  onDeckQuantityChange,
  onToggleSimilaritySeed,
  isSimilaritySeed = false,
  similaritySeedDisabled = false,
}: Props) {
  const [face, setFace] = useState(0);

  const hasFaces = (card.card_faces?.length ?? 0) >= 2;
  const activeFace = hasFaces ? card.card_faces![face] : undefined;

  const img = hasFaces
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

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                {power && toughness && (
                  <span className="flex h-10 items-center rounded-lg border border-border bg-white/78 px-3 text-xs text-text-muted shadow-sm">
                    <span className="font-semibold text-text">P/T:</span>
                    <span className="ml-1 tabular-nums">
                      {power}/{toughness}
                    </span>
                  </span>
                )}
                {loyalty && (
                  <span className="flex h-10 items-center rounded-lg border border-border bg-white/78 px-3 text-xs text-text-muted shadow-sm">
                    <span className="font-semibold text-text">Loyalty:</span>
                    <span className="ml-1 tabular-nums">{loyalty}</span>
                  </span>
                )}
              </div>
              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-text-muted">
                    In deck
                  </span>
                  <div className="flex h-10 items-center gap-1 rounded-full border border-border bg-white/86 px-1 shadow-sm">
                    <button
                      onClick={() =>
                        onDeckQuantityChange(
                          card,
                          Math.max(0, deckQuantity - 1)
                        )
                      }
                      className="deck-action-button"
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
                          Math.min(
                            255,
                            Math.max(0, Number(e.target.value) || 0)
                          )
                        )
                      }
                      className="quantity-input h-8 w-14 rounded-full border border-border bg-white/80 text-sm font-semibold text-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                    <button
                      onClick={() =>
                        onDeckQuantityChange(
                          card,
                          Math.min(255, deckQuantity + 1)
                        )
                      }
                      className="deck-action-button"
                      aria-label={`Add one ${name} to deck`}
                      title="Add one"
                    >
                      +
                    </button>
                  </div>
                </div>
                {onToggleSimilaritySeed && (
                  <button
                    onClick={() => onToggleSimilaritySeed(card)}
                    disabled={similaritySeedDisabled}
                    className={`h-10 rounded-lg border bg-[image:var(--rainbow-soft)] px-4 text-sm font-medium text-text shadow-sm transition hover:border-accent hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 ${
                      isSimilaritySeed ? "border-accent" : "border-border"
                    }`}
                  >
                    {isSimilaritySeed
                      ? "Remove from search"
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
