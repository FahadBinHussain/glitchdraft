import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { drafts } from "@/drizzle/schema";
import { isAuthorized } from "@/lib/auth";

export const runtime = "nodejs";

type Row = {
  threadId: string;
  contactName: string | null;
  lastModified: number | null;
  messages?: Array<{ html: string; timestamp: number }>;
};

/**
 * GET /api/drafts        -> every draft, messages included (the import UI needs them)
 * GET /api/drafts?meta=1 -> threadId + contactName + lastModified only.
 *
 * The meta form exists purely for the slug-pickers: both clients rank rows by
 * id / contactName / lastModified and never read `messages`, but `messages`
 * carries every base64-embedded image, so the full list was shipping ~1 MB of
 * photos on every 10s sync tick and burned the Neon free-plan egress quota.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const metaOnly = req.nextUrl.searchParams.get("meta") === "1";

  const rows: Row[] = metaOnly
    ? await db
        .select({
          threadId: drafts.threadId,
          contactName: drafts.contactName,
          lastModified: drafts.lastModified
        })
        .from(drafts)
    : await db.select().from(drafts);

  const out: Record<string, Row> = {};
  for (const row of rows) {
    const entry: Row = {
      threadId: row.threadId,
      contactName: row.contactName ?? null,
      lastModified: row.lastModified ?? 0
    };
    if (!metaOnly) entry.messages = row.messages ?? [];
    out[row.threadId] = entry;
  }

  return NextResponse.json({ success: true, drafts: out });
}