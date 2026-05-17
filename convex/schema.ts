import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  userDecks: defineTable({
    userId: v.string(),
    deckId: v.string(),
    name: v.string(),
    format: v.string(),
    cards: v.optional(
      v.array(
        v.object({
          cardKey: v.number(),
          quantity: v.number(),
        })
      )
    ),
    cardCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user_deck", ["userId", "deckId"]),
  cards: defineTable({
    cardKey: v.number(),
    scryfallId: v.string(),
    name: v.string(),
    imageSmall: v.optional(v.string()),
    imageNormal: v.optional(v.string()),
    manaCost: v.optional(v.string()),
    cmc: v.optional(v.number()),
    typeLine: v.optional(v.string()),
    colors: v.optional(v.array(v.string())),
    set: v.optional(v.string()),
    collectorNumber: v.optional(v.string()),
    priceUsd: v.optional(v.number()),
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
