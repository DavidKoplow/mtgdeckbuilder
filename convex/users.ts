import { v } from "convex/values";
import { query } from "./_generated/server";

export const viewer = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      id: v.string(),
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      image: v.optional(v.string()),
    })
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) return null;

    return {
      id: identity.subject,
      name: identity.name,
      email: identity.email,
      image: identity.pictureUrl,
    };
  },
});
