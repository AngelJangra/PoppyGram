// POST /api/web/login
// Verifies Telegram Login Widget data and sets a session cookie.
// The client sends the widget's user object; we verify the hash using
// the bot token (Telegram's official verification method).
import type { NextApiRequest, NextApiResponse } from "next";
import { createHmac } from "crypto";
import { setSessionCookie } from "../../../lib/webappAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { id, first_name, last_name, username, auth_date, hash } = req.body || {};
    if (!id || !auth_date || !hash) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Telegram verification: secret_key = SHA256(bot_token, "WebAppData")
    const token = process.env.TG_BOT_TOKEN || "";
    if (!token) throw new Error("TG_BOT_TOKEN not set");
    const secretKey = createHmac("sha256", "WebAppData").update(token).digest();

    // Build check string: all fields sorted alphabetically, "key=value\n..."
    const entries = Object.entries({ id, first_name, last_name, username, auth_date })
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    const hmac = createHmac("sha256", secretKey).update(entries).digest("hex");
    if (hmac !== hash) {
      return res.status(401).json({ error: "Invalid Telegram login data" });
    }

    // Check auth_date (not older than 24 hours)
    const authTime = Number(auth_date) * 1000;
    if (Date.now() - authTime > 24 * 60 * 60 * 1000) {
      return res.status(401).json({ error: "Login data expired" });
    }

    // Set signed cookie
    setSessionCookie(res, String(id));

    return res.status(200).json({
      ok: true,
      user: { id: Number(id), first_name, last_name, username },
    });
  } catch (e: any) {
    console.error("[web/login]", e);
    return res.status(500).json({ error: "Internal error" });
  }
}
