"use client";

import { useEffect, type ReactNode } from "react";

type MobileCardSheetProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
};

/** Full-width bottom sheet for card preview on viewports below lg. */
export function MobileCardSheet({
  open,
  onClose,
  children,
}: MobileCardSheetProps) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="mobile-card-sheet-root fixed inset-0 z-[80] flex flex-col justify-end lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Card preview"
    >
      <button
        type="button"
        className="mobile-card-sheet-backdrop absolute inset-0 bg-[#172033]/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="Close card preview"
      />
      <div className="mobile-card-sheet mobile-card-sheet-panel relative flex max-h-[min(88dvh,40rem)] min-h-0 flex-col overflow-hidden rounded-t-2xl border border-b-0 border-border bg-surface shadow-[0_-12px_40px_rgba(23,32,51,0.22)]">
        <div
          className="flex shrink-0 justify-center pt-2 pb-1"
          aria-hidden
        >
          <div className="h-1 w-10 rounded-full bg-border-strong/80" />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
