"use client";

type RedirectParams = {
  state?: unknown;
};

type WorkosAuthUrlOptions = {
  state: {
    returnTo: string;
  };
};

const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const productionAppOrigin = "https://magicaldeckgatherer.com";
const workosCodeVerifierKey = "workos:code-verifier";
const workosCodeVerifierBackupKey =
  "magicaldeckgatherer:workos-code-verifier";
const workosCodeVerifierBackupAtKey =
  "magicaldeckgatherer:workos-code-verifier-at";
const workosCodeVerifierCookieKey =
  "magicaldeckgatherer_workos_code_verifier";
const workosCodeVerifierBackupMaxAge = 20 * 60 * 1000;
const workosCodeVerifierBackupMaxAgeSeconds =
  workosCodeVerifierBackupMaxAge / 1000;

export function getAppHomePath() {
  const basePath = normalizeBasePath(configuredBasePath);
  return `${basePath}/`;
}

export function getAppBuilderPath() {
  const basePath = normalizeBasePath(configuredBasePath);
  return `${basePath}/builder/`;
}

export function getAppCallbackPath() {
  const basePath = normalizeBasePath(configuredBasePath);
  return `${basePath}/callback/`;
}

export function getAppLoginPath() {
  const basePath = normalizeBasePath(configuredBasePath);
  return `${basePath}/login/`;
}

export function getWorkosRedirectUri(configuredRedirectUri?: string | null) {
  if (typeof window === "undefined") return configuredRedirectUri ?? "";

  const currentHost = window.location.hostname;
  const fallbackOrigin = isLocalHostname(currentHost)
    ? window.location.origin
    : productionAppOrigin;
  const fallbackRedirectUri = `${fallbackOrigin}${getAppCallbackPath()}`;
  if (!configuredRedirectUri) return fallbackRedirectUri;

  try {
    const configuredUrl = new URL(
      configuredRedirectUri,
      window.location.origin
    );
    if (
      isLocalHostname(configuredUrl.hostname) &&
      !isLocalHostname(currentHost)
    ) {
      return fallbackRedirectUri;
    }
    return configuredUrl.toString();
  } catch {
    return fallbackRedirectUri;
  }
}

export function getWorkosDevMode(
  configuredDevMode?: string | null,
  configuredApiHostname?: string | null
) {
  const normalizedDevMode = configuredDevMode?.trim().toLowerCase();
  if (normalizedDevMode === "true") return true;
  if (normalizedDevMode === "false") return false;

  // Static exports cannot rely on WorkOS cookies from api.workos.com.
  return configuredApiHostname?.trim() ? undefined : true;
}

export function getCurrentReturnTo() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function getReturnToFromLocation() {
  const url = new URL(window.location.href);
  const returnTo = url.searchParams.get("returnTo");
  return safeAppPath(returnTo) ?? getAppHomePath();
}

export async function startWorkosAuthRedirect(
  getAuthUrl: (options: WorkosAuthUrlOptions) => Promise<string>,
  returnTo: string
) {
  const url = await getAuthUrl({ state: { returnTo } });
  if (!url) throw new Error("WorkOS did not return an authorization URL.");

  backupWorkosCodeVerifier();
  window.location.assign(url);
}

export function restoreWorkosCodeVerifierBackup() {
  if (typeof window === "undefined") return;
  if (!new URLSearchParams(window.location.search).has("code")) return;
  if (window.sessionStorage.getItem(workosCodeVerifierKey)) return;

  try {
    const verifier =
      getFreshStoredWorkosCodeVerifier() ??
      readCookie(workosCodeVerifierCookieKey);

    if (verifier) {
      window.sessionStorage.setItem(workosCodeVerifierKey, verifier);
    } else {
      clearWorkosCodeVerifierBackup();
    }
  } catch {
    clearWorkosCodeVerifierBackup();
  }
}

export function clearWorkosCodeVerifierBackup() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(workosCodeVerifierBackupKey);
    window.localStorage.removeItem(workosCodeVerifierBackupAtKey);
  } catch {
    // Storage can be disabled by browser privacy settings.
  }
  writeCookie(workosCodeVerifierCookieKey, "", 0);
}

export function handleAuthRedirect({ state }: RedirectParams) {
  clearWorkosCodeVerifierBackup();

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

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function backupWorkosCodeVerifier() {
  if (typeof window === "undefined") return;

  let verifier: string | null = null;
  try {
    verifier = window.sessionStorage.getItem(workosCodeVerifierKey);
  } catch {
    return;
  }
  if (!verifier) return;

  try {
    window.localStorage.setItem(workosCodeVerifierBackupKey, verifier);
    window.localStorage.setItem(
      workosCodeVerifierBackupAtKey,
      Date.now().toString()
    );
  } catch {
    // Storage can be disabled by browser privacy settings.
  }

  writeCookie(
    workosCodeVerifierCookieKey,
    verifier,
    workosCodeVerifierBackupMaxAgeSeconds
  );
}

function getFreshStoredWorkosCodeVerifier() {
  try {
    const backedUpAt = Number(
      window.localStorage.getItem(workosCodeVerifierBackupAtKey)
    );
    const isFresh =
      Number.isFinite(backedUpAt) &&
      Date.now() - backedUpAt <= workosCodeVerifierBackupMaxAge;
    const verifier = window.localStorage.getItem(workosCodeVerifierBackupKey);

    return verifier && isFresh ? verifier : null;
  } catch {
    return null;
  }
}

function readCookie(name: string) {
  const encodedName = `${encodeURIComponent(name)}=`;
  const cookie = document.cookie
    .split("; ")
    .find((value) => value.startsWith(encodedName));
  if (!cookie) return null;

  return decodeURIComponent(cookie.slice(encodedName.length));
}

function writeCookie(name: string, value: string, maxAgeSeconds: number) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(
    value
  )}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secure}`;
}

function safeAppPath(path: string | null) {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return null;
  return path;
}
