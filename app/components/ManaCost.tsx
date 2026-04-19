"use client";

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
      alt={symbol}
      width={size}
      height={size}
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}
