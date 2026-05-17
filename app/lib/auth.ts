"use client";

type RedirectParams = {
  state?: unknown;
};

const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function getAppHomePath() {
  const basePath = normalizeBasePath(configuredBasePath);
  return `${basePath}/`;
}

export function getCurrentReturnTo() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function getReturnToFromLocation() {
  const url = new URL(window.location.href);
  const returnTo = url.searchParams.get("returnTo");
  return safeAppPath(returnTo) ?? getAppHomePath();
}

export function handleAuthRedirect({ state }: RedirectParams) {
  const returnTo =
    state &&
    typeof state === "object" &&
    "returnTo" in state &&
    typeof state.returnTo === "string"
      ? safeAppPath(state.returnTo)
      : null;

  window.location.replace(returnTo ?? getAppHomePath());
}

function normalizeBasePath(basePath: string) {
  if (!basePath || basePath === "/") return "";
  return basePath.startsWith("/")
    ? basePath.replace(/\/$/, "")
    : `/${basePath.replace(/\/$/, "")}`;
}

function safeAppPath(path: string | null) {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return null;
  return path;
}
