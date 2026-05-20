import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const UINT8_MAX = 255;
const UINT24_MAX = 0xffffff;
const DEFAULT_PUBLIC_DECK_LIMIT = 24;
const MAX_PUBLIC_DECK_LIMIT = 64;
const PUBLIC_DECK_SEARCH_SCAN_LIMIT = 1000;
const PUBLIC_CARD_PREVIEW_LIMIT = 8;
const PUBLIC_CARD_MATCH_LIMIT = 6;

const deckEntry = v.object({
  cardId: v.string(),
  name: v.string(),
  quantity: v.number(),
  isCommander: v.optional(v.boolean()),
  imageSmall: v.optional(v.string()),
  imageNormal: v.optional(v.string()),
  imageArtCrop: v.optional(v.string()),
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
  publicId: v.optional(v.string()),
  isPublic: v.boolean(),
  name: v.string(),
  format: v.string(),
  cardCount: v.number(),
  sideboardCount: v.number(),
  maybeboardCount: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const deck = v.object({
  id: v.string(),
  publicId: v.optional(v.string()),
  isPublic: v.boolean(),
  name: v.string(),
  format: v.string(),
  cardCount: v.number(),
  sideboardCount: v.number(),
  maybeboardCount: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  entries: v.array(deckEntry),
  sideboard: v.array(deckEntry),
  maybeboard: v.array(deckEntry),
});

const deckInput = v.object({
  id: v.string(),
  publicId: v.optional(v.string()),
  isPublic: v.optional(v.boolean()),
  name: v.string(),
  format: v.string(),
  cardCount: v.number(),
  sideboardCount: v.number(),
  maybeboardCount: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  entries: v.array(deckEntry),
  sideboard: v.array(deckEntry),
  maybeboard: v.optional(v.array(deckEntry)),
});

const publicDeckPreviewCard = v.object({
  name: v.string(),
  quantity: v.number(),
});

const publicDeckColorBreakdown = v.object({
  W: v.number(),
  U: v.number(),
  B: v.number(),
  R: v.number(),
  G: v.number(),
  C: v.number(),
});

const publicDeckSummary = v.object({
  publicId: v.string(),
  name: v.string(),
  format: v.string(),
  cardCount: v.number(),
  sideboardCount: v.number(),
  maybeboardCount: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  authorName: v.string(),
  viewCount: v.number(),
  matchingCards: v.array(publicDeckPreviewCard),
  previewCards: v.array(publicDeckPreviewCard),
  featuredCardName: v.optional(v.string()),
  featuredImage: v.optional(v.string()),
  totalPriceUsd: v.optional(v.number()),
  pricedCardCount: v.number(),
  manaCurve: v.array(v.number()),
  colorBreakdown: publicDeckColorBreakdown,
});

const publicDeck = v.object({
  id: v.string(),
  publicId: v.string(),
  isPublic: v.boolean(),
  name: v.string(),
  format: v.string(),
  cardCount: v.number(),
  sideboardCount: v.number(),
  maybeboardCount: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  entries: v.array(deckEntry),
  sideboard: v.array(deckEntry),
  maybeboard: v.array(deckEntry),
  authorName: v.string(),
});

type DeckEntry = {
  cardId: string;
  name: string;
  quantity: number;
  isCommander?: boolean;
  imageSmall?: string;
  imageNormal?: string;
  imageArtCrop?: string;
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
  publicId?: string;
  isPublic: boolean;
  name: string;
  format: string;
  cardCount: number;
  sideboardCount: number;
  maybeboardCount: number;
  createdAt: number;
  updatedAt: number;
  entries: DeckEntry[];
  sideboard: DeckEntry[];
  maybeboard: DeckEntry[];
};

type PublicDeckSummary = {
  publicId: string;
  name: string;
  format: string;
  cardCount: number;
  sideboardCount: number;
  maybeboardCount: number;
  createdAt: number;
  updatedAt: number;
  authorName: string;
  viewCount: number;
  matchingCards: PublicDeckPreviewCard[];
  previewCards: PublicDeckPreviewCard[];
  featuredCardName?: string;
  featuredImage?: string;
  totalPriceUsd?: number;
  pricedCardCount: number;
  manaCurve: number[];
  colorBreakdown: DeckColorBreakdown;
};

type PublicDeckPreviewCard = {
  name: string;
  quantity: number;
};

type DeckColorBreakdown = {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  C: number;
};

type PublicDeck = Omit<Deck, "publicId"> & {
  publicId: string;
  authorName: string;
};

type PublicDeckDisplayData = {
  allCards: PublicDeckPreviewCard[];
  previewCards: PublicDeckPreviewCard[];
  featuredCardName?: string;
  featuredImage?: string;
  totalPriceUsd?: number;
  pricedCardCount: number;
  manaCurve: number[];
  colorBreakdown: DeckColorBreakdown;
};

type DeckCardRef = {
  cardKey: number;
  quantity: number;
  isCommander?: boolean;
};

type DeckZone = "main" | "sideboard" | "maybeboard";

type DeckRefs = {
  cards: DeckCardRef[];
  sideboardCards: DeckCardRef[];
  maybeboardCards: DeckCardRef[];
};

const deckZone = v.union(
  v.literal("main"),
  v.literal("sideboard"),
  v.literal("maybeboard")
);

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
        const maybeboardCards = deckMaybeboardRefs(deckDoc);
        return {
          id: deckDoc.deckId,
          publicId: publicIdForDeck(deckDoc),
          isPublic: isDeckPublic(deckDoc),
          name: deckDoc.name,
          format: deckDoc.format,
          cardCount: deckDoc.cardCount ?? countCards(cards),
          sideboardCount:
            deckDoc.sideboardCount ?? countCards(sideboardCards),
          maybeboardCount:
            deckDoc.maybeboardCount ?? countCards(maybeboardCards),
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
    const maybeboardCards = deckMaybeboardRefs(deckDoc);
    const entries = await hydrateEntries(ctx, cards);
    const sideboard = await hydrateEntries(ctx, sideboardCards);
    const maybeboard = await hydrateEntries(ctx, maybeboardCards);

    return {
      id: deckDoc.deckId,
      publicId: publicIdForDeck(deckDoc),
      isPublic: isDeckPublic(deckDoc),
      name: deckDoc.name,
      format: deckDoc.format,
      cardCount: deckDoc.cardCount ?? countCards(cards),
      sideboardCount: deckDoc.sideboardCount ?? countCards(sideboardCards),
      maybeboardCount: deckDoc.maybeboardCount ?? countCards(maybeboardCards),
      createdAt: deckDoc.createdAt,
      updatedAt: deckDoc.updatedAt,
      entries,
      sideboard,
      maybeboard,
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
        const maybeboardCards = deckMaybeboardRefs(deckDoc);
        const entries = await hydrateEntries(ctx, cards);
        const sideboard = await hydrateEntries(ctx, sideboardCards);
        const maybeboard = await hydrateEntries(ctx, maybeboardCards);
        return {
          id: deckDoc.deckId,
          publicId: publicIdForDeck(deckDoc),
          isPublic: isDeckPublic(deckDoc),
          name: deckDoc.name,
          format: deckDoc.format,
          cardCount: deckDoc.cardCount ?? countCards(cards),
          sideboardCount:
            deckDoc.sideboardCount ?? countCards(sideboardCards),
          maybeboardCount:
            deckDoc.maybeboardCount ?? countCards(maybeboardCards),
          createdAt: deckDoc.createdAt,
          updatedAt: deckDoc.updatedAt,
          entries,
          sideboard,
          maybeboard,
        };
      })
    );

    return decks.sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const listRecentPublicDecks = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(publicDeckSummary),
  handler: async (ctx, args): Promise<PublicDeckSummary[]> => {
    const limit = clampPublicDeckLimit(args.limit);
    const results: PublicDeckSummary[] = [];

    for await (const deckDoc of ctx.db
      .query("userDecks")
      .withIndex("by_updated")
      .order("desc")) {
      if (!isDeckPublic(deckDoc)) continue;
      results.push(await publicDeckSummaryFromDoc(ctx, deckDoc));
      if (results.length >= limit) break;
    }

    return results;
  },
});

export const searchPublicDecks = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(publicDeckSummary),
  handler: async (ctx, args): Promise<PublicDeckSummary[]> => {
    const normalizedQuery = normalizeSearchText(args.query);
    if (!normalizedQuery) {
      const limit = clampPublicDeckLimit(args.limit);
      const results: PublicDeckSummary[] = [];
      for await (const deckDoc of ctx.db
        .query("userDecks")
        .withIndex("by_updated")
        .order("desc")) {
        if (!isDeckPublic(deckDoc)) continue;
        results.push(await publicDeckSummaryFromDoc(ctx, deckDoc));
        if (results.length >= limit) break;
      }
      return results;
    }

    const limit = clampPublicDeckLimit(args.limit);
    const results: PublicDeckSummary[] = [];
    let scanned = 0;

    for await (const deckDoc of ctx.db
      .query("userDecks")
      .withIndex("by_updated")
      .order("desc")) {
      scanned += 1;
      if (scanned > PUBLIC_DECK_SEARCH_SCAN_LIMIT) break;
      if (!isDeckPublic(deckDoc)) continue;

      const deckNameMatches = normalizeSearchText(deckDoc.name).includes(
        normalizedQuery
      );
      let matchingCards: PublicDeckPreviewCard[] = [];
      let previewData: PublicDeckDisplayData | undefined;

      const knownCardText = deckDoc.cardSearchText;
      const cardTextMayMatch =
        knownCardText === undefined ||
        normalizeSearchText(knownCardText).includes(normalizedQuery);
      if (cardTextMayMatch) {
        previewData = await publicDeckDisplayData(ctx, deckDoc);
        matchingCards = matchingCardPreviews(
          previewData.allCards,
          normalizedQuery
        );
      }

      if (
        !deckNameMatches &&
        matchingCards.length === 0
      ) {
        continue;
      }

      results.push(
        await publicDeckSummaryFromDoc(
          ctx,
          deckDoc,
          matchingCards,
          previewData
        )
      );
      if (results.length >= limit) break;
    }

    return results;
  },
});

export const getPublicDeck = query({
  args: {
    publicId: v.string(),
  },
  returns: v.union(v.null(), publicDeck),
  handler: async (ctx, args): Promise<PublicDeck | null> => {
    const deckDoc = await getPublicDeckDoc(ctx, args.publicId);
    if (!deckDoc || !isDeckPublic(deckDoc)) return null;

    const publicId = publicIdForDeck(deckDoc);
    const cards = deckCardRefs(deckDoc);
    const sideboardCards = deckSideboardRefs(deckDoc);
    const maybeboardCards = deckMaybeboardRefs(deckDoc);
    const entries = await hydrateEntries(ctx, cards);
    const sideboard = await hydrateEntries(ctx, sideboardCards);
    const maybeboard = await hydrateEntries(ctx, maybeboardCards);

    return {
      id: temporaryPublicDeckId(publicId),
      publicId,
      isPublic: true,
      name: deckDoc.name,
      format: deckDoc.format,
      cardCount: deckDoc.cardCount ?? countCards(cards),
      sideboardCount:
        deckDoc.sideboardCount ?? countCards(sideboardCards),
      maybeboardCount:
        deckDoc.maybeboardCount ?? countCards(maybeboardCards),
      createdAt: deckDoc.createdAt,
      updatedAt: deckDoc.updatedAt,
      entries,
      sideboard,
      maybeboard,
      authorName: anonymousAuthorName(deckDoc.userId),
    };
  },
});

export const recordPublicDeckView = mutation({
  args: {
    publicId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const deckDoc = await getPublicDeckDoc(ctx, args.publicId);
    if (!deckDoc || !isDeckPublic(deckDoc)) return null;

    await ctx.db.patch(deckDoc._id, {
      viewCount: (deckDoc.viewCount ?? 0) + 1,
    });

    return null;
  },
});

export const create = mutation({
  args: {
    deckId: v.string(),
    name: v.string(),
    isPublic: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const existing = await getDeckDoc(ctx, userId, args.deckId);
    if (existing) {
      if (!existing.publicId || existing.isPublic === undefined) {
        await ctx.db.patch(existing._id, {
          publicId: publicIdForDeck(existing),
          isPublic: isDeckPublic(existing),
        });
      }
      return existing.deckId;
    }

    const now = Date.now();
    const isPublic = args.isPublic ?? true;
    await ctx.db.insert("userDecks", {
      userId,
      deckId: args.deckId,
      publicId: publicIdForNewDeck(userId, args.deckId, now),
      isPublic,
      name: args.name.trim() || "Untitled Deck",
      format: "commander",
      cards: [],
      sideboardCards: [],
      maybeboardCards: [],
      cardNames: [],
      cardSearchText: "",
      previewCardNames: [],
      cardCount: 0,
      sideboardCount: 0,
      maybeboardCount: 0,
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

export const setPublic = mutation({
  args: {
    deckId: v.string(),
    isPublic: v.boolean(),
  },
  returns: v.object({
    isPublic: v.boolean(),
    publicId: v.string(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const deckDoc = await requireDeckDoc(ctx, userId, args.deckId);
    const publicId = publicIdForDeck(deckDoc);

    await ctx.db.patch(deckDoc._id, {
      isPublic: args.isPublic,
      publicId,
      updatedAt: Date.now(),
    });

    return { isPublic: args.isPublic, publicId };
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
    zone: v.optional(deckZone),
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
    const maybeboardCards = deckMaybeboardRefs(deckDoc);
    const refs = { cards, sideboardCards, maybeboardCards };
    const targetCards = deckRefsForZone(refs, zone);
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

    await patchDeckRefs(
      ctx,
      deckDoc,
      withZoneRefs(refs, zone, nextTargetCards)
    );

    return null;
  },
});

export const moveCard = mutation({
  args: {
    deckId: v.string(),
    cardId: v.string(),
    from: v.optional(deckZone),
    to: deckZone,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const deckDoc = await requireDeckDoc(ctx, userId, args.deckId);
    const cardDoc = await getCardByScryfallId(ctx, args.cardId);
    if (!cardDoc) return null;

    const from: DeckZone =
      args.from ?? (args.to === "sideboard" ? "main" : "sideboard");
    if (from === args.to) return null;

    const cards = deckCardRefs(deckDoc);
    const sideboardCards = deckSideboardRefs(deckDoc);
    const maybeboardCards = deckMaybeboardRefs(deckDoc);
    const refs = { cards, sideboardCards, maybeboardCards };
    const fromCards = deckRefsForZone(refs, from);
    const toCards = deckRefsForZone(refs, args.to);
    const moving = fromCards.find((card) => card.cardKey === cardDoc.cardKey);
    if (!moving) return null;

    await patchDeckRefs(
      ctx,
      deckDoc,
      withZoneRefs(
        withZoneRefs(
          refs,
          from,
          fromCards.filter((card) => card.cardKey !== cardDoc.cardKey)
        ),
        args.to,
        [...toCards, { cardKey: moving.cardKey, quantity: moving.quantity }]
      )
    );

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
      maybeboardCards: [],
    });

    return null;
  },
});

export const importEntries = mutation({
  args: {
    deckId: v.string(),
    entries: v.array(deckEntry),
    sideboard: v.optional(v.array(deckEntry)),
    maybeboard: v.optional(v.array(deckEntry)),
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
    const incomingMaybeboard = await entriesToCardRefs(
      ctx,
      args.maybeboard ?? [],
      false
    );

    if (args.mode === "replace") {
      await patchDeckRefs(ctx, deckDoc, {
        cards: incoming,
        sideboardCards: incomingSideboard,
        maybeboardCards: incomingMaybeboard,
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

    const nextMaybeboardByKey = new Map(
      deckMaybeboardRefs(deckDoc).map((card) => [card.cardKey, { ...card }])
    );

    for (const card of incomingMaybeboard) {
      const existing = nextMaybeboardByKey.get(card.cardKey);
      nextMaybeboardByKey.set(card.cardKey, {
        cardKey: card.cardKey,
        quantity: existing
          ? toUint8(existing.quantity + card.quantity)
          : card.quantity,
      });
    }

    await patchDeckRefs(ctx, deckDoc, {
      cards: Array.from(nextByKey.values()),
      sideboardCards: Array.from(nextSideboardByKey.values()),
      maybeboardCards: Array.from(nextMaybeboardByKey.values()),
    });

    return null;
  },
});

export const replaceDeck = mutation({
  args: {
    deck: deckInput,
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
    const maybeboardCards = await entriesToCardRefs(
      ctx,
      args.deck.maybeboard ?? [],
      false
    );
    const normalizedCards = normalizeCardRefs(cards);
    const normalizedSideboardCards = normalizeCardRefs(sideboardCards, false);
    const normalizedMaybeboardCards = normalizeCardRefs(maybeboardCards, false);
    const cardMetadata = await deckCardSearchMetadata(ctx, {
      cards: normalizedCards,
      sideboardCards: normalizedSideboardCards,
      maybeboardCards: normalizedMaybeboardCards,
    });

    await ctx.db.patch(deckDoc._id, {
      name: args.deck.name,
      format: args.deck.format,
      cards: normalizedCards,
      sideboardCards: normalizedSideboardCards,
      maybeboardCards: normalizedMaybeboardCards,
      ...cardMetadata,
      cardCount: countCards(normalizedCards),
      sideboardCount: countCards(normalizedSideboardCards),
      maybeboardCount: countCards(normalizedMaybeboardCards),
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

function isDeckPublic(deckDoc: Doc<"userDecks">) {
  return deckDoc.isPublic !== false;
}

function publicIdForNewDeck(userId: string, deckId: string, now: number) {
  return uuidFromString(`public-deck:${userId}:${deckId}:${now}`);
}

function publicIdForDeck(deckDoc: Doc<"userDecks">) {
  return (
    deckDoc.publicId ??
    uuidFromString(`public-deck:${deckDoc.userId}:${deckDoc.deckId}:${deckDoc._id}`)
  );
}

function temporaryPublicDeckId(publicId: string) {
  return `public:${publicId}`;
}

async function getPublicDeckDoc(ctx: QueryCtx | MutationCtx, publicId: string) {
  const indexed = await ctx.db
    .query("userDecks")
    .withIndex("by_public_id", (q) => q.eq("publicId", publicId))
    .unique();
  if (indexed) return indexed;

  for await (const deckDoc of ctx.db.query("userDecks")) {
    if (publicIdForDeck(deckDoc) === publicId) return deckDoc;
  }

  return null;
}

async function publicDeckSummaryFromDoc(
  ctx: QueryCtx,
  deckDoc: Doc<"userDecks">,
  matchingCards: PublicDeckPreviewCard[] = [],
  knownDisplayData?: PublicDeckDisplayData
): Promise<PublicDeckSummary> {
  const cards = deckCardRefs(deckDoc);
  const sideboardCards = deckSideboardRefs(deckDoc);
  const maybeboardCards = deckMaybeboardRefs(deckDoc);
  const displayData = knownDisplayData ?? (await publicDeckDisplayData(ctx, deckDoc));

  return {
    publicId: publicIdForDeck(deckDoc),
    name: deckDoc.name,
    format: deckDoc.format,
    cardCount: deckDoc.cardCount ?? countCards(cards),
    sideboardCount: deckDoc.sideboardCount ?? countCards(sideboardCards),
    maybeboardCount:
      deckDoc.maybeboardCount ?? countCards(maybeboardCards),
    createdAt: deckDoc.createdAt,
    updatedAt: deckDoc.updatedAt,
    authorName: anonymousAuthorName(deckDoc.userId),
    viewCount: deckDoc.viewCount ?? 0,
    matchingCards,
    previewCards: displayData.previewCards,
    featuredCardName: displayData.featuredCardName,
    featuredImage: displayData.featuredImage,
    totalPriceUsd: displayData.totalPriceUsd,
    pricedCardCount: displayData.pricedCardCount,
    manaCurve: displayData.manaCurve,
    colorBreakdown: displayData.colorBreakdown,
  };
}

async function publicDeckDisplayData(
  ctx: QueryCtx,
  deckDoc: Doc<"userDecks">
): Promise<PublicDeckDisplayData> {
  const mainRefs = deckCardRefs(deckDoc);
  const refs = {
    cards: mainRefs,
    sideboardCards: deckSideboardRefs(deckDoc),
    maybeboardCards: deckMaybeboardRefs(deckDoc),
  };
  const allRefs = [
    ...refs.cards,
    ...refs.sideboardCards,
    ...refs.maybeboardCards,
  ];
  const allCardsByName = new Map<string, PublicDeckPreviewCard>();
  const manaCurve = [0, 0, 0, 0, 0, 0, 0, 0];
  const colorBreakdown: DeckColorBreakdown = {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
    C: 0,
  };
  let totalPriceUsd = 0;
  let pricedCardCount = 0;
  let featured:
    | {
        name: string;
        image?: string;
        rarityRank: number;
        colorCount: number;
        priceUsd: number;
      }
    | undefined;
  let featuredIsCommander = false;

  for (const ref of allRefs) {
    const cardDoc = await getCardByKey(ctx, ref.cardKey);
    if (!cardDoc) continue;
    const key = normalizeSearchText(cardDoc.name);
    const existing = allCardsByName.get(key);
    if (existing) {
      existing.quantity += ref.quantity;
    } else {
      allCardsByName.set(key, {
        name: cardDoc.name,
        quantity: ref.quantity,
      });
    }

    if (typeof cardDoc.priceUsd === "number") {
      totalPriceUsd += cardDoc.priceUsd * ref.quantity;
      pricedCardCount += ref.quantity;
    }
  }

  for (const ref of mainRefs) {
    const cardDoc = await getCardByKey(ctx, ref.cardKey);
    if (!cardDoc) continue;

    if (!isLandType(cardDoc.typeLine)) {
      const cmc = Math.max(0, Math.round(cardDoc.cmc ?? 0));
      manaCurve[Math.min(7, cmc)] += ref.quantity;
    }

    const colors = cardDoc.colors ?? [];
    if (colors.length === 0) {
      colorBreakdown.C += ref.quantity;
    } else {
      for (const color of colors) {
        if (color in colorBreakdown) {
          colorBreakdown[color as keyof DeckColorBreakdown] += ref.quantity;
        }
      }
    }

    const candidate = {
      name: cardDoc.name,
      image: cardArtImage(cardDoc),
      rarityRank: rarityRank(cardDoc.rarity),
      colorCount: colors.length,
      priceUsd: cardDoc.priceUsd ?? 0,
    };
    if (ref.isCommander) {
      featured = candidate;
      featuredIsCommander = true;
      continue;
    }
    if (
      !featuredIsCommander &&
      (!featured || compareFeaturedCard(candidate, featured) > 0)
    ) {
      featured = candidate;
    }
  }

  const allCards = Array.from(allCardsByName.values());
  return {
    allCards,
    previewCards: allCards.slice(0, PUBLIC_CARD_PREVIEW_LIMIT),
    featuredCardName: featured?.name,
    featuredImage: featured?.image,
    totalPriceUsd: pricedCardCount > 0 ? totalPriceUsd : undefined,
    pricedCardCount,
    manaCurve,
    colorBreakdown,
  };
}

async function deckCardSearchMetadata(
  ctx: MutationCtx,
  refs: DeckRefs
): Promise<{
  cardNames: string[];
  cardSearchText: string;
  previewCardNames: string[];
}> {
  const cardNames = await cardNamesForRefs(ctx, refs);
  return {
    cardNames,
    cardSearchText: cardNames.join("\n"),
    previewCardNames: cardNames.slice(0, PUBLIC_CARD_PREVIEW_LIMIT),
  };
}

async function cardNamesForRefs(
  ctx: QueryCtx | MutationCtx,
  refs: DeckRefs
) {
  const names: string[] = [];
  const seen = new Set<string>();
  const allRefs = [
    ...refs.cards,
    ...refs.sideboardCards,
    ...refs.maybeboardCards,
  ];

  for (const ref of allRefs) {
    const cardDoc = await getCardByKey(ctx, ref.cardKey);
    if (!cardDoc) continue;
    const key = normalizeSearchText(cardDoc.name);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(cardDoc.name);
  }

  return names;
}

function matchingCardPreviews(
  cards: PublicDeckPreviewCard[],
  normalizedQuery: string
) {
  return cards
    .filter((card) => normalizeSearchText(card.name).includes(normalizedQuery))
    .slice(0, PUBLIC_CARD_MATCH_LIMIT);
}

function isLandType(typeLine: string | undefined) {
  return /\bland\b/i.test(typeLine ?? "");
}

function cardArtImage(cardDoc: Doc<"cards">) {
  return (
    cardDoc.imageArtCrop ??
    scryfallArtCropUrl(cardDoc.imageNormal) ??
    scryfallArtCropUrl(cardDoc.imageSmall) ??
    cardDoc.imageNormal ??
    cardDoc.imageSmall
  );
}

function scryfallArtCropUrl(url: string | undefined) {
  if (!url) return undefined;
  if (!url.includes("cards.scryfall.io/")) return undefined;
  return url
    .replace("/normal/", "/art_crop/")
    .replace("/large/", "/art_crop/")
    .replace("/small/", "/art_crop/")
    .replace("/border_crop/", "/art_crop/");
}

function rarityRank(rarity: string | undefined) {
  switch (rarity?.toLowerCase()) {
    case "mythic":
      return 6;
    case "rare":
      return 5;
    case "special":
    case "bonus":
      return 4;
    case "uncommon":
      return 3;
    case "common":
      return 2;
    default:
      return 1;
  }
}

function compareFeaturedCard(
  a: {
    rarityRank: number;
    colorCount: number;
    priceUsd: number;
    name: string;
  },
  b: {
    rarityRank: number;
    colorCount: number;
    priceUsd: number;
    name: string;
  }
) {
  if (a.rarityRank !== b.rarityRank) return a.rarityRank - b.rarityRank;
  if (a.colorCount !== b.colorCount) return a.colorCount - b.colorCount;
  if (a.priceUsd !== b.priceUsd) return a.priceUsd - b.priceUsd;
  return b.name.localeCompare(a.name);
}

function clampPublicDeckLimit(limit: number | undefined) {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_PUBLIC_DECK_LIMIT;
  }
  return Math.min(MAX_PUBLIC_DECK_LIMIT, Math.max(1, Math.floor(limit)));
}

function normalizeSearchText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function anonymousAuthorName(userId: string) {
  const adjectives = [
    "Arcane",
    "Astral",
    "Bold",
    "Bright",
    "Cosmic",
    "Curious",
    "Electric",
    "Golden",
    "Hidden",
    "Infinite",
    "Jubilant",
    "Mystic",
    "Neon",
    "Nimble",
    "Prismatic",
    "Radiant",
    "Sapphire",
    "Secret",
    "Vivid",
    "Wild",
  ];
  const titles = [
    "Adept",
    "Alchemist",
    "Archivist",
    "Artificer",
    "Cartographer",
    "Channeler",
    "Chronomancer",
    "Dreamer",
    "Enchanter",
    "Explorer",
    "Mage",
    "Navigator",
    "Oracle",
    "Pilot",
    "Scholar",
    "Spark",
    "Strategist",
    "Tactician",
    "Voyager",
  ];
  const adjective = adjectives[hashUint32(`${userId}:adjective`) % adjectives.length];
  const title = titles[hashUint32(`${userId}:title`) % titles.length];
  const suffix = 10 + (hashUint32(`${userId}:suffix`) % 90);
  return `${adjective} ${title} ${suffix}`;
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

function deckMaybeboardRefs(deckDoc: Doc<"userDecks">): DeckCardRef[] {
  return (deckDoc.maybeboardCards ?? []).map((card) => ({
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
    maybeboardCards: deckMaybeboardRefs(deckDoc),
  });
}

async function patchDeckRefs(
  ctx: MutationCtx,
  deckDoc: Doc<"userDecks">,
  refs: {
    cards: DeckCardRef[];
    sideboardCards: DeckCardRef[];
    maybeboardCards: DeckCardRef[];
  }
) {
  const normalized = normalizeCardRefs(refs.cards);
  const normalizedSideboard = normalizeCardRefs(refs.sideboardCards, false);
  const normalizedMaybeboard = normalizeCardRefs(refs.maybeboardCards, false);
  const cardMetadata = await deckCardSearchMetadata(ctx, {
    cards: normalized,
    sideboardCards: normalizedSideboard,
    maybeboardCards: normalizedMaybeboard,
  });
  await ctx.db.patch(deckDoc._id, {
    cards: normalized,
    sideboardCards: normalizedSideboard,
    maybeboardCards: normalizedMaybeboard,
    ...cardMetadata,
    cardCount: countCards(normalized),
    sideboardCount: countCards(normalizedSideboard),
    maybeboardCount: countCards(normalizedMaybeboard),
    updatedAt: Date.now(),
  });
}

function deckRefsForZone(
  refs: {
    cards: DeckCardRef[];
    sideboardCards: DeckCardRef[];
    maybeboardCards: DeckCardRef[];
  },
  zone: DeckZone
) {
  if (zone === "sideboard") return refs.sideboardCards;
  if (zone === "maybeboard") return refs.maybeboardCards;
  return refs.cards;
}

function withZoneRefs(
  refs: {
    cards: DeckCardRef[];
    sideboardCards: DeckCardRef[];
    maybeboardCards: DeckCardRef[];
  },
  zone: DeckZone,
  cards: DeckCardRef[]
) {
  if (zone === "sideboard") return { ...refs, sideboardCards: cards };
  if (zone === "maybeboard") return { ...refs, maybeboardCards: cards };
  return { ...refs, cards };
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
  if (cardDoc.imageArtCrop !== undefined) {
    entry.imageArtCrop = cardDoc.imageArtCrop;
  }
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
  if (entry.imageArtCrop !== undefined) doc.imageArtCrop = entry.imageArtCrop;
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
  return asUint24(hashUint32(value) & UINT24_MAX);
}

function hashUint32(value: string) {
  let hash = 0x811c9dc5;

  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash;
}

function uuidFromString(value: string) {
  const words = [
    hashUint32(`${value}:0`),
    hashUint32(`${value}:1`),
    hashUint32(`${value}:2`),
    hashUint32(`${value}:3`),
  ];
  words[1] = (words[1] & 0xffff0fff) | 0x00005000;
  words[2] = (words[2] & 0x3fffffff) | 0x80000000;

  const hex = words.map((word) => word.toString(16).padStart(8, "0"));
  return `${hex[0]}-${hex[1].slice(0, 4)}-${hex[1].slice(4)}-${hex[2].slice(0, 4)}-${hex[2].slice(4)}${hex[3]}`;
}
