"use client";

import { useState } from "react";
import { useAuth } from "@workos-inc/authkit-react";
import { useConvexAuth } from "convex/react";
import { getAppHomePath, getCurrentReturnTo } from "../lib/auth";

export function AuthButton() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn, signOut, isLoading: workOsLoading } = useAuth();
  const [busy, setBusy] = useState(false);

  if (isLoading || workOsLoading) {
    return (
      <span className="rounded-lg border border-border bg-white px-3 py-2 text-xs text-text-subtle">
        Syncing…
      </span>
    );
  }

  if (isAuthenticated) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden max-w-40 truncate text-xs text-text-subtle sm:inline">
          Signed in
        </span>
        <button
          onClick={() => {
            setBusy(true);
            signOut({ returnTo: getAppHomePath() });
          }}
          disabled={busy}
          className="control px-3 py-2 text-xs"
        >
          {busy ? "Signing out..." : "Sign out"}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        setBusy(true);
        void signIn({ state: { returnTo: getCurrentReturnTo() } }).catch(() =>
          setBusy(false)
        );
      }}
      disabled={busy}
      className="control-primary px-3 py-2 text-xs font-semibold disabled:opacity-60"
    >
      {busy ? "Opening..." : "Sign in"}
    </button>
  );
}
