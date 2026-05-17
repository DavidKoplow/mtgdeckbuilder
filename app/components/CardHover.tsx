"use client";

import { createPortal } from "react-dom";

type Props = {
  src?: string;
  backSrc?: string;
  x: number;
  y: number;
  visible: boolean;
};

// Floating card image that follows the cursor, rendered via portal so it
// isn't clipped by scrolling parents.
export function CardHover({ src, backSrc, x, y, visible }: Props) {
  if (typeof document === "undefined" || !visible || !src) return null;

  const W = 260;
  const H = 362;
  const pad = 16;
  let left = x + 20;
  let top = y - H / 2;
  if (typeof window !== "undefined") {
    if (left + W + pad > window.innerWidth) left = x - W - 20;
    if (top < pad) top = pad;
    if (top + H + pad > window.innerHeight) top = window.innerHeight - H - pad;
  }

  return createPortal(
    <div
      className="pointer-events-none fixed z-50 flex gap-2"
      style={{ left, top }}
    >
      <img
        src={src}
        alt=""
        width={W}
        height={H}
        className="rounded-[12px] shadow-2xl ring-1 ring-black/10"
        draggable={false}
      />
      {backSrc ? (
        <img
          src={backSrc}
          alt=""
          width={W}
          height={H}
          className="rounded-[12px] shadow-2xl ring-1 ring-black/10"
          draggable={false}
        />
      ) : null}
    </div>,
    document.body
  );
}
