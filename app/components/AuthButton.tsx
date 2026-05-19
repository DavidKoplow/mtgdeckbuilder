"use client";

import { useState } from "react";
import { useAuth } from "@workos-inc/authkit-react";
import { useConvexAuth } from "convex/react";
import {
  getAppHomePath,
  getCurrentReturnTo,
  startWorkosAuthRedirect,
} from "../lib/auth";

export function AuthButton() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { getSignInUrl, signOut, isLoading: workOsLoading } = useAuth();
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
    );
  }

  return (
    <button
      onClick={() => {
        setBusy(true);
        void startWorkosAuthRedirect(
          getSignInUrl,
          getCurrentReturnTo()
        ).catch(() => setBusy(false));
      }}
      disabled={busy}
      className="control-primary px-3 py-2 text-xs font-semibold disabled:opacity-60"
    >
      {busy ? "Opening..." : "Sign in"}
    </button>
  );
}
