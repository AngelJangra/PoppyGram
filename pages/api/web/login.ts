// POST /api/web/login
// Verifies Telegram Web Login (tg_user_id + secret code created via /weblogin in bot).
// Sets wa_session cookie on success. Also supports legacy widget fallback if hash provided.
import type { NextApiRequest, NextApiResponse } from "next";
import { createHmac } from "crypto";
import { setSessionCookie } from "../../../lib/webappAuth";
import { verifyWebLoginPass } from "../../../lib/botFlow";
import { db } from "../../../lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { tg_user_id, password, id, first_name, last_name, username, auth_date, hash } = req.body || {};

    // 1. Password-based login (/weblogin bot command)
    if (tg_user_id && password) {
      const uid = String(tg_user_id).trim();
      const code = String(password).trim().toUpperCase();
      if (!/^\d{5,16}$/.test(uid)) {
        return res.status(400).json({ error: "Invalid Telegram ID format" });
      }
      const ok = await verifyWebLoginPass(uid, code);
      if (!ok) {
        return res.status(401).json({ error: "Invalid or expired secret code. Send /weblogin in the Telegram bot to get a fresh code." });
      }

      // Fetch or ensure user profile exists in bot_users
      const { data: userRow } = await db.from("bot_users").select("tg_user_id, username, first_name, last_name").eq("tg_user_id", uid).maybeSingle();

      setSessionCookie(res, uid, req);

      return res.status(200).json({
        ok: true,
        user: {
          id: Number(uid),
          first_name: userRow?.first_name || "",
          last_name: userRow?.last_name || "",
          username: userRow?.username || "",
        },
      });
    }

    // 2. Telegram Login Widget fallback (if still invoked)
    if (id && auth_date && hash) {
      const token = process.env.TG_BOT_TOKEN || "";
      if (!token) throw new Error("TG_BOT_TOKEN not set");
      const secretKey = createHmac("sha256", "WebAppData").update(token).digest();

      const entries = Object.entries({ id, first_name, last_name, username, auth_date })
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${k}=${v}`)
        .join("\n");

      const hmac = createHmac("sha256", secretKey).update(entries).digest("hex");
      if (hmac !== hash) {
        return res.status(401).json({ error: "Invalid Telegram login data" });
      }

      const authTime = Number(auth_date) * 1000;
      if (Date.now() - authTime > 24 * 60 * 60 * 1000) {
        return res.status(401).json({ error: "Login data expired" });
      }

      setSessionCookie(res, String(id), req);

      return res.status(200).json({
        ok: true,
        user: { id: Number(id), first_name, last_name, username },
      });
    }

    return res.status(400).json({ error: "Telegram ID and secret code are required" });
  } catch (e: any) {
    console.error("[web/login]", e);
    return res.status(500).json({ error: "Internal error" });
  }
}

