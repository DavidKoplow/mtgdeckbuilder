"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@workos-inc/authkit-react";
import {
  clearWorkosCodeVerifierBackup,
  getAppBuilderPath,
  getAppHomePath,
  getAppLoginPath,
  getReturnToFromLocation,
  startWorkosAuthRedirect,
} from "../lib/auth";
import { AppIcon } from "./AppIcon";

type AuthRedirectProps = {
  mode: "callback" | "sign-in" | "sign-up";
};

export function AuthRedirect({ mode }: AuthRedirectProps) {
  const { getSignInUrl, getSignUpUrl, isLoading, user } = useAuth();
  const [failed, setFailed] = useState(false);
  const [hasCallbackCode] = useState(() => {
    if (mode !== "callback" || typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).has("code");
  });

  useEffect(() => {
    if (mode === "callback" || isLoading || user) return;

    const getAuthUrl = mode === "sign-up" ? getSignUpUrl : getSignInUrl;
    startWorkosAuthRedirect(getAuthUrl, getReturnToFromLocation()).catch(
      () => {
        setFailed(true);
      }
    );
  }, [getSignInUrl, getSignUpUrl, isLoading, mode, user]);

  useEffect(() => {
    if (mode !== "callback" || isLoading || !user) return;
    window.location.replace(getAppHomePath());
  }, [isLoading, mode, user]);

  useEffect(() => {
    if (mode !== "callback" || isLoading || user) return;

    const timeoutId = window.setTimeout(
      () => {
        clearWorkosCodeVerifierBackup();
        setFailed(true);
      },
      hasCallbackCode ? 1500 : 0
    );
    return () => window.clearTimeout(timeoutId);
  }, [hasCallbackCode, isLoading, mode, user]);

  return (
    <div className="app-shell-bg flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="workspace-panel rainbow-edge animate-panel flex w-full max-w-sm flex-col items-center gap-4 overflow-hidden rounded-lg px-8 py-10 text-center">
        <AppIcon size={48} className="shadow-sm" />
        <div>
          <h1 className="text-lg font-semibold text-text">
            {failed ? "Authentication failed" : "Redirecting"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            {failed
              ? "This session could not be completed. Start a fresh sign-in from this site."
              : "Finishing your WorkOS session."}
          </p>
        </div>
        {failed ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              className="control-primary px-3 py-2 text-xs font-semibold"
              onClick={() => window.location.assign(getAppLoginPath())}
            >
              Try again
            </button>
            <button
              type="button"
              className="control px-3 py-2 text-xs"
              onClick={() => window.location.assign(getAppBuilderPath())}
            >
              Back to builder
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
