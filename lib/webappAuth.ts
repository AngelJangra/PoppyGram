// ---------------------------------------------------------------------------
// Webapp authentication helpers — signed cookie for the user-facing webapp.
// Uses HMAC-SHA256 with the Telegram bot token as the secret (reuse existing
// secret, no new env var needed). The cookie stores the signed Telegram user ID.
// ---------------------------------------------------------------------------
import { createHmac, timingSafeEqual } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";

const COOKIE_NAME = "wa_session";

// The signing secret must never silently fall back to a guessable default:
// a known secret lets anyone forge a wa_session cookie for any Telegram ID.
function secret(): string {
  const value = process.env.TG_BOT_TOKEN || "";
  if (!value) throw new Error("TG_BOT_TOKEN is not configured");
  return value;
}

function secureCookie(req?: NextApiRequest): string {
  const proto = req?.headers?.["x-forwarded-proto"];
  const isHttps = proto === "https" || process.env.NODE_ENV === "production";
  return isHttps ? "; Secure" : "";
}

export function cookieName() {
  return COOKIE_NAME;
}

export function signTgId(tgId: string): string {
  const hmac = createHmac("sha256", secret());
  hmac.update(tgId);
  return `${tgId}.${hmac.digest("hex")}`;
}

export function verifyTgId(signed: string | undefined): string | null {
  if (!signed) return null;
  const [tgId, signature] = signed.split(".");
  if (!tgId || !signature) return null;
  // A valid cookie only ever contains a numeric Telegram ID.
  if (!/^\d{5,16}$/.test(tgId)) return null;
  const expected = signTgId(tgId);
  const expectedSig = expected.split(".")[1];
  // Constant-time comparison to prevent timing attacks
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return tgId;
}

// The Telegram ID carried by a request's signed session cookie (or null).
export function sessionTgId(req: NextApiRequest): string | null {
  try {
    return verifyTgId(req.cookies?.[COOKIE_NAME]);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Guard for every user-facing data endpoint.
//
// These routes are allow-listed in middleware.ts (Telegram users are not site
// admins), so the signed wa_session cookie is the ONLY thing that proves who is
// calling. Without this check any anonymous request could pass someone else's
// tg_user_id and read their tickets or spend their credits.
// ---------------------------------------------------------------------------
export function requireWebUser(
  req: NextApiRequest,
  res: NextApiResponse,
  claimedTgId: string | number,
): boolean {
  const session = sessionTgId(req);
  const claimed = String(claimedTgId || "").trim();
  if (!session) {
    res.status(401).json({ error: "Please log in with Telegram first." });
    return false;
  }
  if (!claimed || session !== claimed) {
    res.status(403).json({ error: "This session does not belong to that Telegram account." });
    return false;
  }
  return true;
}

export function setSessionCookie(res: any, tgId: string, req?: NextApiRequest) {
  const signed = signTgId(tgId);
  const cookie = `${COOKIE_NAME}=${signed}; HttpOnly; Path=/; Max-Age=31536000; SameSite=Lax${secureCookie(req)}`;
  const existing = res.getHeader("Set-Cookie");
  if (existing) {
    const arr = Array.isArray(existing) ? existing : [existing];
    res.setHeader("Set-Cookie", [...arr, cookie]);
  } else {
    res.setHeader("Set-Cookie", cookie);
  }
}

export function clearSessionCookie(res: any, req?: NextApiRequest) {
  const cookie = `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secureCookie(req)}`;
  const existing = res.getHeader("Set-Cookie");
  if (existing) {
    const arr = Array.isArray(existing) ? existing : [existing];
    res.setHeader("Set-Cookie", [...arr, cookie]);
  } else {
    res.setHeader("Set-Cookie", cookie);
  }
}

