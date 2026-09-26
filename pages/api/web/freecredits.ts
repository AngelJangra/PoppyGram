// POST /api/web/freecredits
// Authenticated user endpoint: claim 100 free credits (requires auth_verified=true).
// Requires the signed wa_session cookie to match tg_user_id.
// One claim per user every 24 hours.
import type { NextApiRequest, NextApiResponse } from "next";
import { claimFreeCredits } from "../../../lib/storeFlow";
import { requireWebUser } from "../../../lib/webappAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { tg_user_id } = req.body || {};
    const id = String(tg_user_id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "tg_user_id required" });
    }
    if (!requireWebUser(req, res, id)) return;
    const result = await claimFreeCredits(id);
    if (!result.ok) {
      return res
        .status(400)
        .json({ ok: false, error: result.error, balance: result.balance, nextAt: result.nextAt });
    }
    return res.status(200).json({
      ok: true,
      // Infinite balances are reported as null (Infinity is not valid JSON).
      balance: result.unlimited ? null : Number(result.balance) || 0,
      nextAt: result.nextAt,
      unlimited: result.unlimited,
    });
  } catch (e: any) {
    console.error("[web/freecredits]", e);
    return res.status(500).json({ error: "Internal error" });
  }
}

