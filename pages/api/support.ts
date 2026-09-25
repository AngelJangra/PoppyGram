// ---------------------------------------------------------------------------
// Support webapp API
// Exposes store-side support features over the SAME Supabase database the bot uses.
// Reuses the existing admin_session cookie (lib/adminAuth.ts) for auth.
//   GET  /api/support?faq=1  -> read-only FAQ (any visitor)
//   GET  /api/support?tab=... -> list (admin)
//   POST /api/support {action} -> mutate (admin)
// ---------------------------------------------------------------------------
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "../../lib/db";
import { requireAdmin } from "../../lib/adminAuth";
import { sendMessage } from "../../lib/bot";
import { PROJECT_NAME, GITHUB_USERNAME } from "../../lib/credits";

const DIV = "✦ ━━━━━━━━━━━━━ ✦";
const OWNER = "drangeljangra";

export default async function h(req: NextApiRequest, res: NextApiResponse) {
  // FAQ is public.
  if (req.method === "GET" && req.query.faq === "1") {
    return res
      .status(200)
      .json({
        faq: await getFaq(),
        project: PROJECT_NAME,
        github: GITHUB_USERNAME,
        owner: OWNER,
      });
  }
  if (!requireAdmin(req, res)) return;
  try {
    switch (req.method) {
      case "GET":
        return handleGet(req, res);
      case "POST":
        return handlePost(req, res);
      default:
        return res
          .status(405)
          .json({ error: `Method ${req.method} not allowed` });
    }
  } catch (e: any) {
    console.error("[support api]", e);
    return res.status(500).json({ error: "Internal error" });
  }
}

// GET: list handlers
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const tab = String(req.query.tab || "tickets").toLowerCase();
  switch (tab) {
    case "tickets": {
      const { data, error } = await db
        .from("support_tickets")
        .select(
          "id,kind,subject,status,assigned_to,tg_user_id,username,priority,created_at,updated_at",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return res.status(200).json({ tickets: data || [] });
    }
    case "requests": {
      const { data, error } = await db
        .from("file_requests")
        .select(
          "id,tg_user_id,username,file_name,description,source_link,priority,status,handled_by,created_at,updated_at",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return res.status(200).json({ requests: data || [] });
    }
    case "feedback": {
      const { data, error } = await db
        .from("feedback")
        .select("id,tg_user_id,username,rating,text,category,created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return res.status(200).json({ feedback: data || [] });
    }
    case "staff": {
      const { data, error } = await db
        .from("bot_admins")
        .select("username,active,added_by");
      if (error) throw error;
      return res.status(200).json({ staff: data || [] });
    }
    case "stats":
      return res.status(200).json({ stats: await getStats() });
    case "settings": {
      const { data, error } = await db
        .from("settings")
        .select("key,value")
        .in("key", [
          "support_hours",
          "support_welcome",
          "support_offline_msg",
          "support_auto_reply",
          "support_claim_timeout",
          "support_faq",
        ]);
      if (error) throw error;
      return res.status(200).json({ settings: data || [] });
    }
    case "ticket":
      return getTicket(res, Number(req.query.id));
    case "request":
      return getRequest(res, Number(req.query.id));
    default:
      return res.status(400).json({ error: `Unknown tab: ${tab}` });
  }
}

// POST: action dispatcher
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const { action } = req.body || ({} as any);
  switch (action) {
    case "reply":
      return doReply(req, res);
    case "claim":
      return doClaim(req, res);
    case "close":
      return doClose(req, res);
    case "approve":
      return doApprove(req, res);
    case "reject":
      return doReject(req, res);
    case "setsetting":
      return doSetSetting(req, res);
    case "broadcast":
      return doBroadcast(req, res);
    case "assignrequest":
      return doAssignRequest(req, res);
    case "toggleadmin":
      return doToggleAdmin(req, res);
    case "addadmin":
      return doAddAdmin(req, res);
    default:
      return res.status(400).json({ error: "Unknown action" });
  }
}

async function doReply(req: NextApiRequest, res: NextApiResponse) {
  const { ticket_id, text } = req.body as any;
  if (!ticket_id || !text)
    return res.status(400).json({ error: "ticket_id and text required" });
  const { data: ticket, error: err1 } = await db
    .from("support_tickets")
    .select("tg_user_id,status")
    .eq("id", String(ticket_id))
    .maybeSingle();
  if (err1 || !ticket) throw err1;
  if (ticket.status === "closed")
    return res.status(400).json({ error: "Ticket is closed" });
  const admin = UserLabel(req);
  const { error: err2 } = await db
    .from("support_messages")
    .insert({
      ticket_id: Number(ticket_id),
      sender_role: "admin",
      text: String(text),
    });
  if (err2) throw err2;
  await sendMessage(
    Number(ticket.tg_user_id),
    `🛡️ <b>STAFF REPLY</b> — ${DIV}\n\n${escapeHtml(String(text))}\n\n${DIV}\n<i>via PoppyGram support console by @${admin}</i>`,
  );
  const { error } = await db
    .from("support_tickets")
    .update({ status: "claimed", updated_at: new Date().toISOString() })
    .eq("id", String(ticket_id));
  if (error) throw error;
  return res.status(200).json({ ok: true });
}

async function doClaim(req: NextApiRequest, res: NextApiResponse) {
  const { ticket_id } = req.body as any;
  if (!ticket_id) return res.status(400).json({ error: "ticket_id required" });
  const admin = UserLabel(req);
  const { error } = await db
    .from("support_tickets")
    .update({
      status: "claimed",
      assigned_to: admin,
      updated_at: new Date().toISOString(),
    })
    .eq("id", String(ticket_id));
  if (error) throw error;
  const { data: t } = await db
    .from("support_tickets")
    .select("tg_user_id")
    .eq("id", String(ticket_id))
    .maybeSingle();
  if (t?.tg_user_id)
    await notifyUser(
      Number(t.tg_user_id),
      `🧑‍💼 A support manager has joined this ticket and will help you shortly.`,
    );
  return res.status(200).json({ ok: true });
}

async function doClose(req: NextApiRequest, res: NextApiResponse) {
  const { ticket_id } = req.body as any;
  if (!ticket_id) return res.status(400).json({ error: "ticket_id required" });
  const { error } = await db
    .from("support_tickets")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", String(ticket_id));
  if (error) throw error;
  const { data: t } = await db
    .from("support_tickets")
    .select("tg_user_id")
    .eq("id", String(ticket_id))
    .maybeSingle();
  if (t?.tg_user_id)
    await notifyUser(
      Number(t.tg_user_id),
      `✅ <b>Ticket Closed</b>\n\nThis support ticket is now closed. Open a new one with /support.`,
    );
  return res.status(200).json({ ok: true });
}

async function doApprove(req: NextApiRequest, res: NextApiResponse) {
  const { request_id } = req.body as any;
  if (!request_id)
    return res.status(400).json({ error: "request_id required" });
  const admin = UserLabel(req);
  const { data, error } = await db
    .from("file_requests")
    .update({
      status: "approved",
      handled_by: admin,
      updated_at: new Date().toISOString(),
    })
    .eq("id", String(request_id))
    .select("tg_user_id,file_name")
    .maybeSingle();
  if (error) throw error;
  if (data?.tg_user_id)
    await notifyUser(
      Number(data.tg_user_id),
      `✅ Accepted. Request for ${escapeHtml(String(data.file_name))} is being prepared by a support manager.`,
    );
  return res.status(200).json({ ok: true });
}

async function doReject(req: NextApiRequest, res: NextApiResponse) {
  const { request_id, reason } = req.body as any;
  if (!request_id)
    return res.status(400).json({ error: "request_id required" });
  const admin = UserLabel(req);
  const { data, error } = await db
    .from("file_requests")
    .update({
      status: "rejected",
      handled_by: admin,
      note: escapeHtml(String(reason || "")),
      updated_at: new Date().toISOString(),
    })
    .eq("id", String(request_id))
    .select("tg_user_id,file_name")
    .maybeSingle();
  if (error) throw error;
  if (data?.tg_user_id)
    await notifyUser(
      Number(data.tg_user_id),
      `❌ Noted. ${escapeHtml(String(data.file_name))} was declined. ${reason ? `\n\nReason: ${escapeHtml(String(reason))}` : ""}`,
    );
  return res.status(200).json({ ok: true });
}

async function doSetSetting(req: NextApiRequest, res: NextApiResponse) {
  const { key, value } = req.body as any;
  const allowed = [
    "support_hours",
    "support_welcome",
    "support_offline_msg",
    "support_auto_reply",
    "support_claim_timeout",
    "support_faq",
  ];
  if (!allowed.includes(key))
    return res.status(400).json({ error: `setting "${key}" is not editable` });
  let v = String(value || "");
  if (key === "support_faq" || key === "support_auto_reply") {
    try {
      JSON.parse(v);
    } catch {
      return res.status(400).json({ error: "Value must be valid JSON" });
    }
  }
  if (key === "support_claim_timeout") {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 60 || n > 86400)
      return res
        .status(400)
        .json({ error: "claim timeout must be 60-86400 seconds" });
  }
  const { error } = await db
    .from("settings")
    .upsert(
      { key: v, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  if (error) throw error;
  return res.status(200).json({ ok: true, key });
}

async function doBroadcast(req: NextApiRequest, res: NextApiResponse) {
  const { text } = req.body as any;
  if (!text) return res.status(400).json({ error: "text required" });
  const { data: users, error } = await db
    .from("bot_users")
    .select("tg_user_id");
  if (error) throw error;
  let sent = 0,
    failed = 0;
  const ids = (users || [])
    .map((u: any) => Number(u.tg_user_id))
    .filter(Boolean);
  for (let i = 0; i < ids.length; i++) {
    const uid = ids[i];
    try {
      await sendMessage(uid, escapeHtml(String(text)));
      sent++;
    } catch {
      failed++;
    }
    if (i % 25 === 24) await new Promise((r) => setTimeout(r, 1100));
  }
  await db
    .from("audit_logs")
    .insert({
      event: "support.broadcast",
      message: `sent=${sent} failed=${failed}`,
    });
  return res.status(200).json({ ok: true, sent, failed, total: ids.length });
}

async function doAssignRequest(req: NextApiRequest, res: NextApiResponse) {
  const { request_id } = req.body as any;
  if (!request_id)
    return res.status(400).json({ error: "request_id required" });
  const { error } = await db
    .from("file_requests")
    .update({
      handled_by: UserLabel(req),
      updated_at: new Date().toISOString(),
    })
    .eq("id", String(request_id));
  return res.status(200).json({ ok: true });
}

async function doToggleAdmin(req: NextApiRequest, res: NextApiResponse) {
  const { username, active } = req.body as any;
  if (!username) return res.status(400).json({ error: "username required" });
  const u = String(username).replace(/^@/, "").trim().toLowerCase();
  if (u === OWNER)
    return res.status(400).json({ error: "Cannot modify owner" });
  if (active === false || active === "false") {
    const { error } = await db
      .from("bot_admins")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("username", u);
    if (error) throw error;
    return res.status(200).json({ ok: true, action: "deactivated" });
  }
  const { error } = await db
    .from("bot_admins")
    .upsert(
      {
        username: u,
        active: true,
        added_by: UserLabel(req),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "username" },
    );
  if (error) throw error;
  return res.status(200).json({ ok: true, action: "activated" });
}

async function doAddAdmin(req: NextApiRequest, res: NextApiResponse) {
  const { username } = req.body as any;
  if (!username) return res.status(400).json({ error: "username required" });
  const u = String(username).replace(/^@/, "").trim().toLowerCase();
  if (!u || u.length > 32)
    return res.status(400).json({ error: "Invalid username" });
  if (u === OWNER)
    return res.status(400).json({ error: "Owner is always active" });
  const { error } = await db
    .from("bot_admins")
    .upsert(
      {
        username: u,
        active: true,
        added_by: UserLabel(req),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "username" },
    );
  if (error) throw error;
  return res.status(200).json({ ok: true });
}

// Helpers
async function getTicket(res: NextApiResponse, id: number) {
  const { data: t, error: et } = await db
    .from("support_tickets")
    .select("*")
    .eq("id", String(id))
    .maybeSingle();
  if (et) throw et;
  if (!t) return res.status(200).json({ ticket: null, messages: [] });
  const { data: m, error: em } = await db
    .from("support_messages")
    .select("sender_role,text,file_id,created_at")
    .eq("ticket_id", String(id))
    .order("created_at");
  if (em) throw em;
  return res.status(200).json({ ticket: t, messages: m || [] });
}

async function getRequest(res: NextApiResponse, id: number) {
  const { data, error } = await db
    .from("file_requests")
    .select("*")
    .eq("id", String(id))
    .maybeSingle();
  if (error) throw error;
  return res.status(200).json({ request: data });
}

async function getStats() {
  const [{ count: tic }, { count: req }, { count: fb }] = await Promise.all([
    db.from("support_tickets").select("*", { count: "exact", head: true }),
    db.from("file_requests").select("*", { count: "exact", head: true }),
    db.from("feedback").select("*", { count: "exact", head: true }),
  ]);
  return { tickets: tic || 0, file_requests: req || 0, feedback: fb || 0 };
}

async function getFaq() {
  try {
    const { data } = await db
      .from("settings")
      .select("value")
      .eq("key", "support_faq")
      .maybeSingle();
    if (data?.value) {
      try {
        return JSON.parse(data.value);
      } catch {}
    }
  } catch {}
  return {
    "Payment or credit problems":
      "Use /balance to check your credits, then /store to browse files. Credits are deducted at purchase.",
    "Files that will not open or download":
      "Purchased files are delivered by the bot directly. If download fails, tell support your Telegram ID and the product name.",
    "Account authentication problems":
      "Run /auth in the main PoppyGram bot, open the verification link, and complete the login in your browser.",
    "Report a bug or a missing product":
      "Use the Support webapp or send /support to describe the issue. Include screenshots and your Telegram ID.",
    "How do I contact support?":
      "Tap the live support option here, or open @poppygramsupportbot in Telegram.",
  };
}

function UserLabel(req: NextApiRequest): string {
  return String(
    (req.body as any)?.admin_username || req.cookies?.admin_user || OWNER,
  );
}

async function notifyUser(tgId: number | undefined | null, text: string) {
  if (!tgId || tgId <= 0) return;
  try {
    await sendMessage(tgId, text);
  } catch {}
}

function escapeHtml(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
