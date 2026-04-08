import { NextRequest } from "next/server";

export function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.API_KEY;
  if (!expected) return true;

  const provided =
    req.headers.get("x-api-key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  return provided === expected;
}
