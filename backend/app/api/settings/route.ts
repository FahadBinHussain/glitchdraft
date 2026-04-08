import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { settings } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { isAuthorized } from "@/lib/auth";

export const runtime = "nodejs";

const SETTINGS_ID = "user";

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).limit(1);
  const row = rows[0];

  if (!row) {
    return NextResponse.json({
      success: true,
      settings: { uiPositions: {}, appConfig: {} }
    });
  }

  return NextResponse.json({
    success: true,
    settings: {
      uiPositions: row.uiPositions ?? {},
      appConfig: row.appConfig ?? {}
    }
  });
}

export async function PUT(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    uiPositions?: Record<string, unknown>;
    appConfig?: Record<string, unknown>;
  };
  const existing = await db
    .select()
    .from(settings)
    .where(eq(settings.id, SETTINGS_ID))
    .limit(1);
  const current = existing[0];

  // Merge semantics: if caller omits a field, keep existing value.
  const uiPositions = body.uiPositions ?? current?.uiPositions ?? {};
  const appConfig = body.appConfig ?? current?.appConfig ?? {};

  await db
    .insert(settings)
    .values({
      id: SETTINGS_ID,
      uiPositions,
      appConfig
    })
    .onConflictDoUpdate({
      target: settings.id,
      set: {
        uiPositions,
        appConfig,
        updatedAt: new Date()
      }
    });

  return NextResponse.json({ success: true });
}
