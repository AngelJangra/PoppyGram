// GET /api/web/session
// Returns the current authenticated user (from wa_session cookie) and the
// bot's username (needed by the client to link to the bot for /weblogin).
// If no session, user is null but bot_username is still returned.
import type { NextApiRequest, NextApiResponse } from "next";
import { verifyTgId } from "../../../lib/webappAuth";
import { getMe } from "../../../lib/bot";
import { getBalance, freeCreditsStatus } from "../../../lib/storeFlow";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    // Bot username for the login screen (t.me/<bot> link + /weblogin instructions)
    let botUsername = "";
    try {
      const me = await getMe();
      botUsername = me.username || "";
    } catch (e) {
      console.error("[web/session] getMe failed", e);
    }

    const signed = req.cookies.wa_session;
    const tgId = verifyTgId(signed);

    if (!tgId) {
      return res.status(200).json({ user: null, bot_username: botUsername });
    }

    // Fetch user data
    const [balance, status] = await Promise.all([
      getBalance(tgId),
      freeCreditsStatus(tgId),
    ]);

    const now = Date.now();
    const claimedAt = status?.free_credits_claimed_at
      ? new Date(status.free_credits_claimed_at as any).getTime()
      : 0;
    const canClaim =
      Boolean(status?.auth_verified) &&
      !Boolean(status?.unlimited) &&
      now - claimedAt > 24 * 60 * 60 * 1000;

    const user = {
      tg_user_id: tgId,
      username: status?.username || "",
      first_name: status?.first_name || "",
      last_name: status?.last_name || "",
      credit: status?.unlimited ? Infinity : Number(balance),
      auth_verified: Boolean(status?.auth_verified),
      unlimited: Boolean(status?.unlimited),
      can_claim_freecredits: canClaim,
    };

    return res.status(200).json({ user, bot_username: botUsername });
  } catch (e: any) {
    console.error("[web/session]", e);
    return res.status(500).json({ error: "Internal error" });
  }
}
