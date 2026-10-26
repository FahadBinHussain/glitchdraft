import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { linkThread, unlinkThread } from "@/lib/people";

export const runtime = "nodejs";

/** POST /api/people/links { personId, threadId } - add a platform identity. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    personId?: string;
    threadId?: string;
  };
  const personId = (body.personId ?? "").trim();
  const threadId = (body.threadId ?? "").trim();
  if (!personId || !threadId) {
    return NextResponse.json(
      { success: false, message: "personId and threadId are required" },
      { status: 400 }
    );
  }

  const result = await linkThread(personId, threadId);
  if (!result.ok) {
    if (result.code === "missing") {
      return NextResponse.json(
        { success: false, message: `no person with id ${personId}` },
        { status: 404 }
      );
    }
    // loud on purpose: a thread belongs to one person, never two
    return NextResponse.json(
      {
        success: false,
        message: `${threadId} is already linked to ${result.personId}`,
        personId: result.personId
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ success: true, person: result.person });
}

/** DELETE /api/people/links?threadId=<id> - unlink one platform identity. */
export async function DELETE(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const threadId = (req.nextUrl.searchParams.get("threadId") ?? "").trim();
  if (!threadId) {
    return NextResponse.json({ success: false, message: "threadId is required" }, { status: 400 });
  }

  return NextResponse.json({ success: true, removed: await unlinkThread(threadId) });
}
