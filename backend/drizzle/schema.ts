import { bigint, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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

/**
 * A person groups one thread per platform (messenger / instagram / telegram /
 * whatsapp / discord). Links are manual + confirmed, never inferred at write
 * time: names collide across platforms, so a wrong merge would show someone
 * else's drafts.
 */
export const people = pgTable("people", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

/** thread_id is the primary key: a thread can belong to at most one person. */
export const personLinks = pgTable(
  "person_links",
  {
    threadId: text("thread_id").primaryKey(),
    personId: text("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("person_links_person_id_idx").on(table.personId)]
);
