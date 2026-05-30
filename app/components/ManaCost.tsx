"use client";

import type { ReactNode } from "react";

const MANA_SYMBOL_IN_TEXT = /\{[^}]+\}/g;

export function manaSymbolUrl(inner: string): string {
  // Scryfall hosts SVGs at e.g. /card-symbols/W.svg, /WU.svg, /2W.svg, /T.svg
  const cleaned = inner.replace(/[\/\-]/g, "").toUpperCase();
  return `https://svgs.scryfall.io/card-symbols/${cleaned}.svg`;
}

type Props = {
  cost?: string;
  size?: number;
};

export function ManaCost({ cost, size = 14 }: Props) {
  if (!cost) return null;
  const symbols = cost.match(/\{[^}]+\}/g) ?? [];
  if (symbols.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-[2px] align-middle">
      {symbols.map((s, i) => {
        const inner = s.slice(1, -1);
        return (
          <img
            key={i}
            src={manaSymbolUrl(inner)}
            alt={s}
            width={size}
            height={size}
            className="inline-block shrink-0 rounded-full"
            style={{ width: size, height: size }}
            draggable={false}
          />
        );
      })}
    </span>
  );
}

export function ManaPip({
  symbol,
  size = 18,
}: {
  symbol: string;
  size?: number;
}) {
  return (
    <img
      src={manaSymbolUrl(symbol)}
      alt={`{${symbol}}`}
      width={size}
      height={size}
      className="inline-block shrink-0 rounded-full align-middle"
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}

/** Inline text with {T}, {R}, {2}, etc. rendered as Scryfall symbol images. */
export function ManaText({
  text,
  size = 14,
  className,
}: {
  text?: string | null;
  size?: number;
  className?: string;
}) {
  if (!text) return null;

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const pattern = new RegExp(MANA_SYMBOL_IN_TEXT.source, "g");
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<span key={`t-${index++}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    const inner = match[0].slice(1, -1);
    nodes.push(<ManaPip key={`m-${index++}`} symbol={inner} size={size} />);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(<span key={`t-${index++}`}>{text.slice(lastIndex)}</span>);
  }

  if (nodes.length === 0) return null;

  return (
    <span className={`inline align-middle ${className ?? ""}`.trim()}>{nodes}</span>
  );
}

/** Paragraphs of text with mana symbols; preserves line breaks from MAGE messages. */
export function ManaTextBlock({
  text,
  size = 14,
  className,
}: {
  text?: string | null;
  size?: number;
  className?: string;
}) {
  if (!text) return null;
  const lines = text.split("\n");
  if (lines.length === 1) {
    return <ManaText text={text} size={size} className={className} />;
  }
  return (
    <span className={className}>
      {lines.map((line, lineIndex) => (
        <span key={lineIndex} className={lineIndex > 0 ? "mt-1 block" : "block"}>
          <ManaText text={line} size={size} />
        </span>
      ))}
    </span>
  );
}
