import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { drafts } from "@/drizzle/schema";
import { isAuthorized } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.select().from(drafts);
  const out: Record<string, { messages: Array<{ html: string; timestamp: number }>; contactName: string | null; lastModified: number }> = {};
  for (const row of rows) {
    out[row.threadId] = {
      messages: row.messages ?? [],
      contactName: row.contactName ?? null,
      lastModified: row.lastModified ?? 0
    };
  }

  return NextResponse.json({ success: true, drafts: out });
}
