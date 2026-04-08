CREATE TABLE IF NOT EXISTS "drafts" (
  "thread_id" text PRIMARY KEY NOT NULL,
  "messages" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "contact_name" text,
  "last_modified" bigint NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "settings" (
  "id" text PRIMARY KEY NOT NULL,
  "ui_positions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "app_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
