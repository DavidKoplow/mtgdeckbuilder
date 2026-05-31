"use client";

import { useCallback, useState } from "react";

const APP_SETTINGS_KEY = "mdg.app.settings";
export const PLAYTEST_USERNAME_MAX_LENGTH = 24;

export type AppSettings = {
  playtestUsername: string;
  updatedAt: number;
};

const DEFAULT_APP_SETTINGS: AppSettings = {
  playtestUsername: "",
  updatedAt: 0,
};

export function sanitizePlaytestUsername(raw: string): string {
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, PLAYTEST_USERNAME_MAX_LENGTH);
}

export function readAppSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_APP_SETTINGS;

  try {
    const raw = window.localStorage.getItem(APP_SETTINGS_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_APP_SETTINGS,
      playtestUsername:
        typeof parsed.playtestUsername === "string"
          ? sanitizePlaytestUsername(parsed.playtestUsername)
          : "",
      updatedAt:
        typeof parsed.updatedAt === "number" ? parsed.updatedAt : DEFAULT_APP_SETTINGS.updatedAt,
    };
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function writeAppSettings(next: AppSettings): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      APP_SETTINGS_KEY,
      JSON.stringify({
        playtestUsername: sanitizePlaytestUsername(next.playtestUsername),
        updatedAt: Date.now(),
      })
    );
  } catch {
    // Storage can be disabled by browser privacy settings.
  }
}

export function effectivePlaytestUsername(
  settings: Pick<AppSettings, "playtestUsername"> = readAppSettings()
): string {
  const name = sanitizePlaytestUsername(settings.playtestUsername);
  return name || "Player";
}

export function usePlaytestUsername(): [string, (value: string) => void] {
  const [username, setUsernameState] = useState(
    () => readAppSettings().playtestUsername
  );

  const setUsername = useCallback((value: string) => {
    const next = sanitizePlaytestUsername(value);
    setUsernameState(next);
    writeAppSettings({ playtestUsername: next, updatedAt: Date.now() });
  }, []);

  return [username, setUsername];
}
