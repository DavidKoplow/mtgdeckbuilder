import type {
  ScryfallCard,
  ScryfallImageUris,
  ScryfallSearchResponse,
  ScryfallError,
  ScryfallSet,
  ScryfallSetsResponse,
} from "./types";

const API = "https://api.scryfall.com";

// Scryfall asks for 50-100ms between requests. We serialize calls through a
// single promise chain so rapid typing can't violate that even if we forget
// to debounce somewhere.
let chain: Promise<unknown> = Promise.resolve();
const MIN_DELAY_MS = 100;
let lastCall = 0;

async function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const since = Date.now() - lastCall;
    if (since < MIN_DELAY_MS) {
      await new Promise((r) => setTimeout(r, MIN_DELAY_MS - since));
    }
    lastCall = Date.now();
    return fn();
  };
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next as Promise<T>;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json();
  if (!res.ok || body?.object === "error") {
    const err = body as ScryfallError;
    throw new Error(err?.details || `Scryfall error ${res.status}`);
  }
  return body as T;
}

export type AdvancedFilters = {
  text?: string;
  name?: string;
  oracle?: string;
  type?: string;
  colors?: string[]; // W U B R G
  colorMode?: "exact" | "including" | "at-most" | "identity";
  rarity?: string[];
  set?: string;
  cmcMin?: number;
  cmcMax?: number;
  power?: string;
  toughness?: string;
  format?: string; // legal:standard, etc.
  usdMin?: number;
  usdMax?: number;
  sort?: "name" | "cmc" | "color" | "released" | "usd" | "edhrec";
};

export function buildQuery(f: AdvancedFilters): string {
  const parts: string[] = [];
  if (f.text?.trim()) parts.push(f.text.trim());
  if (f.name?.trim()) parts.push(`name:"${escapeTerm(f.name.trim())}"`);
  if (f.oracle?.trim()) parts.push(`o:"${escapeTerm(f.oracle.trim())}"`);
  if (f.type?.trim()) parts.push(`t:${escapeTerm(f.type.trim())}`);
  if (f.colors && f.colors.length) {
    const sym = f.colors.join("").toLowerCase();
    if (f.colorMode === "identity") parts.push(`id:${sym}`);
    else if (f.colorMode === "exact") parts.push(`c=${sym}`);
    else if (f.colorMode === "at-most") parts.push(`c<=${sym}`);
    else parts.push(`c>=${sym}`);
  }
  if (f.rarity && f.rarity.length) {
    const r = f.rarity.map((x) => `r:${x}`).join(" OR ");
    parts.push(`(${r})`);
  }
  if (f.set?.trim()) parts.push(`s:${f.set.trim()}`);
  if (typeof f.cmcMin === "number") parts.push(`cmc>=${f.cmcMin}`);
  if (typeof f.cmcMax === "number") parts.push(`cmc<=${f.cmcMax}`);
  if (f.power?.trim()) parts.push(`pow${opOrEq(f.power.trim())}`);
  if (f.toughness?.trim()) parts.push(`tou${opOrEq(f.toughness.trim())}`);
  if (f.format?.trim()) parts.push(`legal:${f.format.trim()}`);
  if (typeof f.usdMin === "number") parts.push(`usd>=${f.usdMin}`);
  if (typeof f.usdMax === "number") parts.push(`usd<=${f.usdMax}`);
  return parts.join(" ").trim();
}

function opOrEq(s: string): string {
  // Allow "3", ">=3", "<4", "=2"
  if (/^[<>=]/.test(s)) return s;
  return `=${s}`;
}

function escapeTerm(s: string): string {
  return s.replace(/"/g, '\\"');
}

export async function searchCards(
  query: string,
  opts: { page?: number; order?: AdvancedFilters["sort"]; signal?: AbortSignal } = {}
): Promise<ScryfallSearchResponse> {
  if (!query.trim()) {
    return {
      object: "list",
      has_more: false,
      data: [],
      total_cards: 0,
    };
  }
  const params = new URLSearchParams({ q: query });
  if (opts.page) params.set("page", String(opts.page));
  if (opts.order) params.set("order", opts.order);
  const url = `${API}/cards/search?${params.toString()}`;
  return throttled(async () => {
    const res = await fetch(url, { signal: opts.signal });
    if (res.status === 404) {
      // Scryfall returns 404 for "no cards found"
      return { object: "list", has_more: false, data: [], total_cards: 0 };
    }
    return jsonOrThrow<ScryfallSearchResponse>(res);
  });
}

export async function autocomplete(
  q: string,
  signal?: AbortSignal
): Promise<string[]> {
  if (!q.trim()) return [];
  const url = `${API}/cards/autocomplete?q=${encodeURIComponent(q)}`;
  return throttled(async () => {
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: string[] };
    return body.data ?? [];
  });
}

export async function getCardByName(
  name: string,
  signal?: AbortSignal
): Promise<ScryfallCard | null> {
  const url = `${API}/cards/named?exact=${encodeURIComponent(name)}`;
  return throttled(async () => {
    const res = await fetch(url, { signal });
    if (res.status === 404) return null;
    return jsonOrThrow<ScryfallCard>(res);
  });
}

export async function getCardById(
  id: string,
  signal?: AbortSignal
): Promise<ScryfallCard | null> {
  const url = `${API}/cards/${encodeURIComponent(id)}`;
  return throttled(async () => {
    const res = await fetch(url, { signal });
    if (res.status === 404) return null;
    return jsonOrThrow<ScryfallCard>(res);
  });
}

export function getCardImage(
  card: ScryfallCard,
  size: keyof ScryfallImageUris = "normal"
): string | undefined {
  if (card.image_uris?.[size]) return card.image_uris[size];
  const face = card.card_faces?.[0];
  return face?.image_uris?.[size];
}

export function getCardBackImage(
  card: ScryfallCard,
  size: keyof ScryfallImageUris = "normal"
): string | undefined {
  return card.card_faces?.[1]?.image_uris?.[size];
}

let setsCache: ScryfallSet[] | null = null;
let setsPromise: Promise<ScryfallSet[]> | null = null;

export async function getAllSets(): Promise<ScryfallSet[]> {
  if (setsCache) return setsCache;
  if (setsPromise) return setsPromise;
  setsPromise = throttled(async () => {
    const res = await fetch(`${API}/sets`);
    const body = await jsonOrThrow<ScryfallSetsResponse>(res);
    // Sort newest first; put paper sets before digital
    const data = body.data.slice().sort((a, b) => {
      const da = a.released_at ?? "";
      const db = b.released_at ?? "";
      if (da !== db) return db.localeCompare(da);
      return a.name.localeCompare(b.name);
    });
    setsCache = data;
    return data;
  });
  return setsPromise;
}
