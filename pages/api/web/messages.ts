// GET /api/web/messages?ticket_id=N
// Returns the conversation thread (user + admin messages) for a support ticket.
// The signed wa_session cookie must match tg_user_id, and the ticket must belong
// to that same Telegram user.
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "../../../lib/db";
import { requireWebUser } from "../../../lib/webappAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const ticketId = String(req.query.ticket_id || "").trim();
    const tgUserId = String(req.query.tg_user_id || "").trim();
    if (!ticketId) return res.status(400).json({ error: "ticket_id required" });
    if (!tgUserId) return res.status(400).json({ error: "tg_user_id required for verification" });
    if (!requireWebUser(req, res, tgUserId)) return;

    // Verify the ticket belongs to this user
    const { data: ticket, error: et } = await db
      .from("support_tickets")
      .select("tg_user_id")
      .eq("id", ticketId)
      .maybeSingle();
    if (et) throw et;
    if (!ticket || String(ticket.tg_user_id) !== tgUserId) {
      return res.status(403).json({ error: "Not your ticket" });
    }

    const { data: messages, error: em } = await db
      .from("support_messages")
      .select("id,sender_role,text,file_id,created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });

    if (em) throw em;

    return res.status(200).json({
      ticket_id: Number(ticketId),
      messages: messages || [],
    });
  } catch (e: any) {
    console.error("[web/messages]", e);
    return res.status(500).json({ error: "Internal error" });
  }
}
