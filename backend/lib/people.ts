import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { drafts, people, personLinks } from "@/drizzle/schema";

export type DraftPayload = {
  messages: Array<{ html: string; timestamp: number }>;
  contactName: string | null;
  lastModified: number;
};

export type PersonPayload = {
  id: string;
  displayName: string;
  threadIds: string[];
};

export type Suggestion = {
  threadId: string;
  contactName: string | null;
  platform: string;
  score: number;
  preview: string;
  lastModified: number;
};

/**
 * Mirror of sanitizeNameSlug in extension/content.js - the same slug is baked
 * into every thread id, so suggestions compare like for like.
 */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 50);
}

export function platformOf(threadId: string): string {
  return threadId.split("_")[0] || "unknown";
}

/** Platforms whose threads map to a human. Anything else (a form draft on
 * www.example.com, say) is a saved draft, not an identity to link. */
const PERSON_PLATFORMS = new Set(["messenger", "instagram", "telegram", "whatsapp", "discord"]);

/**
 * Threads that are a room, group or channel rather than one person:
 * telegram dialog ids are negative for groups/channels, and a discord guild
 * channel id (discord_<guildId>_<channelId>) is a channel - only @me DMs
 * (discord_com_channels__me_<channelId>) are people.
 */
export function isGroupThread(threadId: string): boolean {
  if (threadId.startsWith("telegram_")) {
    const match = threadId.match(/^telegram_(?:web|android)_(-?\d+)/);
    return Boolean(match && Number(match[1]) < 0);
  }
  return /^discord_\d+_/.test(threadId);
}

function slugFromThreadId(threadId: string): string {
  // <platform>_<web|android>_<numeric>_<slug>  or  <platform>_<slug>
  const parts = threadId.split("_");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function plainText(html: string, max = 70): string {
  const text = html
    .replace(/<img[^>]*>/gi, " [image] ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function previewOf(messages: DraftPayload["messages"]): string {
  const newest = [...messages].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))[0];
  return newest ? plainText(newest.html || "") : "";
}

export async function draftsByIds(threadIds: string[]): Promise<Record<string, DraftPayload>> {
  if (threadIds.length === 0) return {};
  const rows = await db.select().from(drafts).where(inArray(drafts.threadId, threadIds));
  const out: Record<string, DraftPayload> = {};
  for (const row of rows) {
    out[row.threadId] = {
      messages: row.messages ?? [],
      contactName: row.contactName ?? null,
      lastModified: Number(row.lastModified) || 0
    };
  }
  return out;
}

async function personById(personId: string): Promise<PersonPayload | null> {
  const rows = await db.select().from(people).where(eq(people.id, personId)).limit(1);
  const person = rows[0];
  if (!person) return null;
  const links = await db.select().from(personLinks).where(eq(personLinks.personId, personId));
  return {
    id: person.id,
    displayName: person.displayName,
    threadIds: links.map((link) => link.threadId).sort()
  };
}

export async function personForThread(threadId: string): Promise<PersonPayload | null> {
  const link = await db
    .select()
    .from(personLinks)
    .where(eq(personLinks.threadId, threadId))
    .limit(1);
  const row = link[0];
  if (!row) return null;
  return personById(row.personId);
}

export async function listPeople(): Promise<PersonPayload[]> {
  const [peopleRows, linkRows] = await Promise.all([
    db.select().from(people),
    db.select().from(personLinks)
  ]);
  const byPerson = new Map<string, string[]>();
  for (const link of linkRows) {
    const list = byPerson.get(link.personId) ?? [];
    list.push(link.threadId);
    byPerson.set(link.personId, list);
  }
  return peopleRows
    .map((person) => ({
      id: person.id,
      displayName: person.displayName,
      threadIds: (byPerson.get(person.id) ?? []).sort()
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function newPersonId(): string {
  return `p_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export async function createPerson(
  displayName: string,
  threadId: string
): Promise<{ person: PersonPayload; existing: boolean }> {
  const already = await personForThread(threadId);
  if (already) return { person: already, existing: true };

  const id = newPersonId();
  await db.insert(people).values({ id, displayName });
  await db.insert(personLinks).values({ personId: id, threadId });
  return {
    person: { id, displayName, threadIds: [threadId] },
    existing: false
  };
}

export async function linkThread(
  personId: string,
  threadId: string
): Promise<{ ok: true; person: PersonPayload } | { ok: false; code: "missing" | "taken"; personId?: string }> {
  const target = await personById(personId);
  if (!target) return { ok: false, code: "missing" };

  const current = await db
    .select()
    .from(personLinks)
    .where(eq(personLinks.threadId, threadId))
    .limit(1);
  const existing = current[0];
  if (existing && existing.personId !== personId) {
    return { ok: false, code: "taken", personId: existing.personId };
  }
  if (!existing) {
    await db.insert(personLinks).values({ personId, threadId });
  }
  const person = await personById(personId);
  if (!person) return { ok: false, code: "missing" };
  return { ok: true, person };
}

export async function unlinkThread(threadId: string): Promise<boolean> {
  const removed = await db
    .delete(personLinks)
    .where(eq(personLinks.threadId, threadId))
    .returning({ threadId: personLinks.threadId });
  return removed.length > 0;
}

export async function deletePerson(personId: string): Promise<boolean> {
  const removed = await db
    .delete(people)
    .where(eq(people.id, personId))
    .returning({ id: people.id });
  return removed.length > 0;
}

function scoreSlug(targetSlug: string, candidateSlug: string): number {
  if (!targetSlug || !candidateSlug) return 0;
  if (targetSlug === candidateSlug) return 100;
  if (targetSlug.length >= 4 && candidateSlug.length >= 4) {
    if (candidateSlug.includes(targetSlug) || targetSlug.includes(candidateSlug)) return 70;
  }
  const targetTokens = targetSlug.split("_").filter((token) => token.length > 1);
  const candidateTokens = candidateSlug.split("_").filter((token) => token.length > 1);
  if (targetTokens.length === 0 || candidateTokens.length === 0) return 0;
  const shared = targetTokens.filter((token) => candidateTokens.includes(token) && token.length >= 3);
  if (shared.length === 0) return 0;
  const ratio = shared.length / Math.max(targetTokens.length, candidateTokens.length);
  return ratio >= 0.5 ? Math.round(60 * ratio) : 0;
}

/**
 * Candidate threads for the link picker. Returns EVERY unlinked thread (manual
 * linking has to work when the names differ wildly, e.g. "Cat Fren" vs
 * "Fatima Afroz"), with `score` ranking the name-similar ones to the top.
 * Manual confirm only - a score is never written on its own.
 */
export async function candidatesFor(
  threadId: string,
  liveName: string | null
): Promise<Suggestion[]> {
  const [draftRows, linkRows] = await Promise.all([
    db.select().from(drafts),
    db.select().from(personLinks)
  ]);
  const linked = new Set(linkRows.map((row) => row.threadId));
  const current = draftRows.find((row) => row.threadId === threadId);
  const targetName = (liveName || current?.contactName || "").trim() || slugFromThreadId(threadId);
  const targetSlug = slugify(targetName);

  const scored: Suggestion[] = [];
  for (const row of draftRows) {
    if (row.threadId === threadId || linked.has(row.threadId) || isGroupThread(row.threadId)) continue;
    if (!PERSON_PLATFORMS.has(platformOf(row.threadId))) continue;
    const name = (row.contactName || "").trim() || slugFromThreadId(row.threadId);
    const score = scoreSlug(targetSlug, slugify(name));
    const messages = row.messages ?? [];
    scored.push({
      threadId: row.threadId,
      contactName: row.contactName ?? null,
      platform: platformOf(row.threadId),
      score,
      preview: previewOf(messages),
      lastModified: Number(row.lastModified) || 0
    });
  }

  return scored
    .sort((a, b) => b.score - a.score || b.lastModified - a.lastModified)
    .slice(0, 200);
}
