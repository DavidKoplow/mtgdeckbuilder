import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const UINT8_MAX = 255;
const UINT24_MAX = 0xffffff;

const deckEntry = v.object({
  cardId: v.string(),
  name: v.string(),
  quantity: v.number(),
  isCommander: v.optional(v.boolean()),
  imageSmall: v.optional(v.string()),
  imageNormal: v.optional(v.string()),
  manaCost: v.optional(v.string()),
  cmc: v.optional(v.number()),
  typeLine: v.optional(v.string()),
  colors: v.optional(v.array(v.string())),
  rarity: v.optional(v.string()),
  set: v.optional(v.string()),
  collectorNumber: v.optional(v.string()),
  priceUsd: v.optional(v.number()),
});

const deckSummary = v.object({
  id: v.string(),
  name: v.string(),
  format: v.string(),
  cardCount: v.number(),
  sideboardCount: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const deck = v.object({
  id: v.string(),
  name: v.string(),
  format: v.string(),
  cardCount: v.number(),
  sideboardCount: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  entries: v.array(deckEntry),
  sideboard: v.array(deckEntry),
});

type DeckEntry = {
  cardId: string;
  name: string;
  quantity: number;
  isCommander?: boolean;
  imageSmall?: string;
  imageNormal?: string;
  manaCost?: string;
  cmc?: number;
  typeLine?: string;
  colors?: string[];
  rarity?: string;
  set?: string;
  collectorNumber?: string;
  priceUsd?: number;
};

type Deck = {
  id: string;
  name: string;
  format: string;
  cardCount: number;
  sideboardCount: number;
  createdAt: number;
  updatedAt: number;
  entries: DeckEntry[];
  sideboard: DeckEntry[];
};

type DeckCardRef = {
  cardKey: number;
  quantity: number;
  isCommander?: boolean;
};

export const listDecks = query({
  args: {},
  returns: v.array(deckSummary),
  handler: async (ctx) => {
    const userId = await getUserId(ctx);
    if (!userId) return [];

    const deckDocs = await ctx.db
      .query("userDecks")
      .withIndex("by_user_deck", (q) => q.eq("userId", userId))
      .collect();

    return deckDocs
      .map((deckDoc) => {
        const cards = deckCardRefs(deckDoc);
        const sideboardCards = deckSideboardRefs(deckDoc);
        return {
          id: deckDoc.deckId,
          name: deckDoc.name,
          format: deckDoc.format,
          cardCount: deckDoc.cardCount ?? countCards(cards),
          sideboardCount:
            deckDoc.sideboardCount ?? countCards(sideboardCards),
          createdAt: deckDoc.createdAt,
          updatedAt: deckDoc.updatedAt,
        };
      })
      .sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const get = query({
  args: {
    deckId: v.string(),
  },
  returns: v.union(v.null(), deck),
  handler: async (ctx, args): Promise<Deck | null> => {
    const userId = await getUserId(ctx);
    if (!userId) return null;

    const deckDoc = await getDeckDoc(ctx, userId, args.deckId);
    if (!deckDoc) return null;

    const cards = deckCardRefs(deckDoc);
    const sideboardCards = deckSideboardRefs(deckDoc);
    const entries = await hydrateEntries(ctx, cards);
    const sideboard = await hydrateEntries(ctx, sideboardCards);

    return {
      id: deckDoc.deckId,
      name: deckDoc.name,
      format: deckDoc.format,
      cardCount: deckDoc.cardCount ?? countCards(cards),
      sideboardCount: deckDoc.sideboardCount ?? countCards(sideboardCards),
      createdAt: deckDoc.createdAt,
      updatedAt: deckDoc.updatedAt,
      entries,
      sideboard,
    };
  },
});

export const listDecksFull = query({
  args: {},
  returns: v.array(deck),
  handler: async (ctx): Promise<Deck[]> => {
    const userId = await getUserId(ctx);
    if (!userId) return [];

    const deckDocs = await ctx.db
      .query("userDecks")
      .withIndex("by_user_deck", (q) => q.eq("userId", userId))
      .collect();

    const decks = await Promise.all(
      deckDocs.map(async (deckDoc) => {
        const cards = deckCardRefs(deckDoc);
        const sideboardCards = deckSideboardRefs(deckDoc);
        const entries = await hydrateEntries(ctx, cards);
        const sideboard = await hydrateEntries(ctx, sideboardCards);
        return {
          id: deckDoc.deckId,
          name: deckDoc.name,
          format: deckDoc.format,
          cardCount: deckDoc.cardCount ?? countCards(cards),
          sideboardCount:
            deckDoc.sideboardCount ?? countCards(sideboardCards),
          createdAt: deckDoc.createdAt,
          updatedAt: deckDoc.updatedAt,
          entries,
          sideboard,
        };
      })
    );

    return decks.sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const create = mutation({
  args: {
    deckId: v.string(),
    name: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existing = await getDeckDoc(ctx, userId, args.deckId);
    if (existing) return existing.deckId;

    const now = Date.now();
    await ctx.db.insert("userDecks", {
      userId,
      deckId: args.deckId,
      name: args.name.trim() || "Untitled Deck",
      format: "commander",
      cards: [],
      sideboardCards: [],
      cardCount: 0,
      sideboardCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    return args.deckId;
  },
});

export const rename = mutation({
  args: {
    deckId: v.string(),
    name: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const deckDoc = await requireDeckDoc(ctx, userId, args.deckId);

    await ctx.db.patch(deckDoc._id, {
      name: args.name.trim() || deckDoc.name,
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const setFormat = mutation({
  args: {
    deckId: v.string(),
    format: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const deckDoc = await requireDeckDoc(ctx, userId, args.deckId);

    await ctx.db.patch(deckDoc._id, {
      format: args.format,
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const deleteDeck = mutation({
  args: {
    deckId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const deckDoc = await getDeckDoc(ctx, userId, args.deckId);
    if (!deckDoc) return null;

    await ctx.db.delete(deckDoc._id);

    return null;
  },
});

export const addCard = mutation({
  args: {
    deckId: v.string(),
    card: deckEntry,
    quantity: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const deckDoc = await requireDeckDoc(ctx, userId, args.deckId);
    const quantity = toUint8(args.quantity);
    const cardKey = await ensureCard(ctx, args.card);
    const cards = deckCardRefs(deckDoc);
    const existing = cards.find((card) => card.cardKey === cardKey);

    let nextCards: DeckCardRef[];
    if (existing) {
      const nextQuantity = toUint8(existing.quantity + quantity);
      nextCards = cards.map((card) =>
        card.cardKey === cardKey
          ? { cardKey, quantity: nextQuantity, isCommander: card.isCommander }
          : card
      );
    } else {
      nextCards = [
        ...cards,
        { cardKey, quantity, isCommander: args.card.isCommander },
      ];
    }

    await patchDeckCards(ctx, deckDoc, nextCards);

    return null;
  },
});

export const setQuantity = mutation({
  args: {
    deckId: v.string(),
    cardId: v.string(),
    quantity: v.number(),
    zone: v.optional(v.union(v.literal("main"), v.literal("sideboard"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const deckDoc = await requireDeckDoc(ctx, userId, args.deckId);
    const cardDoc = await getCardByScryfallId(ctx, args.cardId);
    if (!cardDoc) return null;

    const quantity = Math.floor(args.quantity);
    const zone = args.zone ?? "main";
    const cards = deckCardRefs(deckDoc);
    const sideboardCards = deckSideboardRefs(deckDoc);
    const targetCards = zone === "sideboard" ? sideboardCards : cards;
    const nextTargetCards =
      quantity <= 0
        ? targetCards.filter(
            (card) => card.cardKey !== cardDoc.cardKey
          )
        : targetCards.map((card) =>
            card.cardKey === cardDoc.cardKey
              ? {
                  cardKey: card.cardKey,
                  quantity: toUint8(quantity),
                  isCommander:
                    zone === "main" ? card.isCommander : undefined,
                }
              : card
          );

    await patchDeckRefs(ctx, deckDoc, {
      cards: zone === "sideboard" ? cards : nextTargetCards,
      sideboardCards:
        zone === "sideboard" ? nextTargetCards : sideboardCards,
    });

    return null;
  },
});

export const moveCard = mutation({
  args: {
    deckId: v.string(),
    cardId: v.string(),
    to: v.union(v.literal("main"), v.literal("sideboard")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const deckDoc = await requireDeckDoc(ctx, userId, args.deckId);
    const cardDoc = await getCardByScryfallId(ctx, args.cardId);
    if (!cardDoc) return null;

    const cards = deckCardRefs(deckDoc);
    const sideboardCards = deckSideboardRefs(deckDoc);
    const fromCards = args.to === "sideboard" ? cards : sideboardCards;
    const moving = fromCards.find((card) => card.cardKey === cardDoc.cardKey);
    if (!moving) return null;

    if (args.to === "sideboard") {
      await patchDeckRefs(ctx, deckDoc, {
        cards: cards.filter((card) => card.cardKey !== cardDoc.cardKey),
        sideboardCards: [
          ...sideboardCards,
          { cardKey: moving.cardKey, quantity: moving.quantity },
        ],
      });
      return null;
    }

    await patchDeckRefs(ctx, deckDoc, {
      cards: [
        ...cards,
        { cardKey: moving.cardKey, quantity: moving.quantity },
      ],
      sideboardCards: sideboardCards.filter(
        (card) => card.cardKey !== cardDoc.cardKey
      ),
    });

    return null;
  },
});

export const setCommander = mutation({
  args: {
    deckId: v.string(),
    cardId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const deckDoc = await requireDeckDoc(ctx, userId, args.deckId);
    const cards = deckCardRefs(deckDoc);

    let commanderKey: number | null = null;
    if (args.cardId !== undefined) {
      const cardDoc = await getCardByScryfallId(ctx, args.cardId);
      if (!cardDoc) return null;
      const cardInDeck = cards.some((card) => card.cardKey === cardDoc.cardKey);
      if (!cardInDeck) return null;
      commanderKey = cardDoc.cardKey;
    }

    const nextCards = cards.map((card) => ({
      ...card,
      isCommander:
        commanderKey !== null ? card.cardKey === commanderKey : undefined,
    }));

    await patchDeckCards(ctx, deckDoc, nextCards);

    return null;
  },
});

export const clear = mutation({
  args: {
    deckId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const deckDoc = await requireDeckDoc(ctx, userId, args.deckId);

    await patchDeckRefs(ctx, deckDoc, {
      cards: [],
      sideboardCards: [],
    });

    return null;
  },
});

export const importEntries = mutation({
  args: {
    deckId: v.string(),
    entries: v.array(deckEntry),
    sideboard: v.optional(v.array(deckEntry)),
    mode: v.union(v.literal("merge"), v.literal("replace")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const deckDoc = await requireDeckDoc(ctx, userId, args.deckId);
    const incoming = await entriesToCardRefs(ctx, args.entries);
    const incomingSideboard = await entriesToCardRefs(
      ctx,
      args.sideboard ?? [],
      false
    );

    if (args.mode === "replace") {
      await patchDeckRefs(ctx, deckDoc, {
        cards: incoming,
        sideboardCards: incomingSideboard,
      });
      return null;
    }

    const nextByKey = new Map(
      deckCardRefs(deckDoc).map((card) => [card.cardKey, { ...card }])
    );

    for (const card of incoming) {
      const existing = nextByKey.get(card.cardKey);
      nextByKey.set(card.cardKey, {
        cardKey: card.cardKey,
        quantity: existing
          ? toUint8(existing.quantity + card.quantity)
          : card.quantity,
      });
    }

    const nextSideboardByKey = new Map(
      deckSideboardRefs(deckDoc).map((card) => [card.cardKey, { ...card }])
    );

    for (const card of incomingSideboard) {
      const existing = nextSideboardByKey.get(card.cardKey);
      nextSideboardByKey.set(card.cardKey, {
        cardKey: card.cardKey,
        quantity: existing
          ? toUint8(existing.quantity + card.quantity)
          : card.quantity,
      });
    }

    await patchDeckRefs(ctx, deckDoc, {
      cards: Array.from(nextByKey.values()),
      sideboardCards: Array.from(nextSideboardByKey.values()),
    });

    return null;
  },
});

export const replaceDeck = mutation({
  args: {
    deck,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const deckDoc = await requireDeckDoc(ctx, userId, args.deck.id);
    const cards = await entriesToCardRefs(ctx, args.deck.entries);
    const sideboardCards = await entriesToCardRefs(
      ctx,
      args.deck.sideboard,
      false
    );
    const normalizedCards = normalizeCardRefs(cards);
    const normalizedSideboardCards = normalizeCardRefs(sideboardCards, false);

    await ctx.db.patch(deckDoc._id, {
      name: args.deck.name,
      format: args.deck.format,
      cards: normalizedCards,
      sideboardCards: normalizedSideboardCards,
      cardCount: countCards(normalizedCards),
      sideboardCount: countCards(normalizedSideboardCards),
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const patchCardData = mutation({
  args: {
    deckId: v.string(),
    cards: v.array(
      v.object({
        cardId: v.string(),
        priceUsd: v.optional(v.number()),
        rarity: v.optional(v.string()),
      })
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    await requireDeckDoc(ctx, userId, args.deckId);

    for (const card of args.cards) {
      const cardDoc = await getCardByScryfallId(ctx, card.cardId);
      if (!cardDoc) continue;

      const patch: Partial<Omit<Doc<"cards">, "_id" | "_creationTime">> = {};
      if (card.priceUsd !== undefined && cardDoc.priceUsd === undefined) {
        patch.priceUsd = card.priceUsd;
      }
      if (card.rarity !== undefined && cardDoc.rarity !== card.rarity) {
        patch.rarity = card.rarity;
      }
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(cardDoc._id, patch);
      }
    }

    return null;
  },
});

async function getUserId(ctx: QueryCtx | MutationCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject ?? null;
}

async function requireUserId(ctx: MutationCtx): Promise<string> {
  const userId = await getUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

async function getDeckDoc(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  deckId: string
) {
  return await ctx.db
    .query("userDecks")
    .withIndex("by_user_deck", (q) =>
      q.eq("userId", userId).eq("deckId", deckId)
    )
    .unique();
}

async function requireDeckDoc(
  ctx: MutationCtx,
  userId: string,
  deckId: string
) {
  const deckDoc = await getDeckDoc(ctx, userId, deckId);
  if (!deckDoc) throw new Error("Deck not found");
  return deckDoc;
}

function deckCardRefs(deckDoc: Doc<"userDecks">): DeckCardRef[] {
  return (deckDoc.cards ?? []).map((card) => ({
    cardKey: asUint24(card.cardKey),
    quantity: toUint8(card.quantity),
    isCommander: card.isCommander === true,
  }));
}

function deckSideboardRefs(deckDoc: Doc<"userDecks">): DeckCardRef[] {
  return (deckDoc.sideboardCards ?? []).map((card) => ({
    cardKey: asUint24(card.cardKey),
    quantity: toUint8(card.quantity),
  }));
}

async function hydrateEntries(ctx: QueryCtx, cards: DeckCardRef[]) {
  const entries: DeckEntry[] = [];

  for (const card of cards) {
    const cardDoc = await getCardByKey(ctx, card.cardKey);
    if (!cardDoc) continue;
    entries.push(cardDocToEntry(cardDoc, card.quantity, card.isCommander));
  }

  return entries;
}

async function entriesToCardRefs(
  ctx: MutationCtx,
  entries: DeckEntry[],
  allowCommander = true
) {
  const byKey = new Map<number, DeckCardRef>();

  for (const entry of entries) {
    const quantity = toUint8(entry.quantity);
    const cardKey = await ensureCard(ctx, entry);
    const existing = byKey.get(cardKey);
    const next: DeckCardRef = {
      cardKey,
      quantity: existing ? toUint8(existing.quantity + quantity) : quantity,
    };
    if (allowCommander && (existing?.isCommander || entry.isCommander)) {
      next.isCommander = true;
    }
    byKey.set(cardKey, next);
  }

  return Array.from(byKey.values());
}

async function ensureCard(ctx: MutationCtx, entry: DeckEntry) {
  const existing = await getCardByScryfallId(ctx, entry.cardId);
  if (existing) {
    await ctx.db.patch(existing._id, cleanCardPatch(entry));
    return asUint24(existing.cardKey);
  }

  const cardKey = await availableCardKey(ctx, entry.cardId);
  await ctx.db.insert("cards", {
    cardKey,
    scryfallId: entry.cardId,
    ...cleanCardPatch(entry),
    name: entry.name,
  });

  return cardKey;
}

async function availableCardKey(ctx: MutationCtx, scryfallId: string) {
  let cardKey = hashUint24(scryfallId);

  for (let attempts = 0; attempts <= UINT24_MAX; attempts++) {
    const existing = await getCardByKey(ctx, cardKey);
    if (!existing || existing.scryfallId === scryfallId) return cardKey;
    cardKey = (cardKey + 1) & UINT24_MAX;
  }

  throw new Error("No card keys available");
}

async function getCardByKey(ctx: QueryCtx | MutationCtx, cardKey: number) {
  return await ctx.db
    .query("cards")
    .withIndex("by_card_key", (q) => q.eq("cardKey", asUint24(cardKey)))
    .unique();
}

async function getCardByScryfallId(
  ctx: QueryCtx | MutationCtx,
  scryfallId: string
) {
  return await ctx.db
    .query("cards")
    .withIndex("by_scryfall_id", (q) => q.eq("scryfallId", scryfallId))
    .unique();
}

async function patchDeckCards(
  ctx: MutationCtx,
  deckDoc: Doc<"userDecks">,
  cards: DeckCardRef[]
) {
  await patchDeckRefs(ctx, deckDoc, {
    cards,
    sideboardCards: deckSideboardRefs(deckDoc),
  });
}

async function patchDeckRefs(
  ctx: MutationCtx,
  deckDoc: Doc<"userDecks">,
  refs: {
    cards: DeckCardRef[];
    sideboardCards: DeckCardRef[];
  }
) {
  const normalized = normalizeCardRefs(refs.cards);
  const normalizedSideboard = normalizeCardRefs(refs.sideboardCards, false);
  await ctx.db.patch(deckDoc._id, {
    cards: normalized,
    sideboardCards: normalizedSideboard,
    cardCount: countCards(normalized),
    sideboardCount: countCards(normalizedSideboard),
    updatedAt: Date.now(),
  });
}

function normalizeCardRefs(cards: DeckCardRef[], allowCommander = true) {
  const byKey = new Map<number, DeckCardRef>();

  for (const card of cards) {
    const cardKey = asUint24(card.cardKey);
    const quantity = toUint8(card.quantity);
    const existing = byKey.get(cardKey);
    const next: DeckCardRef = {
      cardKey,
      quantity: existing ? toUint8(existing.quantity + quantity) : quantity,
    };
    if (allowCommander && (existing?.isCommander || card.isCommander)) {
      next.isCommander = true;
    }
    byKey.set(cardKey, next);
  }

  let commanderAssigned = false;
  return Array.from(byKey.values()).map((card) => {
    if (!allowCommander || !card.isCommander) {
      return { cardKey: card.cardKey, quantity: card.quantity };
    }
    if (commanderAssigned) {
      return { cardKey: card.cardKey, quantity: card.quantity };
    }
    commanderAssigned = true;
    return { ...card, isCommander: true };
  });
}

function countCards(cards: DeckCardRef[]) {
  return cards.reduce((total, card) => total + card.quantity, 0);
}

function cardDocToEntry(
  cardDoc: Doc<"cards">,
  quantity: number,
  isCommander?: boolean
): DeckEntry {
  const entry: DeckEntry = {
    cardId: cardDoc.scryfallId,
    name: cardDoc.name,
    quantity,
  };

  if (isCommander) entry.isCommander = true;

  if (cardDoc.imageSmall !== undefined) entry.imageSmall = cardDoc.imageSmall;
  if (cardDoc.imageNormal !== undefined) entry.imageNormal = cardDoc.imageNormal;
  if (cardDoc.manaCost !== undefined) entry.manaCost = cardDoc.manaCost;
  if (cardDoc.cmc !== undefined) entry.cmc = cardDoc.cmc;
  if (cardDoc.typeLine !== undefined) entry.typeLine = cardDoc.typeLine;
  if (cardDoc.colors !== undefined) entry.colors = cardDoc.colors;
  if (cardDoc.rarity !== undefined) entry.rarity = cardDoc.rarity;
  if (cardDoc.set !== undefined) entry.set = cardDoc.set;
  if (cardDoc.collectorNumber !== undefined) {
    entry.collectorNumber = cardDoc.collectorNumber;
  }
  if (cardDoc.priceUsd !== undefined) entry.priceUsd = cardDoc.priceUsd;

  return entry;
}

function cleanCardPatch(entry: DeckEntry) {
  const doc: Partial<Omit<Doc<"cards">, "_id" | "_creationTime">> = {
    name: entry.name,
  };

  if (entry.imageSmall !== undefined) doc.imageSmall = entry.imageSmall;
  if (entry.imageNormal !== undefined) doc.imageNormal = entry.imageNormal;
  if (entry.manaCost !== undefined) doc.manaCost = entry.manaCost;
  if (entry.cmc !== undefined) doc.cmc = entry.cmc;
  if (entry.typeLine !== undefined) doc.typeLine = entry.typeLine;
  if (entry.colors !== undefined) doc.colors = entry.colors;
  if (entry.rarity !== undefined) doc.rarity = entry.rarity;
  if (entry.set !== undefined) doc.set = entry.set;
  if (entry.collectorNumber !== undefined) {
    doc.collectorNumber = entry.collectorNumber;
  }
  if (entry.priceUsd !== undefined) doc.priceUsd = entry.priceUsd;

  return doc;
}

function toUint8(value: number) {
  if (!Number.isFinite(value)) return 1;
  const next = Math.floor(value);
  return Math.min(UINT8_MAX, Math.max(1, next));
}

function asUint24(value: number) {
  const next = Math.floor(value);
  if (!Number.isInteger(next) || next < 0 || next > UINT24_MAX) {
    throw new Error(`Card id must be a uint24 integer`);
  }
  return next;
}

function hashUint24(value: string) {
  let hash = 0x811c9d;

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) & UINT24_MAX;
  }

  return asUint24(hash);
}
