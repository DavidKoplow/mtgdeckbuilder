"use client";

import { useState } from "react";
import type { ScryfallCard } from "../lib/types";
import { getCardImage } from "../lib/scryfall";
import { ManaCost } from "./ManaCost";

type Props = {
  card: ScryfallCard;
  onBack: () => void;
  onAdd: (card: ScryfallCard, qty: number) => void;
};

export function CardDetail({ card, onBack, onAdd }: Props) {
  const [qty, setQty] = useState(1);
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          Card Preview
        </div>
        <div className="flex items-center gap-3">
          <a
            href={card.scryfall_uri}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-text-subtle hover:text-accent hover:underline"
          >
            Scryfall ↗
          </a>
          <button
            onClick={onBack}
            className="rounded-md border border-border bg-white p-1 text-text-muted transition hover:border-accent hover:text-accent"
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

      <div className="thin-scroll flex-1 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          <div className="flex flex-col items-center gap-2">
            {img ? (
              <img
                src={img}
                alt={name}
                className="w-full max-w-[300px] rounded-[14px] shadow-lg ring-1 ring-black/10"
                draggable={false}
              />
            ) : (
              <div className="aspect-[488/680] w-full rounded-[14px] bg-surface-subtle" />
            )}
            {hasFaces && (
              <button
                onClick={() => setFace((f) => (f === 0 ? 1 : 0))}
                className="mt-1 w-full rounded-md border border-border bg-white py-1.5 text-xs text-text-muted hover:border-accent hover:text-accent"
              >
                Flip card ({face === 0 ? "front" : "back"} shown)
              </button>
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-semibold tracking-tight">{name}</h2>
                <ManaCost cost={mana} size={18} />
              </div>
              <div className="mt-1 text-sm text-text-muted">{typeLine}</div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                {card.set_name && (
                  <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-text-muted">
                    {card.set_name} ·{" "}
                    <span className="font-mono uppercase">{card.set}</span>
                  </span>
                )}
                {card.rarity && (
                  <span className="rounded-full bg-surface-subtle px-2 py-0.5 capitalize text-text-muted">
                    {card.rarity}
                  </span>
                )}
                {typeof card.cmc === "number" && (
                  <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-text-muted">
                    CMC {card.cmc}
                  </span>
                )}
                {card.prices?.usd && (
                  <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-text-muted">
                    ${card.prices.usd}
                  </span>
                )}
              </div>
            </div>

            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                Rules Text
              </h3>
              <div className="mt-1 whitespace-pre-wrap rounded-md border border-border bg-white p-3 text-sm leading-relaxed">
                {text || (
                  <span className="text-text-subtle">
                    (No rules text for this card.)
                  </span>
                )}
              </div>
            </section>

            {(power || toughness || loyalty) && (
              <div className="flex items-center gap-4 text-sm">
                {power && toughness && (
                  <span>
                    <span className="font-semibold">P/T:</span> {power}/
                    {toughness}
                  </span>
                )}
                {loyalty && (
                  <span>
                    <span className="font-semibold">Loyalty:</span> {loyalty}
                  </span>
                )}
              </div>
            )}

            <div className="mt-auto flex items-center gap-2 pt-2">
              <div className="flex items-center gap-0.5 rounded-md border border-border bg-white">
                <button
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="h-9 w-9 text-text-muted hover:text-text"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) =>
                    setQty(Math.max(1, Number(e.target.value) || 1))
                  }
                  className="h-9 w-12 border-x border-border bg-transparent text-center tabular-nums outline-none"
                />
                <button
                  onClick={() => setQty((q) => q + 1)}
                  className="h-9 w-9 text-text-muted hover:text-text"
                >
                  +
                </button>
              </div>
              <button
                onClick={() => onAdd(card, qty)}
                className="flex-1 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-hover"
              >
                Add {qty > 1 ? `${qty}× ` : ""}to deck
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
