// GET /api/web/photo?id=<telegram_file_id>
// Public proxy: fetches a Telegram file (typically product photos) and streams
// it to the browser. Keeps the bot token server-side.
import type { NextApiRequest, NextApiResponse } from "next";
import { botToken, api as tgApi } from "../../../lib/bot";

export const config = { maxFileSize: 10 * 1024 * 1024 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const fileId = String(req.query.id || "").trim();
  if (!fileId) return res.status(400).json({ error: "file_id required" });
  try {
    const tgFile = await tgApi("getFile", { file_id: fileId });
    const filePath = (tgFile as any)?.file_path;
    if (!filePath) return res.status(404).json({ error: "File not found" });
    const token = botToken();
    const response = await fetch(
      `https://api.telegram.org/file/bot${token}/${filePath}`,
    );
    if (!response.ok) return res.status(404).json({ error: "File not found" });
    const contentType =
      response.headers.get("content-type") || "application/octet-stream";
    const buffer = await response.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, s-maxw=86400");
    res.send(Buffer.from(buffer));
  } catch (e: any) {
    console.error("[web/photo]", e);
    res.status(500).json({ error: "Internal error" });
  }
}

