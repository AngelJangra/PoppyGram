// GET /api/web/user?id=N
// Public endpoint: user balance, profile, and free-credits eligibility.
import type { NextApiRequest, NextApiResponse } from "next";
import { getBalance, freeCreditsStatus } from "../../../lib/storeFlow";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const tgId = String(req.query.id || "").trim();
    if (!tgId) {
      return res.status(400).json({ error: "Telegram user id required" });
    }
    const balance = await getBalance(tgId);
    const status = await freeCreditsStatus(tgId);
    const now = Date.now();
    const claimedAt = status?.free_credits_claimed_at
      ? new Date(status.free_credits_claimed_at).getTime()
      : 0;
    const canClaim =
      Boolean(status?.auth_verified) &&
      !Boolean(status?.unlimited) &&
      now - claimedAt > 24 * 60 * 60 * 1000;
    return res.status(200).json({
      tg_user_id: tgId,
      username: status?.username || "",
      first_name: status?.first_name || "",
      last_name: status?.last_name || "",
      credit: status?.unlimited ? Infinity : Number(balance),
      auth_verified: Boolean(status?.auth_verified),
      unlimited: Boolean(status?.unlimited),
      can_claim_freecredits: canClaim,
      free_credits_claimed_at: status?.free_credits_claimed_at || null,
    });
  } catch (e: any) {
    console.error("[web/user]", e);
    return res.status(500).json({ error: "Internal error" });
  }
}

