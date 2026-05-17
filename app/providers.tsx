"use client";

import { type ReactNode, useCallback, useState } from "react";
import { AuthKitProvider, useAuth } from "@workos-inc/authkit-react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { handleAuthRedirect } from "./lib/auth";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const workosClientId = process.env.NEXT_PUBLIC_WORKOS_CLIENT_ID;
const workosRedirectUri = process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI;
const workosApiHostname = process.env.NEXT_PUBLIC_WORKOS_API_HOSTNAME;
const workosDevMode =
  process.env.NEXT_PUBLIC_WORKOS_DEV_MODE === "true" ? true : undefined;

export function Providers({ children }: { children: ReactNode }) {
  const [convex] = useState(
    () => (convexUrl ? new ConvexReactClient(convexUrl) : null),
  );
  const missingConfig = [
    !convexUrl ? "NEXT_PUBLIC_CONVEX_URL" : null,
    !workosClientId ? "NEXT_PUBLIC_WORKOS_CLIENT_ID" : null,
    !workosRedirectUri ? "NEXT_PUBLIC_WORKOS_REDIRECT_URI" : null,
  ].filter((value): value is string => value !== null);

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
      redirectUri={workosRedirectUri!}
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
