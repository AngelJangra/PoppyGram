// POST /api/web/logout
// Clears the webapp session cookie.
import type { NextApiRequest, NextApiResponse } from "next";
import { clearSessionCookie } from "../../../lib/webappAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  clearSessionCookie(res, req);
  return res.status(200).json({ ok: true });
}
