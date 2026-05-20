"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { formatBytes, type OfflineModeState } from "../lib/offline";

type Props = {
  offline: OfflineModeState;
  defaultDeckPublic: boolean;
  onDefaultDeckPublicChange: (isPublic: boolean) => void;
  onReplayTour?: () => void;
};

export function SettingsButton({
  offline,
  defaultDeckPublic,
  onDefaultDeckPublicChange,
  onReplayTour,
}: Props) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const downloading = offline.installing;
  const catalogProgress =
    offline.status.catalogBytesTotal && offline.status.catalogBytesTotal > 0
      ? Math.min(
          1,
          offline.status.catalogBytesDone / offline.status.catalogBytesTotal
        )
      : offline.status.cardCount > 0
        ? 0.5
        : 0;
  const progress =
    offline.status.phase === "ready"
      ? 1
      : offline.status.phase === "art" && offline.status.imageCount > 0
        ? 0.3 + (offline.status.imageDone / offline.status.imageCount) * 0.7
        : offline.status.phase === "sets"
          ? 0.3
          : offline.status.phase === "cards"
            ? catalogProgress * 0.3
            : 0;
  const catalogBytesLabel =
    offline.installing &&
    offline.status.phase === "cards" &&
    offline.status.catalogBytesDone === 0
      ? "Connecting..."
      : typeof offline.status.catalogBytesTotal === "number"
      ? `${formatBytes(offline.status.catalogBytesDone)} / ${formatBytes(
          offline.status.catalogBytesTotal
        )}`
      : formatBytes(offline.status.catalogBytesDone);
  const storageLabel =
    typeof offline.status.storageBytes === "number"
      ? typeof offline.status.storageQuotaBytes === "number"
        ? `${formatBytes(offline.status.storageBytes)} / ${formatBytes(
            offline.status.storageQuotaBytes
          )}`
        : formatBytes(offline.status.storageBytes)
      : "0 B";
  const imageBytesLabel =
    typeof offline.status.imageBytesTotalEstimate === "number"
      ? `${formatBytes(offline.status.imageBytesDone)} / ~${formatBytes(
          offline.status.imageBytesTotalEstimate
        )}`
      : formatBytes(offline.status.imageBytesDone);
  const etaLabel =
    typeof offline.status.etaSeconds === "number"
      ? formatDuration(offline.status.etaSeconds)
      : offline.installing
        ? "Calculating..."
        : "—";
  const speedLabel =
    typeof offline.status.bytesPerSecond === "number"
      ? `${formatBytes(offline.status.bytesPerSecond)}/s`
      : typeof offline.status.itemsPerSecond === "number"
        ? `${offline.status.itemsPerSecond.toFixed(1)} images/s`
        : offline.installing
          ? "Calculating..."
          : "—";

  async function enableOffline() {
    setConfirming(false);
    await offline.startDownload();
  }

  const dialog =
    open && typeof document !== "undefined"
      ? createPortal(
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[86vh] w-full max-w-lg flex-col overflow-hidden rounded-lg bg-white shadow-2xl ring-1 ring-black/10"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Settings"
          >
            <div className="flex items-center justify-between border-b border-border bg-surface-raised px-4 py-3">
              <h2 className="text-sm font-semibold">Settings</h2>
              <button
                onClick={() => setOpen(false)}
                className="control p-2"
                aria-label="Close settings"
              >
                x
              </button>
            </div>

            <div className="thin-scroll min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Help</h3>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onReplayTour?.();
                  }}
                  className="control-primary px-3 py-2 text-xs font-semibold"
                >
                  How to use deck builder?
                </button>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">New decks</h3>
                  <span className="rounded-full border border-border bg-surface-subtle px-2.5 py-1 text-[11px] font-medium text-text-muted">
                    {defaultDeckPublic ? "Public" : "Private"}
                  </span>
                </div>
                <div className="segmented-control grid grid-cols-2 gap-1 rounded-lg p-1">
                  <button
                    type="button"
                    onClick={() => onDefaultDeckPublicChange(true)}
                    aria-pressed={defaultDeckPublic}
                    className={`rounded-md px-3 py-2 text-xs font-semibold transition ${
                      defaultDeckPublic
                        ? "selected-segment text-text"
                        : "text-text-subtle hover:bg-white/70 hover:text-text"
                    }`}
                  >
                    Public
                  </button>
                  <button
                    type="button"
                    onClick={() => onDefaultDeckPublicChange(false)}
                    aria-pressed={!defaultDeckPublic}
                    className={`rounded-md px-3 py-2 text-xs font-semibold transition ${
                      !defaultDeckPublic
                        ? "selected-segment text-text"
                        : "text-text-subtle hover:bg-white/70 hover:text-text"
                    }`}
                  >
                    Private
                  </button>
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">Offline mode</h3>
                    <p className="mt-1 text-xs leading-5 text-text-muted">
                      Downloads the Scryfall default card catalog, small card
                      art, and set data for use when the browser is offline.
                      Semantic search is disabled while offline.
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                      offline.offlineActive
                        ? "bg-amber-100 text-amber-900"
                        : offline.settings.enabled
                          ? "bg-emerald-100 text-emerald-900"
                          : "bg-surface-subtle text-text-muted"
                    }`}
                  >
                    {offline.offlineActive
                      ? "Offline"
                      : offline.settings.enabled
                        ? "Enabled"
                        : "Off"}
                  </span>
                </div>

                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">
                  Offline support can require about{" "}
                  <strong>{offline.estimateLabel}</strong> of browser storage.
                  This stores the Scryfall default card bulk file plus small
                  card images for the catalog. Normal images are cached only for
                  cards in your decks when the browser is online.
                </div>

                <div className="rounded-lg border border-border bg-surface-raised p-3">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-medium text-text">Cache status</span>
                    <span className="capitalize text-text-muted">
                      {offline.installing
                        ? offline.status.phase
                        : offline.status.phase === "error"
                          ? "Needs retry"
                          : offline.status.phase}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white ring-1 ring-border">
                    <div
                      className="h-full bg-[image:var(--rainbow)] transition-[width]"
                      style={{ width: `${Math.round(progress * 100)}%` }}
                    />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-text-muted">
                    <div>{offline.status.cardCount.toLocaleString()} cards</div>
                    <div>Catalog: {catalogBytesLabel}</div>
                    <div>
                      {offline.status.imageDone.toLocaleString()} /{" "}
                      {offline.status.imageCount.toLocaleString()} small images
                    </div>
                    <div>Image data: {imageBytesLabel}</div>
                    <div>ETA: {etaLabel}</div>
                    <div>Speed: {speedLabel}</div>
                    <div>Installed: {storageLabel}</div>
                    <div>
                      Pending sync: {offline.pendingDeckChanges.toLocaleString()}
                    </div>
                  </div>
                  {offline.status.error && (
                    <div className="mt-2 text-[11px] text-[color:var(--danger)]">
                      {offline.status.error}
                    </div>
                  )}
                </div>

                {confirming ? (
                  <div className="rounded-lg border border-border bg-white p-3">
                    <p className="text-xs leading-5 text-text-muted">
                      Start the full offline download now? This may run for a
                      long time and use about {offline.estimateLabel} of local
                      browser storage.
                    </p>
                    <div className="mt-3 flex justify-end gap-2">
                      <button
                        onClick={() => setConfirming(false)}
                        className="control px-3 py-1.5 text-xs"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => void enableOffline()}
                        className="control-primary px-3 py-1.5 text-xs font-semibold"
                      >
                        Start download
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      onClick={() => setConfirming(true)}
                      disabled={downloading}
                      className="control-primary px-3 py-2 text-xs font-semibold disabled:opacity-50"
                    >
                      {offline.installing
                        ? "Downloading..."
                        : offline.settings.enabled
                          ? "Refresh offline cache"
                          : "Enable offline mode"}
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={offline.disable}
                        disabled={!offline.settings.enabled}
                        className="control px-3 py-2 text-xs disabled:opacity-50"
                      >
                        Disable
                      </button>
                      <button
                        onClick={() => void offline.clearCache()}
                        className="control px-3 py-2 text-xs text-[color:var(--danger)]"
                      >
                        Clear cache
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>,
        document.body
      )
      : null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="control px-3 py-2 text-xs"
        aria-label="Open settings"
        title="Settings"
      >
        Settings
      </button>
      {dialog}
    </>
  );
}

function formatDuration(seconds: number) {
  if (seconds <= 0) return "Done";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.ceil(seconds % 60);
  if (minutes < 60) {
    return remainingSeconds === 60
      ? `${minutes + 1}m`
      : `${minutes}m ${remainingSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
