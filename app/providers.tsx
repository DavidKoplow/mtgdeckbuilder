"use client";

import { type ReactNode, useCallback, useState } from "react";
import { AuthKitProvider, useAuth } from "@workos-inc/authkit-react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import {
  getWorkosDevMode,
  getWorkosRedirectUri,
  handleAuthRedirect,
  restoreWorkosCodeVerifierBackup,
} from "./lib/auth";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const workosClientId = process.env.NEXT_PUBLIC_WORKOS_CLIENT_ID;
const workosRedirectUri = process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI;
const workosApiHostname = process.env.NEXT_PUBLIC_WORKOS_API_HOSTNAME;
const workosDevMode = getWorkosDevMode(
  process.env.NEXT_PUBLIC_WORKOS_DEV_MODE,
  workosApiHostname
);

export function Providers({ children }: { children: ReactNode }) {
  const [authStorageReady] = useState(() => {
    restoreWorkosCodeVerifierBackup();
    return true;
  });

  const [convex] = useState(
    () => (convexUrl ? new ConvexReactClient(convexUrl) : null),
  );
  const resolvedWorkosRedirectUri = getWorkosRedirectUri(workosRedirectUri);
  const missingConfig = [
    !convexUrl ? "NEXT_PUBLIC_CONVEX_URL" : null,
    !workosClientId ? "NEXT_PUBLIC_WORKOS_CLIENT_ID" : null,
  ].filter((value): value is string => value !== null);

  if (!authStorageReady) {
    return (
      <div className="app-shell-bg flex min-h-0 flex-1 items-center justify-center p-8 text-sm text-text-subtle">
        <div className="empty-pill flex items-center gap-3 rounded-full px-4 py-2">
          <span className="accent-dot h-2.5 w-2.5 animate-pulse rounded-full" />
          Loading deck workspace
        </div>
      </div>
    );
  }

  if (!convex || missingConfig.length > 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-8 text-sm text-text-muted">
        {missingConfig.join(", ")}{" "}
        {missingConfig.length === 1 ? "is" : "are"} required for cloud deck
        storage.
      </div>
    );
  }

  return (
    <AuthKitProvider
      clientId={workosClientId!}
      redirectUri={resolvedWorkosRedirectUri}
      apiHostname={workosApiHostname || undefined}
      devMode={workosDevMode}
      onRedirectCallback={handleAuthRedirect}
    >
      <ConvexProviderWithAuth client={convex} useAuth={useAuthFromAuthKit}>
        {children}
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}

function useAuthFromAuthKit() {
  const { user, isLoading, getAccessToken } = useAuth();
  const isAuthenticated = user !== null;

  const fetchAccessToken = useCallback(
    async ({
      forceRefreshToken,
    }: {
      forceRefreshToken: boolean;
    }): Promise<string | null> => {
      if (!user) return null;

      try {
        return await getAccessToken({ forceRefresh: forceRefreshToken });
      } catch {
        return null;
      }
    },
    [getAccessToken, user]
  );

  return {
    isLoading,
    isAuthenticated,
    fetchAccessToken,
  };
}
