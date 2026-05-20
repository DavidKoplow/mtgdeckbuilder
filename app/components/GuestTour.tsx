"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";

type TourStepId =
  | "decks"
  | "search"
  | "semantic"
  | "result"
  | "preview"
  | "deck"
  | "playtest"
  | "account";

type GuestTourProps = {
  active: boolean;
  replayKey?: number;
  onStepChange?: (stepId: TourStepId) => void;
};

type TourStep = {
  id: TourStepId;
  target: string;
  title: string;
  body: string;
};

type TourRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const HIGHLIGHT_PADDING = 8;

const TOUR_STEPS: TourStep[] = [
  {
    id: "decks",
    target: "tour-decks",
    title: "Start with one local deck",
    body: "While signed out you can make a single deck. Once signed in, use this button to create new decks and see saved decks.",
  },
  {
    id: "search",
    target: "tour-search-name",
    title: "Search for Sol Ring",
    body: "You can search cards by name. We will search for Sol Ring as an example.",
  },
  {
    id: "semantic",
    target: "tour-search-semantic",
    title: "Search by meaning",
    body: "You can search by many fields beyond card name, including through AI-powered semantic search which finds cards with similar meaning to the rules text you provide, though semantic search requires making an account.",
  },
  {
    id: "result",
    target: "tour-search-result",
    title: "Use search results",
    body: "Click any result to inspect it, or use the + button to add that card directly to your Deck.",
  },
  {
    id: "preview",
    target: "tour-preview",
    title: "Inspect before adding",
    body: "The selected card panel shows the card you chose. Use the Deck quantity +/- controls to add or remove copies, and use Add to search to seed similarity search with this card, which finds cards with similar abbilities to the cards selected. Similarity search also requires making an account.",
  },
  {
    id: "deck",
    target: "tour-deck",
    title: "Tune the deck list",
    body: "Cards you add appear here. Adjust counts, move cards between boards, change views, and scan curve, colors, and price.",
  },
  {
    id: "playtest",
    target: "tour-playtest",
    title: "Playtest with an account",
    body: "After you make an account, use Playtest to draw hands, step through turns and see how the deck feels to play.",
  },
  {
    id: "account",
    target: "tour-account",
    title: "Account features",
    body: "Sign-in to keep decks synced with the cloud, make multiple decks, use the mobile workspace, and unlock semantic search, similarity search, and playtesting.",
  },
];

function getVisibleTourTarget(tourId: string): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(
    `[data-tour="${tourId}"]`
  );

  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect();
    const style = window.getComputedStyle(candidate);
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    ) {
      return candidate;
    }
  }

  return null;
}

function rectForElement(element: HTMLElement): TourRect {
  const rect = element.getBoundingClientRect();
  const top = Math.max(8, rect.top - HIGHLIGHT_PADDING);
  const left = Math.max(8, rect.left - HIGHLIGHT_PADDING);
  const right = Math.min(window.innerWidth - 8, rect.right + HIGHLIGHT_PADDING);
  const bottom = Math.min(
    window.innerHeight - 8,
    rect.bottom + HIGHLIGHT_PADDING
  );

  return {
    top,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function getNoteStyle(rect: TourRect | null): CSSProperties {
  const margin = 16;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(368, viewportWidth - margin * 2);

  if (!rect) {
    return {
      width,
      left: Math.max(margin, (viewportWidth - width) / 2),
      top: Math.max(margin, viewportHeight * 0.24),
    };
  }

  const estimatedHeight = 232;
  const belowTop = rect.top + rect.height + 16;
  const aboveTop = rect.top - estimatedHeight - 16;
  const top =
    belowTop + estimatedHeight <= viewportHeight - margin || aboveTop < margin
      ? Math.min(belowTop, viewportHeight - estimatedHeight - margin)
      : Math.max(margin, aboveTop);
  const left = Math.min(
    Math.max(margin, rect.left + rect.width / 2 - width / 2),
    viewportWidth - width - margin
  );

  return {
    width,
    left,
    top: Math.max(margin, top),
  };
}

export function GuestTour({
  active,
  replayKey = 0,
  onStepChange,
}: GuestTourProps) {
  const [dismissed, setDismissed] = useState(true);
  const [replaying, setReplaying] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<TourRect | null>(null);
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const previousReplayKeyRef = useRef(replayKey);
  const step = TOUR_STEPS[stepIndex];

  const visible = mounted && ((active && !dismissed) || replaying);
  const lastStep = stepIndex === TOUR_STEPS.length - 1;

  const measure = useCallback(() => {
    const target = getVisibleTourTarget(step.target);
    setRect(target ? rectForElement(target) : null);
  }, [step.target]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    setReplaying(false);
  }, []);

  const next = useCallback(() => {
    if (lastStep) {
      dismiss();
      return;
    }
    setStepIndex((index) => Math.min(index + 1, TOUR_STEPS.length - 1));
  }, [dismiss, lastStep]);

  const back = useCallback(() => {
    setStepIndex((index) => Math.max(0, index - 1));
  }, []);

  useEffect(() => {
    let cancelled = false;

    window.queueMicrotask(() => {
      if (cancelled) return;
      setMounted(true);
      setDismissed(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => {
      setStepIndex(0);
      setDismissed(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    if (replayKey === previousReplayKeyRef.current) return;
    previousReplayKeyRef.current = replayKey;
    if (replayKey <= 0) return;

    const frame = window.requestAnimationFrame(() => {
      setStepIndex(0);
      setDismissed(false);
      setReplaying(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [replayKey]);

  useEffect(() => {
    if (!visible) return;
    onStepChange?.(step.id);

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      const target = getVisibleTourTarget(step.target);
      target?.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
      secondFrame = window.requestAnimationFrame(measure);
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [measure, onStepChange, step.id, step.target, visible]);

  useEffect(() => {
    if (!visible) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss();
      else if (event.key === "ArrowRight") next();
      else if (event.key === "ArrowLeft") back();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [back, dismiss, next, visible]);

  useEffect(() => {
    if (!visible) return;

    const target = getVisibleTourTarget(step.target);
    const observer =
      target && "ResizeObserver" in window
        ? new ResizeObserver(measure)
        : null;
    if (target && observer) observer.observe(target);

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const interval = window.setInterval(measure, 300);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.clearInterval(interval);
    };
  }, [measure, step.target, visible]);

  useEffect(() => {
    if (!visible) return;
    panelRef.current?.focus();
  }, [stepIndex, visible]);

  const noteStyle = useMemo(
    () => (visible ? getNoteStyle(rect) : undefined),
    [rect, visible]
  );

  if (!visible) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1300]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guest-tour-title"
      aria-describedby="guest-tour-body"
    >
      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-xl border-2 border-white shadow-[0_0_0_9999px_rgba(23,32,51,0.58),0_18px_44px_rgba(23,32,51,0.28)] ring-2 ring-accent/70"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        />
      ) : (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 bg-[rgba(23,32,51,0.58)]"
        />
      )}

      <section
        ref={panelRef}
        tabIndex={-1}
        className="dialog-panel fixed max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl p-4 text-sm text-text outline-none sm:p-5"
        style={noteStyle}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="rounded-full bg-accent-subtle px-2.5 py-1 text-[11px] font-semibold text-accent">
            {stepIndex + 1} of {TOUR_STEPS.length}
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="control px-2.5 py-1.5 text-xs font-semibold"
          >
            Skip
          </button>
        </div>

        <h2 id="guest-tour-title" className="text-base font-semibold text-text">
          {step.title}
        </h2>
        <p id="guest-tour-body" className="mt-2 leading-6 text-text-muted">
          {step.body}
        </p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={back}
            disabled={stepIndex === 0}
            className="control px-3 py-2 text-xs font-semibold"
          >
            Back
          </button>
          <button
            type="button"
            onClick={next}
            className="control-primary px-3 py-2 text-xs font-semibold"
          >
            {lastStep ? "Done" : "Next"}
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}
