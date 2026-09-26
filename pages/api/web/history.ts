// GET /api/web/history?id=N
// Authenticated user endpoint: purchase history (joins store_products for names).
// Requires the signed wa_session cookie to match the requested Telegram ID.
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "../../../lib/db";
import { requireWebUser } from "../../../lib/webappAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const tgId = String(req.query.id || "").trim();
    if (!tgId) {
      return res.status(400).json({ error: "Telegram user id required" });
    }
    if (!requireWebUser(req, res, tgId)) return;
    const { data, error } = await db
      .from("store_purchases")
      .select("id,product_id,price,created_at,store_products!inner(name,file_name,price,description)")
      .eq("tg_user_id", tgId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return res.status(200).json({ purchases: data || [] });
  } catch (e: any) {
    console.error("[web/history]", e);
    return res.status(500).json({ error: "Internal error" });
  }
}

