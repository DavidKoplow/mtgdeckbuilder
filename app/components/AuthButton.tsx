"use client";

import { useState } from "react";
import { useAuth } from "@workos-inc/authkit-react";
import { useConvexAuth } from "convex/react";
import {
  getAppHomePath,
  getCurrentReturnTo,
  startWorkosAuthRedirect,
} from "../lib/auth";

type AuthButtonProps = {
  onBeforeSignIn?: () => void;
  onSignInError?: () => void;
  signedOutLabel?: string;
  tourId?: string;
};

export function AuthButton({
  onBeforeSignIn,
  onSignInError,
  signedOutLabel = "Sign in",
  tourId,
}: AuthButtonProps = {}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { getSignInUrl, signOut, isLoading: workOsLoading } = useAuth();
  const [busy, setBusy] = useState(false);

  if (isLoading || workOsLoading) {
    return (
      <span
        data-tour={tourId}
        className="rounded-lg border border-border bg-white px-3 py-2 text-xs text-text-subtle"
      >
        Syncing…
      </span>
    );
  }

  if (isAuthenticated) {
    return (
      <button
        data-tour={tourId}
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
      data-tour={tourId}
      onClick={() => {
        setBusy(true);
        onBeforeSignIn?.();
        void startWorkosAuthRedirect(
          getSignInUrl,
          getCurrentReturnTo()
        ).catch(() => {
          onSignInError?.();
          setBusy(false);
        });
      }}
      disabled={busy}
      className="control-primary px-3 py-2 text-xs font-semibold disabled:opacity-60"
    >
      {busy ? "Opening..." : signedOutLabel}
    </button>
  );
}
