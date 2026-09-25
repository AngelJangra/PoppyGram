// ---------------------------------------------------------------------------
// Webapp authentication helpers — signed cookie for the user-facing webapp.
// Uses HMAC-SHA256 with the Telegram bot token as the secret (reuse existing
// secret, no new env var needed). The cookie stores the signed Telegram user ID.
// ---------------------------------------------------------------------------
import { createHmac, timingSafeEqual } from "crypto";

const SECRET = process.env.TG_BOT_TOKEN || "poppygram-default-secret";
const COOKIE_NAME = "wa_session";

export function cookieName() {
  return COOKIE_NAME;
}

export function signTgId(tgId: string): string {
  const hmac = createHmac("sha256", SECRET);
  hmac.update(tgId);
  return `${tgId}.${hmac.digest("hex")}`;
}

export function verifyTgId(signed: string | undefined): string | null {
  if (!signed) return null;
  const [tgId, signature] = signed.split(".");
  if (!tgId || !signature) return null;
  const expected = signTgId(tgId);
  const expectedSig = expected.split(".")[1];
  // Constant-time comparison to prevent timing attacks
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return tgId;
}

export function setSessionCookie(res: any, tgId: string) {
  const signed = signTgId(tgId);
  const cookie = `${COOKIE_NAME}=${signed}; HttpOnly; Path=/; Max-Age=31536000; SameSite=Lax`;
  const existing = res.getHeader("Set-Cookie");
  if (existing) {
    const arr = Array.isArray(existing) ? existing : [existing];
    res.setHeader("Set-Cookie", [...arr, cookie]);
  } else {
    res.setHeader("Set-Cookie", cookie);
  }
}

export function clearSessionCookie(res: any) {
  const cookie = `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
  const existing = res.getHeader("Set-Cookie");
  if (existing) {
    const arr = Array.isArray(existing) ? existing : [existing];
    res.setHeader("Set-Cookie", [...arr, cookie]);
  } else {
    res.setHeader("Set-Cookie", cookie);
  }
}
