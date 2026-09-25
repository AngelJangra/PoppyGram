// POST /api/web/filerequest
// Public endpoint: submit a file request (user asks for a file not in the store).
// Notifies the user via Telegram after creation.
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "../../../lib/db";
import { sendMessage } from "../../../lib/bot";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { tg_user_id, file_name, description, source_link, username } = req.body || {};
    const id = String(tg_user_id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "tg_user_id required" });
    }
    if (!file_name) {
      return res.status(400).json({ error: "file_name required" });
    }
    const { data, error } = await db
      .from("file_requests")
      .insert({
        tg_user_id: id,
        username: String(username || ""),
        file_name: String(file_name).slice(0, 255),
        description: String(description || "").slice(0, 2000),
        source_link: String(source_link || "").slice(0, 500),
        priority: "normal",
        status: "pending",
      })
      .select("id,status,created_at")
      .single();
    if (error) throw error;

    // Notify the user via Telegram.
    try {
      await sendMessage(
        Number(id),
        `ðŸ“¥ File request #${data.id} submitted.\n\nðŸ“„ ${file_name}\n\nA support manager will review your request and get back to you.`,
      );
    } catch {}

    return res.status(200).json({ ok: true, request: data });
  } catch (e: any) {
    console.error("[web/filerequest]", e);
    return res.status(500).json({ error: "Internal error" });
  }
}

