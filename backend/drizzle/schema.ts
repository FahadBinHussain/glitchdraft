import { bigint, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const drafts = pgTable("drafts", {
  threadId: text("thread_id").primaryKey(),
  messages: jsonb("messages").$type<Array<{ html: string; timestamp: number }>>().notNull().default([]),
  contactName: text("contact_name"),
  lastModified: bigint("last_modified", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const settings = pgTable("settings", {
  id: text("id").primaryKey(),
  uiPositions: jsonb("ui_positions").$type<Record<string, unknown>>().notNull().default({}),
  appConfig: jsonb("app_config").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
