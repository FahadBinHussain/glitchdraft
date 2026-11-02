import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import {
  candidatesFor,
  createPerson,
  deletePerson,
  draftsByIds,
  linkablePeople,
  listPeople,
  personForThread,
  platformOf
} from "@/lib/people";

export const runtime = "nodejs";

/**
 * GET /api/people                    -> every person + their thread ids
 * GET /api/people?threadId=<id>      -> person for that thread, their drafts,
 *                                       and link-picker suggestions
 * GET /api/people?threadId=<id>&name=<live display name>
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const threadId = req.nextUrl.searchParams.get("threadId");
  if (!threadId) {
    return NextResponse.json({ success: true, people: await listPeople() });
  }

  const person = await personForThread(threadId);
  const drafts = await draftsByIds(person?.threadIds ?? []);
  const candidates = await candidatesFor(threadId, req.nextUrl.searchParams.get("name"));
  const linkable = await linkablePeople(threadId, req.nextUrl.searchParams.get("name"), person);

  return NextResponse.json({
    success: true,
    threadId,
    platform: platformOf(threadId),
    person,
    drafts,
    // scored subset = the name-similarity suggestions; candidates = every
    // unlinked thread so manual linking still works across different names
    suggestions: candidates.filter((candidate) => candidate.score > 0).slice(0, 12),
    candidates,
    // existing people this chat can join ("this chat is that person") - the
    // other direction from candidates, which add a thread to THIS chat's person
    linkablePeople: linkable
  });
}

/** POST /api/people { threadId, displayName? } - create a person from a thread. */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    threadId?: string;
    displayName?: string;
  };
  const threadId = (body.threadId ?? "").trim();
  if (!threadId) {
    return NextResponse.json(
      { success: false, message: "threadId is required" },
      { status: 400 }
    );
  }

  const displayName =
    (body.displayName ?? "").trim() ||
    (await draftsByIds([threadId]))[threadId]?.contactName?.trim() ||
    threadId;
  const result = await createPerson(displayName, threadId);

  return NextResponse.json({
    success: true,
    existing: result.existing,
    person: result.person
  });
}

/** DELETE /api/people?id=<personId> - removes the person and all its links. */
export async function DELETE(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const personId = (req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!personId) {
    return NextResponse.json({ success: false, message: "id is required" }, { status: 400 });
  }

  return NextResponse.json({ success: true, deleted: await deletePerson(personId) });
}
