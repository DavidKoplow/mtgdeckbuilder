import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const deckCardRef = v.object({
  cardKey: v.number(),
  quantity: v.number(),
  isCommander: v.optional(v.boolean()),
});

const deckPreviewCard = v.object({
  name: v.string(),
  quantity: v.number(),
});

const deckColorBreakdown = v.object({
  W: v.number(),
  U: v.number(),
  B: v.number(),
  R: v.number(),
  G: v.number(),
  C: v.number(),
});

export default defineSchema({
  userDecks: defineTable({
    userId: v.string(),
    deckId: v.string(),
    publicId: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
    name: v.string(),
    format: v.string(),
    cards: v.optional(v.array(deckCardRef)),
    sideboardCards: v.optional(v.array(deckCardRef)),
    maybeboardCards: v.optional(v.array(deckCardRef)),
    cardNames: v.optional(v.array(v.string())),
    cardSearchText: v.optional(v.string()),
    previewCardNames: v.optional(v.array(v.string())),
    cardCount: v.optional(v.number()),
    sideboardCount: v.optional(v.number()),
    maybeboardCount: v.optional(v.number()),
    publicCards: v.optional(v.array(deckPreviewCard)),
    featuredCardName: v.optional(v.string()),
    featuredImage: v.optional(v.string()),
    totalPriceUsd: v.optional(v.number()),
    pricedCardCount: v.optional(v.number()),
    manaCurve: v.optional(v.array(v.number())),
    colorBreakdown: v.optional(deckColorBreakdown),
    authorName: v.optional(v.string()),
    sourceType: v.optional(v.string()),
    sourceId: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceDeckCode: v.optional(v.string()),
    sourceDeckFileName: v.optional(v.string()),
    sourceDeckType: v.optional(v.string()),
    sourceReleaseDate: v.optional(v.string()),
    sourceUpdatedAt: v.optional(v.number()),
    sourceVersion: v.optional(v.string()),
    sealedProductUuids: v.optional(v.array(v.string())),
    viewCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_deck", ["userId", "deckId"])
    .index("by_public_id", ["publicId"])
    .index("by_source_updated", ["sourceType", "updatedAt"])
    .index("by_updated", ["updatedAt"]),
  cards: defineTable({
    cardKey: v.number(),
    scryfallId: v.string(),
    name: v.string(),
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
    legalities: v.optional(v.record(v.string(), v.string())),
  })
    .index("by_card_key", ["cardKey"])
    .index("by_scryfall_id", ["scryfallId"]),
  cardEmbeddings: defineTable({
    oracleId: v.string(),
    card: v.optional(v.any()),
    embedding: v.array(v.float64()),
    embeddingModel: v.string(),
    embeddingDimensions: v.number(),
    sourceDimensions: v.number(),
    updatedAt: v.number(),
  })
    .index("by_oracle_id", ["oracleId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 4096,
      filterFields: ["oracleId"],
    }),
});
