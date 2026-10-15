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
      lastModified: 0,
      exists: false
    });
  }

  return NextResponse.json({
    success: true,
    messages: row.messages ?? [],
    contactName: row.contactName ?? null,
    lastModified: Number(row.lastModified) || 0,
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

  // lastModified drives the cards' "Modified:" line, so only real content
  // changes may bump it. Name-only writes (the contactName lazy back-fill
  // on load, legacy id renames) happen with zero message changes and used
  // to stamp "Modified: today" on untouched drafts.
  const existing = await db.select().from(drafts).where(eq(drafts.threadId, threadId)).limit(1);
  const prev = existing[0];
  const contentChanged = !prev || JSON.stringify(prev.messages ?? []) !== JSON.stringify(messages);
  const lastModified = contentChanged ? now : Number(prev.lastModified) || now;

  await db
    .insert(drafts)
    .values({
      threadId,
      messages,
      contactName,
      lastModified
    })
    .onConflictDoUpdate({
      target: drafts.threadId,
      set: {
        messages,
        contactName,
        lastModified,
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
