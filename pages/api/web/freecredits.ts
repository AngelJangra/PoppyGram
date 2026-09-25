// POST /api/web/freecredits
// Public endpoint: claim 100 free credits (requires auth_verified=true).
// One claim per user every 24 hours.
import type { NextApiRequest, NextApiResponse } from "next";
import { claimFreeCredits } from "../../../lib/storeFlow";

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
    const result = await claimFreeCredits(id);
    if (!result.ok) {
      return res
        .status(400)
        .json({ ok: false, error: result.error, balance: result.balance, nextAt: result.nextAt });
    }
    return res.status(200).json({
      ok: true,
      balance: result.balance,
      nextAt: result.nextAt,
      unlimited: result.unlimited,
    });
  } catch (e: any) {
    console.error("[web/freecredits]", e);
    return res.status(500).json({ error: "Internal error" });
  }
}

