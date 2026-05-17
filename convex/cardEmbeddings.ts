import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const MAX_SEED_CARDS = 8;
const DEFAULT_LIMIT = 32;
const VECTOR_LIMIT = 256;
const MAX_VECTOR_FILTER_CONDITIONS = 64;
const EMBEDDING_DIMENSIONS = 4096;
const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
const OPENROUTER_EMBEDDING_MODEL = "qwen/qwen3-embedding-8b";
const SEMANTIC_QUERY_PREFIX =
  "Instruct: Given a natural language Magic: The Gathering card search query, " +
  "retrieve cards with relevant names, colors, rules text, keywords, power, " +
  "toughness, or loyalty.\nQuery: ";

type SimilarCardMatch = {
  oracle_id: string;
  similarity: number;
};

type SeedEmbedding = {
  oracleId: string;
  embedding: number[];
};

type EmbeddingRef = {
  _id: Id<"cardEmbeddings">;
  oracleId: string;
};

type VectorSearchMatch = {
  _id: Id<"cardEmbeddings">;
  _score: number;
};

export const similarCards = action({
  args: {
    oracleIds: v.array(v.string()),
    candidateOracleIds: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      oracle_id: v.string(),
      similarity: v.number(),
    })
  ),
  handler: async (ctx, args): Promise<SimilarCardMatch[]> => {
    const oracleIds = uniqueOracleIds(args.oracleIds).slice(0, MAX_SEED_CARDS);
    if (oracleIds.length === 0) return [];
    const candidateOracleIds = args.candidateOracleIds
      ? uniqueOracleIds(args.candidateOracleIds)
      : undefined;
    if (args.candidateOracleIds && candidateOracleIds?.length === 0) return [];

    const seeds = await ctx.runQuery(internal.cardEmbeddings.byOracleIds, {
      oracleIds,
    });
    if (seeds.length === 0) return [];

    const seedMatches = seeds
      .filter(
        (seed) => !candidateOracleIds || candidateOracleIds.includes(seed.oracleId)
      )
      .map((seed) => ({
        oracle_id: seed.oracleId,
        similarity: 1,
      }));
    if (args.candidateOracleIds && seedMatches.length === 0) return [];

    const queryVector = normalize(sumVectors(seeds.map((seed) => seed.embedding)));
    if (queryVector.length === 0) return seedMatches;

    const limit = clampLimit(args.limit ?? DEFAULT_LIMIT);
    const seedOracleIds = seedMatches.map((match) => match.oracle_id);
    const matches = await searchEmbeddingRefs(ctx, {
      vector: queryVector,
      limit,
      candidateOracleIds,
      excludeOracleIds: seedOracleIds,
    });

    const docs = await ctx.runQuery(internal.cardEmbeddings.byIds, {
      ids: matches.map((match) => match._id),
    });
    const docsById = new Map(docs.map((doc) => [doc._id, doc]));
    const cards: SimilarCardMatch[] = seedMatches.slice(0, limit);

    for (const match of matches) {
      const doc = docsById.get(match._id);
      if (!doc) continue;
      cards.push({
        oracle_id: doc.oracleId,
        similarity: match._score,
      });
      if (cards.length >= limit) break;
    }

    return cards;
  },
});

export const semanticCards = action({
  args: {
    query: v.string(),
    candidateOracleIds: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      oracle_id: v.string(),
      similarity: v.number(),
    })
  ),
  handler: async (ctx, args): Promise<SimilarCardMatch[]> => {
    const query = args.query.trim();
    if (!query) return [];

    const candidateOracleIds = args.candidateOracleIds
      ? uniqueOracleIds(args.candidateOracleIds)
      : undefined;
    if (args.candidateOracleIds && candidateOracleIds?.length === 0) return [];

    const queryVector = await embedSemanticQuery(query);
    const limit = clampLimit(args.limit ?? DEFAULT_LIMIT);
    const matches = await searchEmbeddingRefs(ctx, {
      vector: queryVector,
      limit,
      candidateOracleIds,
    });

    const docs = await ctx.runQuery(internal.cardEmbeddings.byIds, {
      ids: matches.map((match) => match._id),
    });
    const docsById = new Map(docs.map((doc) => [doc._id, doc]));
    const cards: SimilarCardMatch[] = [];

    for (const match of matches) {
      const doc = docsById.get(match._id);
      if (!doc) continue;
      cards.push({
        oracle_id: doc.oracleId,
        similarity: match._score,
      });
      if (cards.length >= limit) break;
    }

    return cards;
  },
});

export const hybridCards = action({
  args: {
    query: v.optional(v.string()),
    oracleIds: v.array(v.string()),
    candidateOracleIds: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      oracle_id: v.string(),
      similarity: v.number(),
    })
  ),
  handler: async (ctx, args): Promise<SimilarCardMatch[]> => {
    const query = args.query?.trim() ?? "";
    const oracleIds = uniqueOracleIds(args.oracleIds).slice(0, MAX_SEED_CARDS);
    if (!query && oracleIds.length === 0) return [];

    const candidateOracleIds = args.candidateOracleIds
      ? uniqueOracleIds(args.candidateOracleIds)
      : undefined;
    if (args.candidateOracleIds && candidateOracleIds?.length === 0) return [];

    const vectors: number[][] = [];
    if (query) {
      vectors.push(await embedSemanticQuery(query));
    }

    const seeds =
      oracleIds.length > 0
        ? await ctx.runQuery(internal.cardEmbeddings.byOracleIds, {
            oracleIds,
          })
        : [];
    vectors.push(...seeds.map((seed) => seed.embedding));

    const seedMatches = seeds
      .filter(
        (seed) => !candidateOracleIds || candidateOracleIds.includes(seed.oracleId)
      )
      .map((seed) => ({
        oracle_id: seed.oracleId,
        similarity: 1,
      }));
    if (!query && args.candidateOracleIds && seedMatches.length === 0) return [];

    const queryVector = normalize(sumVectors(vectors));
    const limit = clampLimit(args.limit ?? DEFAULT_LIMIT);
    if (queryVector.length === 0) return seedMatches.slice(0, limit);

    const seedOracleIds = seedMatches.map((match) => match.oracle_id);
    const matches = await searchEmbeddingRefs(ctx, {
      vector: queryVector,
      limit,
      candidateOracleIds,
      excludeOracleIds: seedOracleIds,
    });

    const docs = await ctx.runQuery(internal.cardEmbeddings.byIds, {
      ids: matches.map((match) => match._id),
    });
    const docsById = new Map(docs.map((doc) => [doc._id, doc]));
    const cards: SimilarCardMatch[] = seedMatches.slice(0, limit);

    for (const match of matches) {
      const doc = docsById.get(match._id);
      if (!doc) continue;
      cards.push({
        oracle_id: doc.oracleId,
        similarity: match._score,
      });
      if (cards.length >= limit) break;
    }

    return cards;
  },
});

export const byOracleIds = internalQuery({
  args: {
    oracleIds: v.array(v.string()),
  },
  returns: v.array(
    v.object({
      oracleId: v.string(),
      embedding: v.array(v.float64()),
    })
  ),
  handler: async (ctx, args): Promise<SeedEmbedding[]> => {
    const docs: SeedEmbedding[] = [];

    for (const oracleId of uniqueOracleIds(args.oracleIds)) {
      const doc = await ctx.db
        .query("cardEmbeddings")
        .withIndex("by_oracle_id", (q) => q.eq("oracleId", oracleId))
        .unique();
      if (doc) {
        docs.push({
          oracleId: doc.oracleId,
          embedding: doc.embedding,
        });
      }
    }

    return docs;
  },
});

export const byIds = internalQuery({
  args: {
    ids: v.array(v.id("cardEmbeddings")),
  },
  returns: v.array(
    v.object({
      _id: v.id("cardEmbeddings"),
      oracleId: v.string(),
    })
  ),
  handler: async (ctx, args): Promise<EmbeddingRef[]> => {
    const docs: EmbeddingRef[] = [];

    for (const id of args.ids) {
      const doc = await ctx.db.get(id);
      if (doc) {
        docs.push({
          _id: doc._id,
          oracleId: doc.oracleId,
        });
      }
    }

    return docs;
  },
});

function uniqueOracleIds(oracleIds: string[]): string[] {
  return Array.from(
    new Set(
      oracleIds
        .map((oracleId) => oracleId.trim())
        .filter((oracleId) => oracleId.length > 0)
    )
  );
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(DEFAULT_LIMIT, Math.floor(limit)));
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function searchEmbeddingRefs(
  ctx: ActionCtx,
  {
    vector,
    limit,
    candidateOracleIds,
    excludeOracleIds = [],
  }: {
    vector: number[];
    limit: number;
    candidateOracleIds?: string[];
    excludeOracleIds?: string[];
  }
): Promise<VectorSearchMatch[]> {
  const vectorLimit = Math.min(VECTOR_LIMIT, limit + excludeOracleIds.length + 16);
  const matchBatches = candidateOracleIds
    ? await Promise.all(
        chunk(candidateOracleIds, MAX_VECTOR_FILTER_CONDITIONS).map(
          (oracleIdChunk) =>
            ctx.vectorSearch("cardEmbeddings", "by_embedding", {
              vector,
              limit: Math.min(vectorLimit, oracleIdChunk.length),
              filter: (q) =>
                oracleIdChunk.length === 1
                  ? q.eq("oracleId", oracleIdChunk[0])
                  : q.or(
                      ...oracleIdChunk.map((oracleId) =>
                        q.eq("oracleId", oracleId)
                      )
                    ),
            })
        )
      )
    : [
        await ctx.vectorSearch("cardEmbeddings", "by_embedding", {
          vector,
          limit: vectorLimit,
        }),
      ];

  const excluded = new Set(excludeOracleIds);
  const bestById = new Map<Id<"cardEmbeddings">, VectorSearchMatch>();
  for (const match of matchBatches.flat()) {
    const existing = bestById.get(match._id);
    if (!existing || match._score > existing._score) {
      bestById.set(match._id, match);
    }
  }

  const matches = Array.from(bestById.values()).sort(
    (a, b) => b._score - a._score
  );
  if (excluded.size === 0) return matches.slice(0, vectorLimit);

  const docs = await ctx.runQuery(internal.cardEmbeddings.byIds, {
    ids: matches.map((match) => match._id),
  });
  const docsById = new Map(docs.map((doc) => [doc._id, doc]));
  return matches
    .filter((match) => {
      const doc = docsById.get(match._id);
      return doc && !excluded.has(doc.oracleId);
    })
    .slice(0, vectorLimit);
}

async function embedSemanticQuery(query: string): Promise<number[]> {
  const [embedding] = await embedSemanticQueries([query]);
  return embedding ?? [];
}

async function embedSemanticQueries(queries: string[]): Promise<number[][]> {
  const inputs = queries
    .map((query) => query.trim())
    .filter((query) => query.length > 0)
    .map((query) => `${SEMANTIC_QUERY_PREFIX}${query}`);
  if (inputs.length === 0) return [];

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured in Convex.");
  }

  const response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER ?? "",
      "X-Title": process.env.OPENROUTER_APP_TITLE ?? "MTG Deck Builder",
    },
    body: JSON.stringify({
      input: inputs,
      input_type: "search_query",
      model: OPENROUTER_EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      encoding_format: "float",
    }),
  });
  const body = (await response.json().catch(() => null)) as
    | {
        data?: Array<{ embedding?: unknown; index?: number }>;
        error?: { message?: string } | string;
      }
    | null;

  if (!response.ok) {
    const message =
      typeof body?.error === "string"
        ? body.error
        : body?.error?.message ?? `OpenRouter embeddings failed ${response.status}`;
    throw new Error(message);
  }

  if (!Array.isArray(body?.data) || body.data.length !== inputs.length) {
    throw new Error("OpenRouter did not return an embedding vector.");
  }

  const data = [...body.data].sort(
    (a, b) => Number(a.index ?? 0) - Number(b.index ?? 0)
  );
  return data.map((item) => parseEmbedding(item.embedding));
}

function parseEmbedding(embedding: unknown): number[] {
  if (!Array.isArray(embedding)) {
    throw new Error("OpenRouter did not return an embedding vector.");
  }
  const vector = embedding.map((value) => Number(value));
  if (
    vector.length !== EMBEDDING_DIMENSIONS ||
    vector.some((value) => !Number.isFinite(value))
  ) {
    throw new Error(
      `OpenRouter returned an invalid ${vector.length}-dimensional embedding.`
    );
  }

  return normalize(vector);
}

function sumVectors(vectors: number[][]): number[] {
  const first = vectors[0];
  if (!first) return [];

  const sum = new Array(first.length).fill(0) as number[];
  for (const vector of vectors) {
    for (let i = 0; i < sum.length; i += 1) {
      sum[i] += vector[i] ?? 0;
    }
  }
  return sum;
}

function normalize(vector: number[]): number[] {
  let magnitude = 0;
  for (const value of vector) {
    magnitude += value * value;
  }
  magnitude = Math.sqrt(magnitude);
  if (magnitude === 0) return [];
  return vector.map((value) => value / magnitude);
}
