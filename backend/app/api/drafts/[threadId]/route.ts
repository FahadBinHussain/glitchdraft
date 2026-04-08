import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { drafts } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { isAuthorized } from "@/lib/auth";

export const runtime = "nodejs";

type DraftMessage = { html: string; timestamp: number };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const { threadId } = await params;
  const rows = await db.select().from(drafts).where(eq(drafts.threadId, threadId)).limit(1);
  const row = rows[0];

  if (!row) {
    return NextResponse.json({
      success: true,
      messages: [],
      contactName: null,
      exists: false
    });
  }

  return NextResponse.json({
    success: true,
    messages: row.messages ?? [],
    contactName: row.contactName ?? null,
    exists: true
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const { threadId } = await params;
  const body = (await req.json()) as {
    messages?: DraftMessage[];
    contactName?: string | null;
  };

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const contactName = body.contactName ?? null;
  const now = Date.now();

  await db
    .insert(drafts)
    .values({
      threadId,
      messages,
      contactName,
      lastModified: now
    })
    .onConflictDoUpdate({
      target: drafts.threadId,
      set: {
        messages,
        contactName,
        lastModified: now,
        updatedAt: new Date()
      }
    });

  return NextResponse.json({ success: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const { threadId } = await params;
  await db.delete(drafts).where(eq(drafts.threadId, threadId));
  return NextResponse.json({ success: true });
}
