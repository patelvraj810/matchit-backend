import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// === QUERY FUNCTIONS ===

// List all tasks
export const listTasks = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("tasks").order("desc").take(100);
  },
});

// List tasks by status
export const listTasksByStatus = query({
  args: {
    status: v.union(
      v.literal("inbox"),
      v.literal("assigned"),
      v.literal("in-progress"),
      v.literal("review"),
      v.literal("done")
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .order("desc")
      .take(100);
  },
});

// List tasks by assignee
export const listTasksByAssignee = query({
  args: { assignedTo: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_assignedTo", (q) => q.eq("assignedTo", args.assignedTo))
      .order("desc")
      .take(100);
  },
});

// List all agents
export const listAgents = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("agents").order("desc").take(50);
  },
});

// List recent activities
export const listActivities = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;
    return await ctx.db.query("activity").order("desc").take(limit);
  },
});

// Get agent by ID
export const getAgent = query({
  args: { agentId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agents")
      .withIndex("by_agent_id", (q) => q.eq("id", args.agentId))
      .unique();
  },
});

// Get my tasks - convenience function for agents
export const getMyTasks = query({
  args: { agentId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_assignedTo", (q) => q.eq("assignedTo", args.agentId))
      .filter((q) => q.ne(q.field("status"), "done"))
      .order("desc")
      .take(20);
  },
});

// Get all agents with status
export const getAllAgents = query({
  args: {},
  handler: async (ctx) => {
    const agents = await ctx.db.query("agents").take(20);
    return agents.map(a => ({
      id: a.id,
      name: a.name,
      status: a.status,
      currentTask: a.currentTask,
      lastSeen: a.lastSeen,
      model: a.model
    }));
  },
});

// Get project context
export const getProjectContext = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_type", (q) => q.eq("type", "research"))
      .order("desc")
      .take(5);
    return docs;
  },
});

// Set project context
export const setProjectContext = mutation({
  args: {
    title: v.string(),
    content: v.string(),
    agentId: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("documents", {
      title: args.title,
      content: args.content,
      type: "research",
      agentId: args.agentId,
      createdAt: Date.now(),
    });
    return { id };
  },
});

// === MUTATION FUNCTIONS ===

// Upsert Agent - Update or create agent record
export const upsertAgent = mutation({
  args: {
    agentId: v.string(),
    name: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("idle"),
      v.literal("thinking"),
      v.literal("error")
    ),
    currentTask: v.optional(v.string()),
    model: v.string(),
    role: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agents")
      .withIndex("by_agent_id", (q) => q.eq("id", args.agentId))
      .unique();

    const timestamp = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        status: args.status,
        currentTask: args.currentTask,
        lastSeen: timestamp,
        model: args.model,
      });
      return { id: existing._id, updated: true };
    } else {
      const id = await ctx.db.insert("agents", {
        id: args.agentId,
        name: args.name,
        status: args.status,
        currentTask: args.currentTask,
        lastSeen: timestamp,
        model: args.model,
      });
      return { id, created: true };
    }
  },
});

// Create Task - Add a new task
export const createTask = mutation({
  args: {
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
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const timestamp = Date.now();
    const id = await ctx.db.insert("tasks", {
      title: args.title,
      status: args.status,
      assignedTo: args.assignedTo,
      priority: args.priority,
      createdAt: timestamp,
      updatedAt: timestamp,
      notes: args.notes,
    });
    return { id };
  },
});

// Update Task - Modify existing task
export const updateTask = mutation({
  args: {
    id: v.id("tasks"),
    status: v.optional(
      v.union(
        v.literal("inbox"),
        v.literal("assigned"),
        v.literal("in-progress"),
        v.literal("review"),
        v.literal("done")
      )
    ),
    assignedTo: v.optional(v.string()),
    priority: v.optional(v.union(v.literal("high"), v.literal("medium"), v.literal("low"))),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const updates: any = { updatedAt: Date.now() };
    if (args.status !== undefined) updates.status = args.status;
    if (args.assignedTo !== undefined) updates.assignedTo = args.assignedTo;
    if (args.priority !== undefined) updates.priority = args.priority;
    if (args.notes !== undefined) updates.notes = args.notes;

    await ctx.db.patch(args.id, updates);
    return { updated: true };
  },
});

// Create Activity - Log an activity
export const createActivity = mutation({
  args: {
    agentId: v.string(),
    message: v.string(),
    type: v.union(
      v.literal("task"),
      v.literal("alert"),
      v.literal("update"),
      v.literal("error")
    ),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("activity", {
      agentId: args.agentId,
      message: args.message,
      timestamp: Date.now(),
      type: args.type,
    });
    return { id };
  },
});

// Add Revenue - Log revenue
export const addRevenue = mutation({
  args: {
    amount: v.number(),
    source: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("revenue", {
      amount: args.amount,
      source: args.source,
      date: Date.now(),
      notes: args.notes,
    });
    return { id };
  },
});
