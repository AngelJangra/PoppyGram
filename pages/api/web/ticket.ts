// GET  /api/web/ticket?id=N    — list a user's support tickets
// POST /api/web/ticket          — create a new support ticket (with optional first message)
// Authenticated endpoint: identifies users by their Telegram user_id, which must
// match the signed wa_session cookie set by /api/web/login.
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "../../../lib/db";
import { sendMessage } from "../../../lib/bot";
import { requireWebUser } from "../../../lib/webappAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "GET") {
    const tgId = String(req.query.id || "").trim();
    if (!tgId) {
      return res.status(400).json({ error: "Telegram user id required" });
    }
    if (!requireWebUser(req, res, tgId)) return;
    const { data, error } = await db
      .from("support_tickets")
      .select("id,kind,subject,status,assigned_to,tg_user_id,username,priority,created_at,updated_at")
      .eq("tg_user_id", tgId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return res.status(200).json({ tickets: data || [] });
  }

  if (req.method === "POST") {
    const { tg_user_id, subject, message, username } = req.body || {};
    const id = String(tg_user_id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "tg_user_id required" });
    }
    if (!subject) {
      return res.status(400).json({ error: "subject required" });
    }
    if (!requireWebUser(req, res, id)) return;
    const { data, error } = await db
      .from("support_tickets")
      .insert({
        kind: "general",
        subject: String(subject).slice(0, 200),
        status: "open",
        tg_user_id: id,
        username: String(username || ""),
        priority: "normal",
      })
      .select("id,status,created_at")
      .single();
    if (error) throw error;

    if (message) {
      await db
        .from("support_messages")
        .insert({
          ticket_id: data.id,
          sender_role: "user",
          text: String(message).slice(0, 5000),
        });
    }

    // Notify the user via the support bot that their ticket was created.
    try {
      await sendMessage(
        Number(id),
        `🆕 A new support ticket has been created from the web.\n\n📋 Ticket #${data.id}: ${subject}\n\nA support manager will reply shortly.`,
      );
    } catch {}

    return res.status(200).json({ ok: true, ticket: data });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

