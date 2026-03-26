import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  tasks: defineTable({
    title: v.string(),
    status: v.union(
      v.literal("inbox"),
      v.literal("assigned"),
      v.literal("in-progress"),
      v.literal("review"),
      v.literal("done")
    ),
    assignedTo: v.string(),
    priority: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    createdAt: v.number(),
    updatedAt: v.number(),
    notes: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_assignedTo", ["assignedTo"])
    .index("by_priority", ["priority"]),

  activity: defineTable({
    agentId: v.string(),
    message: v.string(),
    timestamp: v.number(),
    type: v.union(
      v.literal("task"),
      v.literal("alert"),
      v.literal("update"),
      v.literal("error")
    ),
  })
    .index("by_agentId", ["agentId"])
    .index("by_timestamp", ["timestamp"]),

  agents: defineTable({
    id: v.string(),
    name: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("idle"),
      v.literal("thinking"),
      v.literal("error")
    ),
    currentTask: v.optional(v.string()),
    lastSeen: v.number(),
    model: v.string(),
  })
    .index("by_agent_id", ["id"])
    .index("by_status", ["status"]),

  revenue: defineTable({
    amount: v.number(),
    source: v.string(),
    date: v.number(),
    notes: v.optional(v.string()),
  })
    .index("by_date", ["date"]),

  documents: defineTable({
    title: v.string(),
    content: v.string(),
    type: v.union(
      v.literal("research"),
      v.literal("deliverable"),
      v.literal("report")
    ),
    agentId: v.string(),
    createdAt: v.number(),
  })
    .index("by_agentId", ["agentId"])
    .index("by_type", ["type"]),
});
