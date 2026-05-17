"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@workos-inc/authkit-react";
import { getAppHomePath, getReturnToFromLocation } from "../lib/auth";
import { AppIcon } from "./AppIcon";

type AuthRedirectProps = {
  mode: "callback" | "sign-in" | "sign-up";
};

export function AuthRedirect({ mode }: AuthRedirectProps) {
  const { isLoading, signIn, signUp, user } = useAuth();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (mode === "callback") return;

    const startAuth = mode === "sign-up" ? signUp : signIn;
    startAuth({ state: { returnTo: getReturnToFromLocation() } }).catch(() => {
      setFailed(true);
    });
  }, [mode, signIn, signUp]);

  useEffect(() => {
    if (mode !== "callback" || isLoading || !user) return;
    window.location.replace(getAppHomePath());
  }, [isLoading, mode, user]);

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
              ? "Return to the builder and try signing in again."
              : "Finishing your WorkOS session."}
          </p>
        </div>
      </div>
    </div>
  );
}
