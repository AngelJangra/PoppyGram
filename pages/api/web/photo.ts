// GET /api/web/photo?id=<telegram_file_id>
// Public proxy: fetches a Telegram file (typically product photos) and streams
// it to the browser. Keeps the bot token server-side.
import type { NextApiRequest, NextApiResponse } from "next";
import { botToken, api as tgApi } from "../../../lib/bot";

// Telegram product photos are small. `responseLimit` is the only response-size
// knob the pages API supports — the previous `maxFileSize` key was not a valid
// Next.js page config and was silently ignored (build warning).
export const config = { api: { responseLimit: "6mb" } };

const MAX_BYTES = 6 * 1024 * 1024;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const fileId = String(req.query.id || "").trim();
  if (!fileId || fileId.length > 400) return res.status(400).json({ error: "file_id required" });
  try {
    const tgFile = await tgApi("getFile", { file_id: fileId });
    const filePath = (tgFile as any)?.file_path;
    if (!filePath) return res.status(404).json({ error: "File not found" });
    const token = botToken();
    const response = await fetch(
      `https://api.telegram.org/file/bot${token}/${filePath}`,
    );
    if (!response.ok) return res.status(404).json({ error: "File not found" });
    const contentType = response.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      return res.status(415).json({ error: "Only image files can be proxied" });
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) {
      return res.status(413).json({ error: "File is too large" });
    }
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(buffer.byteLength));
    // `s-maxw` was a typo, so the CDN ignored the header entirely.
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, immutable");
    return res.status(200).send(Buffer.from(buffer));
  } catch (e: any) {
    console.error("[web/photo]", e);
    return res.status(500).json({ error: "Internal error" });
  }
}


