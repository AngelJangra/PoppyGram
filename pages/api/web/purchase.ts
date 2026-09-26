// POST /api/web/purchase
// Authenticated user endpoint: purchase a product as a Telegram user.
// Requires the signed wa_session cookie to match tg_user_id.
// Deducts credits (or sends free for unlimited/owner), records the purchase,
// and delivers the file via the store bot (sendMessage -> sendDocument).
import type { NextApiRequest, NextApiResponse } from "next";
import { purchase } from "../../../lib/storeFlow";
import { requireWebUser } from "../../../lib/webappAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { tg_user_id, product_id, expected_price } = req.body || {};
    const id = String(tg_user_id || "").trim();
    if (!id) {
      return res.status(400).json({ error: "tg_user_id required" });
    }
    if (!requireWebUser(req, res, id)) return;
    const pid = String(product_id || "");
    if (!pid) {
      return res.status(400).json({ error: "product_id required" });
    }

    // Construct a minimal TgUser from the Telegram ID.
    const user = {
      id: Number(id),
      username: "",
      first_name: "",
      last_name: "",
    };

    const result = await purchase(
      user,
      pid,
      expected_price !== undefined && Number.isFinite(Number(expected_price))
        ? Number(expected_price)
        : undefined,
    );

    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    return res.status(200).json({
      ok: true,
      // Infinity serialises to null in JSON, so unlimited accounts report a
      // null balance and clients render the `unlimited` flag instead.
      balance: result.unlimited ? null : Number(result.balance) || 0,
      product: result.product
        ? {
            id: result.product.id,
            name: result.product.name,
            price: Number(result.product.price),
            file_name: result.product.file_name,
          }
        : null,
      unlimited: result.unlimited,
    });
  } catch (e: any) {
    console.error("[web/purchase]", e);
    return res.status(500).json({ error: "Internal error" });
  }
}

