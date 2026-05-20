"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { AppIcon } from "../AppIcon";

type MobileAppHeaderProps = {
  menuOpen: boolean;
  onToggleMenu: () => void;
  onOpenDeckSelector: () => void;
  menuContent: ReactNode;
  actions: ReactNode;
  centerContent?: ReactNode;
};

export function MobileAppHeader({
  menuOpen,
  onToggleMenu,
  onOpenDeckSelector,
  menuContent,
  actions,
  centerContent,
}: MobileAppHeaderProps) {
  useEffect(() => {
    if (!menuOpen) return;

    const prevOverflow = document.body.style.overflow;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onToggleMenu();
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onEscape);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onEscape);
    };
  }, [menuOpen, onToggleMenu]);

  const overlayContent = menuOpen
    ? createPortal(
        <div
          className="mobile-header-overlay lg:hidden"
          onClick={onToggleMenu}
          role="presentation"
        >
          <div
            id="mobile-header-menu"
            className="mobile-header-overlay-panel rainbow-edge lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile menu"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mobile-header-overlay-head flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="mobile-menu-title">Menu</div>
              </div>
              <button
                type="button"
                onClick={onToggleMenu}
                aria-label="Close menu"
                title="Close menu"
                className="mobile-header-toggle mobile-menu-close flex shrink-0 items-center justify-center rounded-full border border-border/80 bg-surface-subtle text-text-muted transition"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <div className="mobile-header-menu-body thin-scroll min-w-0 flex-1 overflow-y-auto">
              <div className="mobile-menu-section">
                <div className="mobile-menu-section-label">Active deck</div>
                <div className="mobile-header-menu min-w-0">
                  {menuContent}
                </div>
              </div>
              <div className="mobile-menu-section">
                <div className="mobile-menu-section-label">Actions</div>
                <div className="mobile-header-actions grid">
                  {actions}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className="mobile-header-shell flex min-w-0 w-full flex-col gap-1 lg:hidden">
      <div className="mobile-header-bar flex min-w-0 w-full items-center justify-between gap-2 lg:hidden">
        <button
          type="button"
          onClick={onOpenDeckSelector}
          data-tour="tour-decks"
          aria-label="Open deck list"
          title="Your decks"
          className="mobile-header-deck-trigger flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 text-text transition"
        >
          <AppIcon size={40} className="drop-shadow-sm" />
        </button>
        {centerContent ? (
          <div className="mobile-header-center-wrap flex min-w-0 flex-1 justify-center px-1">
            {centerContent}
          </div>
        ) : null}
        <button
          type="button"
          onClick={onToggleMenu}
          data-tour="tour-account"
          aria-expanded={menuOpen}
          aria-controls="mobile-header-menu"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          title={menuOpen ? "Close menu" : "Open menu"}
          className="mobile-header-toggle flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/80 bg-surface-subtle text-text-muted transition"
        >
          {menuOpen ? (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          ) : (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="4" x2="20" y1="12" y2="12" />
              <line x1="4" x2="20" y1="6" y2="6" />
              <line x1="4" x2="20" y1="18" y2="18" />
            </svg>
          )}
        </button>
      </div>
      {overlayContent}
    </div>
  );
}
