"use client";

import type { ReactNode } from "react";

const MAGE_TEXT_TOKEN = /(\{[^}]+\}|<\s*\/?\s*i\s*>|<br\s*\/?>|<\/?[^>]+>)/gi;
const MAGE_NON_MANA_BRACED_TOKENS = new Set([
  "this"
]);
const MANA_SYMBOL_TOKEN =
  /^(?:\d{1,2}|X|Y|Z|T|Q|E|P|H|S|C|CHAOS|∞|HW|\d+\/[WUBRGC]|[WUBRGC](?:\/[WUBRGCP]+|[WUBRGC]\/P)*|[WUBRGC]{2,5})$/i;

export function isManaSymbolToken(inner: string): boolean {
  const token = inner.trim();
  if (!token || MAGE_NON_MANA_BRACED_TOKENS.has(token.toLowerCase())) {
    return false;
  }
  return MANA_SYMBOL_TOKEN.test(token);
}

/** Replace MAGE card self-references like {this} with the card's name. */
export function replaceMageCardReferences(
  text: string,
  cardName?: string | null
): string {
  if (!text) return text;
  const replacement = cardName?.trim() || "this card";
  return text.replace(/\{this\}/gi, replacement);
}

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
  const pattern = new RegExp(MAGE_TEXT_TOKEN.source, "gi");
  let index = 0;
  let italic = false;

  const pushText = (value: string) => {
    if (!value) return;
    const decoded = decodeMageTextEntities(value);
    if (!decoded) return;
    const key = `t-${index++}`;
    nodes.push(
      italic ? (
        <em key={key} className="italic">
          {decoded}
        </em>
      ) : (
        <span key={key}>{decoded}</span>
      )
    );
  };

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      pushText(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (/^\{[^}]+\}$/.test(token) && isManaSymbolToken(token.slice(1, -1))) {
      const inner = token.slice(1, -1);
      nodes.push(<ManaPip key={`m-${index++}`} symbol={inner} size={size} />);
    } else if (/^\{[^}]+\}$/.test(token)) {
      pushText(token);
    } else if (/^<\s*i\s*>$/i.test(token)) {
      italic = true;
    } else if (/^<\s*\/\s*i\s*>$/i.test(token)) {
      italic = false;
    } else if (/^<br\s*\/?>$/i.test(token)) {
      nodes.push(<br key={`br-${index++}`} />);
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    pushText(text.slice(lastIndex));
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
  const lines = text.replace(/<br\s*\/?>/gi, "\n").split("\n");
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

function decodeMageTextEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}
