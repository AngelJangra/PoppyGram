// GET /api/web/faq
// Public endpoint: returns the support FAQ from the settings table, with
// a hardcoded fallback (same logic as pages/api/support.ts -> getFaq).
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "../../../lib/db";
import { PROJECT_NAME, GITHUB_USERNAME } from "../../../lib/credits";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const { data } = await db
      .from("settings")
      .select("value")
      .eq("key", "support_faq")
      .maybeSingle();
    let faq: Record<string, string> = {};
    if (data?.value) {
      try {
        faq = JSON.parse(data.value);
      } catch {}
    }
    if (!Object.keys(faq).length) {
      faq = {
        "Payment or credit problems":
          "Use /balance to check your credits, then /store to browse files. Credits are deducted at purchase.",
        "Files that will not open or download":
          "Purchased files are delivered by the bot directly. If download fails, tell support your Telegram ID and the product name.",
        "Account authentication problems":
          "Run /auth in the main PoppyGram bot, open the verification link, and complete the login in your browser.",
        "Report a bug or a missing product":
          "Use the Support webapp or send /support to describe the issue.",
        "How do I contact support?":
          "Open @poppygramsupportbot in Telegram or use the Support webapp.",
      };
    }
    return res.status(200).json({
      faq,
      project: PROJECT_NAME,
      github: GITHUB_USERNAME,
    });
  } catch (e: any) {
    console.error("[web/faq]", e);
    return res.status(500).json({ error: "Internal error" });
  }
}

