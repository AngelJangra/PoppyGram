# ---------------------------------------------------------------------------
# POPPYGRAM SUPPORT BOT — @poppygramsupportbot
# Runs on Vercel NEXT TO the Next.js store bot: webhook mode at /api/support
# (serverless cannot long-poll). Two Telegram bots = two webhooks, one project.
#
# Per project requirement the bot token is HARDCODED — no environment variable.
# Supabase comes from the shared project env (same as the website):
#   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
# Same tables as the website: bot_users, bot_admins, settings, audit_logs.
# Support data lives in the settings KV (zero SQL migration):
#   sup_ticket:{id} sup_frq:{id} sup_fb:{id} sup_state:{chat}
#   sup_seq/sup_frid/sup_fbid (counters) sup_upd:{update_id} (idempotency)
# ---------------------------------------------------------------------------
import json, os, re, time, urllib.request, urllib.parse, urllib.error
from http.server import BaseHTTPRequestHandler

BOT_TOKEN = "8679664842:AAHd6cE-c5cQRVlK8S9JUQZXAMF_CG9JeZY"
WEBHOOK_SECRET = "poppygram-support-8679664842"
SUPA_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPA_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
OWNER = "drangeljangra"
GITHUB_USER = "AngelJangra"
GITHUB_URL = "https://github.com/" + GITHUB_USER
DIV = "✦ ━━━━━━━━━━━━━ ✦"
BOT_USERNAME = ""
_OFFLINE_DEFAULT = "🕐 We are offline right now. Leave your message — a support manager will reply as soon as we are back. Your ticket stays open."

# --- text helpers (same visual style as the store bot) ---------------------
def esc(s):
    return str(s if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def F(s):
    out = []
    for ch in str(s if s is not None else ""):
        c = ord(ch)
        if 65 <= c <= 90: out.append(chr(0x1D5D4 + c - 65))
        elif 97 <= c <= 122: out.append(chr(0x1D5EE + c - 97))
        elif 48 <= c <= 57: out.append(chr(0x1D7EC + c - 48))
        else: out.append(ch)
    return "".join(out)

def credit(body):
    foot = '⚡ <a href="%s">Powered by %s</a>' % (GITHUB_URL, GITHUB_USER)
    if not body or GITHUB_URL in body:
        return body
    room = 4096 - len(foot) - 3
    head = body if len(body) <= room else body[:room] + "…"
    return head + "\n\n" + foot

def kb(rows):
    out = []
    for row in rows or []:
        r = []
        for t, d in row:
            b = {"text": str(t)[:64]}
            if str(d).startswith(("http://", "https://")):
                b["url"] = d
            else:
                b["callback_data"] = str(d)[:64]
            r.append(b)
        if r:
            out.append(r)
    return {"inline_keyboard": out} if out else None

# --- Telegram --------------------------------------------------------------
def tg(method, payload=None, timeout=12):
    req = urllib.request.Request(
        "https://api.telegram.org/bot%s/%s" % (BOT_TOKEN, method),
        data=json.dumps(payload or {}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read().decode())
    if not data.get("ok"):
        raise RuntimeError(str(data.get("description") or "telegram error"))
    return data.get("result")

def send(chat_id, text, buttons=None):
    body = {"chat_id": chat_id, "text": credit(text), "parse_mode": "HTML",
            "disable_web_page_preview": True}
    markup = kb(buttons)
    if markup:
        body["reply_markup"] = markup
    try:
        return tg("sendMessage", body)
    except Exception:
        return None

# --- Supabase (PostgREST, service role) ------------------------------------
def supa(method, path, payload=None, params="", prefer="return=representation"):
    if not SUPA_URL or not SUPA_KEY:
        raise RuntimeError("Supabase env missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)")
    url = SUPA_URL.rstrip("/") + "/rest/v1/" + path + (("?" + params) if params else "")
    headers = {"Content-Type": "application/json", "apikey": SUPA_KEY,
               "Authorization": "Bearer " + SUPA_KEY, "Prefer": prefer}
    req = urllib.request.Request(url, data=None if payload is None else json.dumps(payload).encode(),
                                 headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt.strip() else []
    except urllib.error.HTTPError as e:
        detail = e.read().decode()
        if e.code in (409, 425) and "23505" in detail:
            return "__DUP__"                      # PK conflict = duplicate insert
        raise RuntimeError(detail[:400])

def q(s):
    return urllib.parse.quote(str(s), safe="")

def get_setting(key, default=""):
    rows = supa("GET", "settings", params="select=value&key=eq." + q(key))
    if rows == "__DUP__" or not rows:
        return default
    v = rows[0].get("value")
    return default if v is None else v

def upsert_setting(key, value):
    return supa("POST", "settings", {"key": key, "value": str(value)},
                prefer="resolution=merge-duplicates,return=minimal")

def put_setting(key, value):
    # PLAIN insert (no merge) — used for idempotency: a duplicate key returns
    # __DUP__ instead of silently overwriting, which is how retries are detected.
    return supa("POST", "settings", {"key": key, "value": str(value)})

def del_setting(key):
    supa("DELETE", "settings", params="key=eq." + q(key), prefer="return=minimal")

def scan(prefix, limit=200):
    # PostgREST LIKE wildcard is * — prefix:* matches everything under it.
    rows = supa("GET", "settings", params="select=key,value&key=like." + q(prefix + ":*") + "&limit=" + str(limit))
    return [] if rows == "__DUP__" else (rows or [])

def next_id(counter_key):
    try:
        n = int(get_setting(counter_key, "0"))
    except Exception:
        n = 0
    n += 1
    upsert_setting(counter_key, str(n))
    return n

def cfg(key, default):
    try:
        v = get_setting(key, "")
        return v if v else default
    except Exception:
        return default

# --- ephemeral flow state (settings KV, same pattern as the store bot) -----
def get_state(cid):
    raw = get_setting("sup_state:%s" % cid, "")
    try:
        return json.loads(raw) if raw else None
    except Exception:
        return None

def set_state(cid, st):
    upsert_setting("sup_state:%s" % cid, json.dumps(st))

def clear_state(cid):
    try:
        del_setting("sup_state:%s" % cid)
    except Exception:
        pass

# --- admins (SHARED with the website: bot_admins table) --------------------
def admin_rows():
    rows = supa("GET", "bot_admins", params="select=username,tg_chat_id&active=eq.true")
    return [] if rows == "__DUP__" else (rows or [])

def is_admin(u):
    uname = str((u or {}).get("username") or "").lower()
    if uname == OWNER:
        return True
    if not uname:
        return False
    rows = supa("GET", "bot_admins", params="select=username&active=eq.true&username=eq." + q(uname))
    return rows != "__DUP__" and bool(rows)

def remember_chat(u):
    uname = str((u or {}).get("username") or "").lower()
    uid = (u or {}).get("id")
    if not uname or not uid:
        return
    try:
        if is_admin(u):
            supa("PATCH", "bot_admins", {"tg_chat_id": str(uid)},
                 params="username=eq." + q(uname) + "&tg_chat_id=is.null", prefer="return=minimal")
    except Exception:
        pass

def notify_admins(text, buttons=None):
    n = 0
    for r in admin_rows():
        cid = r.get("tg_chat_id")
        if not cid:
            continue
        if send(cid, text, buttons) is not None:
            n += 1
    return n

def audit(event, message):
    try:
        supa("POST", "audit_logs", {"event": event, "message": str(message)[:500]}, prefer="return=minimal")
    except Exception:
        pass

def ensure_user(u):
    # Merge-duplicate upsert: only these columns written — credit/auth untouched.
    try:
        supa("POST", "bot_users", {"tg_user_id": str(u.get("id")),
             "username": str(u.get("username") or "").lower(),
             "first_name": str(u.get("first_name") or ""),
             "last_name": str(u.get("last_name") or "")},
             prefer="resolution=merge-duplicates,return=minimal")
    except Exception:
        pass

def is_online():
    raw = str(cfg("support_hours", "09:00-22:00"))
    m = re.search(r"(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})", raw)
    if not m:
        return True
    cur = int((time.time() + 330 * 60) // 60 % 1440)   # IST = UTC+5:30
    s = int(m.group(1)) * 60 + int(m.group(2))
    e = int(m.group(3)) * 60 + int(m.group(4))
    if s == e:
        return True
    return (s <= cur <= e) if s < e else (cur >= s or cur <= e)

# --- shared KV objects (settings table: {prefix}:{id} = JSON) --------------
def load_objects(prefix, limit=200):
    out = []
    for row in scan(prefix, limit):
        try:
            out.append(json.loads(row["value"]))
        except Exception:
            pass
    out.sort(key=lambda x: x.get("id", 0), reverse=True)
    return out

def get_obj(prefix, oid):
    raw = get_setting("%s:%s" % (prefix, oid), "")
    try:
        return json.loads(raw) if raw else None
    except Exception:
        return None

def save_obj(prefix, obj):
    upsert_setting("%s:%s" % (prefix, obj["id"]), json.dumps(obj))

ST = {"open": "🟠", "claimed": "🔵", "closed": "🟢",
      "pending": "🟡", "approved": "🟢", "rejected": "🔴", "delivered": "📦"}

def open_live(uid):
    for t in load_objects("sup_ticket", 300):
        if str(t.get("user")) == str(uid) and t.get("kind") == "live" and t.get("status") != "closed":
            return t
    return None

def ticket_card(t, admin_view=False):
    who = str(t.get("name") or "user")
    tag = ("@" + str(t.get("uname"))) if t.get("uname") else ""
    lines = ["%s <b>%s TICKET #%s</b> %s" % (ST.get(t.get("status"), "⚪"), F(str(t.get("kind", "live")).upper()), t["id"], DIV),
             "👤 <b>%s</b> %s <code>%s</code>" % (esc(who), esc(tag), esc(t.get("user")))]
    if admin_view:
        lines.append("📝 Subject: %s" % esc(t.get("subject", "—")))
        lines.append("🛡️ Assigned: %s" % esc(t.get("assigned") or "unclaimed"))
        msgs = t.get("msgs") or []
        if msgs:
            lines.append("")
            lines.append("<b>Last messages:</b>")
            for m in msgs[-5:]:
                lines.append("• <b>%s:</b> %s" % (esc(m.get("who", "?")), esc(str(m.get("text", ""))[:160])))
    return "\n".join(lines)

def ticket_kb(t, admin_view=False):
    if not admin_view:
        return [[("❌ Close my ticket", "u:close:%s" % t["id"])]]
    if t.get("status") == "closed":
        return []
    rows = []
    if t.get("status") == "open":
        rows.append([("✅ Claim #%s" % t["id"], "a:claim:%s" % t["id"])])
    rows.append([("👤 User info", "a:who:%s" % t["id"]), ("❌ Close", "a:close:%s" % t["id"])])
    return rows

def announce_ticket(t):
    open_n = len([x for x in load_objects("sup_ticket", 300) if x.get("status") == "open"])
    text = ("🎫 <b>%s NEW LIVE TICKET #%s</b> %s\n\n👤 <b>%s</b> %s\n🕐 <code>%s</code>\n🟡 <b>%d</b> %s"
            % (F("SUPPORT"), t["id"], DIV, esc(str(t.get("name") or "user")),
               esc("@" + str(t.get("uname"))) if t.get("uname") else "",
               esc(str(t.get("user"))), open_n, F("in queue")))
    return notify_admins(text, ticket_kb(t, True))

# --- file requests (settings KV: sup_frq:{id}) -----------------------------
def frq_card(r, admin_view=False):
    lines = ["%s <b>FILE REQUEST #%s</b> %s" % (ST.get(r.get("status"), "🟡"), r["id"], DIV),
             "📄 <b>%s</b>" % esc(r.get("file_name", "—")),
             "📝 %s" % esc(str(r.get("description", ""))[:300]),
             "🔗 %s" % esc(r.get("source_link") or "—"),
             "⚡ Priority: <b>%s</b> %s" % (esc(r.get("priority", "normal")),
             {"urgent": "🔴", "soon": "🟡", "normal": "🟢"}.get(r.get("priority", "normal"), ""))]
    if admin_view:
        lines.insert(1, "👤 <code>%s</code> · %s" % (esc(r.get("user")), esc(r.get("uname") or "—")))
        if r.get("note"):
            lines.append("💬 Note: %s" % esc(r["note"]))
    return "\n".join(lines)

def frq_kb(r, admin_view=False):
    if not admin_view:
        if r.get("status") in ("pending", "approved"):
            return [[("❌ Cancel request", "u:frcancel:%s" % r["id"])]]
        return []
    if r.get("status") == "delivered":
        return []
    return [[("✅ Approve", "a:fapp:%s" % r["id"]), ("❌ Reject", "a:frej:%s" % r["id"]),
             ("📦 Delivered", "a:fdel:%s" % r["id"])]]

def notify_frq_admins(r):
    return notify_admins("📁 <b>%s FILE REQUEST #%s</b>\n\n%s" % (F("NEW"), r["id"], frq_card(r, True)),
                         frq_kb(r, True))

# --- feedback (settings KV: sup_fb:{id}) -----------------------------------
def fb_cd(uid):
    raw = get_setting("sup_fbcd:%s" % uid, "")
    try:
        return bool(raw) and (time.time() - int(raw) < 86400)
    except Exception:
        return False

def fb_stamp(uid):
    upsert_setting("sup_fbcd:%s" % uid, str(int(time.time())))

def fb_stats():
    rows = load_objects("sup_fb", 500)
    dist = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    for r in rows:
        try:
            n = int(r.get("rating", 0))
        except Exception:
            n = 0
        if n in dist:
            dist[n] += 1
    avg = (sum(k * v for k, v in dist.items()) / len(rows)) if rows else 0
    return rows, dist, avg

# --- menus -----------------------------------------------------------------
def menu_kb():
    return [[("📞 1. Live Support", "m:live"), ("📁 2. Request a File", "m:file")],
            [("⭐ 3. Feedback", "m:fb"), ("❓ 4. Help & FAQ", "m:faq")],
            [("🎫 5. My Tickets", "m:tickets"), ("📊 6. My Stats", "m:stats")],
            [("🔔 7. Announcements", "m:news"), ("📜 8. Rules", "m:rules")],
            [("🕐 9. Support Hours", "m:hours"), ("👤 10. Account", "m:acct")],
            [("💎 Credits", "m:credits")]]

def welcome_text():
    badge = ("🟢 %s" % F("ONLINE")) if is_online() else ("🔴 %s" % F("OFFLINE"))
    return ("🆘 <b>%s</b> 🛡️\n\n%s\n\n👋 <b>%s</b> %s\n🕐 <b>%s:</b> <code>%s</code> · %s\n\n%s\n\n💬 %s\n⚡ %s"
            % (F("SUPPORT CENTER"), DIV, F("Welcome"), F("How can we help today?"),
               F("Hours"), esc(cfg("support_hours", "09:00-22:00 IST")), badge, DIV,
               F("Real humans, real answers."), F("Tap a button below.")))

HELP_TEXT = ("📖 <b>%s</b> %s\n\n"
             "📞 <b>Live Support</b> — %s\n"
             "📁 <b>Request a File</b> — %s\n"
             "⭐ <b>Feedback</b> — %s\n"
             "🎫 <b>My Tickets</b> — %s\n"
             "📊 <b>My Stats</b> — %s\n\n"
             "%s\n\n"
             "⌨️ %s\n"
             "   /start /help /faq /tickets\n"
             "   /feedback /hours /rules /cancel"
             % (F("HOW IT WORKS"), DIV,
                F("chat with a real support manager"),
                F("ask for any file, mod apk or app"),
                F("rate us 1-5 stars"),
                F("track your open tickets"),
                F("your history and average rating"),
                DIV, F("Commands:")))

FAQ_ROWS = [[("💳 Payments & credits", "faq:1"), ("📦 Files & downloads", "faq:2")],
            [("🔐 Auth / verification", "faq:3"), ("🛡️ Safety & privacy", "faq:4")],
            [("🛍️ Store & orders", "faq:5"), ("🆘 Contact live support", "m:live")]]

FAQ_ANS = {
    "faq:1": "💳 <b>PAYMENTS & CREDITS</b>\n\nNew verified accounts get store credits (check /profile in the main PoppyGram bot). /freecredits gives more every 24h after auth. Admins have unlimited credits. Money questions → 📞 Live Support.",
    "faq:2": "📦 <b>FILES & DOWNLOADS</b>\n\nBought files arrive instantly in chat after purchase in the store bot. File won't open? Open a live ticket and we re-send it. Need a NEW file? Use option 2 — Request a File.",
    "faq:3": "🔐 <b>AUTH / VERIFICATION</b>\n\nIn the MAIN PoppyGram bot send /auth, enter your number, open the verification link. Sessions are stored encrypted; passwords never leave your browser. Stuck? Live support can re-issue the link.",
    "faq:4": "🛡️ <b>SAFETY & PRIVACY</b>\n\nWe never ask for your password or login code. Support staff will NEVER ask for codes. Report anything suspicious via a live ticket — we act fast.",
    "faq:5": "🛍️ <b>STORE & ORDERS</b>\n\nBrowse with /store, search with /search, prices are in credits, purchases are atomic with automatic refund if delivery fails. Order issues → live ticket with your order ID.",
}

# === FLOWS ==================================================================
def start_live(u, chat_id):
    existing = open_live(u.get("id"))
    if existing:
        send(chat_id, "🎫 <b>%s</b> %s\n\n%s\n\n💬 %s"
             % (F("YOU ALREADY HAVE AN OPEN TICKET"), DIV, ticket_card(existing),
                F("Just type your message — it goes straight to your support manager.")),
             ticket_kb(existing))
        return
    tid = next_id("sup_seq")
    t = {"id": tid, "kind": "live", "user": str(u.get("id")),
         "uname": str(u.get("username") or "").lower(),
         "name": str(u.get("first_name") or u.get("username") or "user"),
         "subject": cfg("support_welcome_q", "How can we help?"),
         "status": "open", "assigned": None, "created": int(time.time()), "msgs": []}
    save_obj("sup_ticket", t)
    audit("support.ticket_open", "#%s user=%s" % (tid, t["user"]))
    if not is_online():
        send(chat_id, "🎫 <b>%s #%s</b> %s\n\n%s\n\n💬 %s"
             % (F("TICKET OPENED"), tid, DIV, esc(cfg("support_offline_msg", _OFFLINE_DEFAULT)),
                F("Type your message — it is saved and a manager replies when we are back.")))
    else:
        send(chat_id, "🎫 <b>%s #%s</b> %s\n\n✅ %s\n🟡 %s\n\n💬 %s"
             % (F("LIVE SUPPORT TICKET"), tid, DIV, F("You are in the queue."),
                F("A support manager will join shortly."),
                F("Type your message now — it is delivered instantly.")))
    n = announce_ticket(t)
    audit("support.admin_notify", "#%s notified=%d" % (tid, n))

def relay_user_msg(t, chat_id, text):
    t.setdefault("msgs", []).append({"who": "user", "text": str(text)[:1000], "ts": int(time.time())})
    t["msgs"] = t["msgs"][-80:]
    save_obj("sup_ticket", t)
    if t.get("status") == "closed":
        send(chat_id, "ℹ️ %s" % F("This ticket is closed. Open a new one from the menu."))
        return
    delivered = False
    if t.get("assigned"):
        for r in admin_rows():
            if str(r.get("username", "")).lower() == str(t["assigned"]).lower() and r.get("tg_chat_id"):
                send(r["tg_chat_id"], "💬 <b>USER #%s</b>\n\n%s" % (t["id"], esc(text)),
                     [[("❌ Close", "a:close:%s" % t["id"])]])
                delivered = True
                break
    if not delivered:
        now = int(time.time())
        if now - int(t.get("lastn") or 0) > 120:
            t["lastn"] = now
            save_obj("sup_ticket", t)
            notify_admins("📨 <b>USER #%s</b> %s\n\n%s" % (t["id"], F("(unclaimed — still waiting)"), esc(text)),
                          ticket_kb(t, True))
    send(chat_id, "✅ %s" % F("Delivered to your support manager."))

def relay_admin_msg(t, admin_u, text):
    t.setdefault("msgs", []).append({"who": "admin:" + str(admin_u.get("username") or ""), "text": str(text)[:1000], "ts": int(time.time())})
    t["msgs"] = t["msgs"][-80:]
    save_obj("sup_ticket", t)
    send(int(t["user"]), "🛡️ <b>%s (ticket #%s)</b>\n\n%s" % (F("SUPPORT REPLY"), t["id"], esc(text)))

def admin_open_ticket(uid_or_uname):
    # the ticket this admin has claimed and not yet closed (admin→user relay)
    key = str(uid_or_uname).lower()
    for t in load_objects("sup_ticket", 300):
        if t.get("status") == "claimed" and str(t.get("assigned", "")).lower() == key:
            return t
    return None

def menu_back():
    return [[("🏠 Back to menu", "m:menu")]]

# --- file request wizard ---------------------------------------------------
def frq_advance(chat_id, st, text):
    step = st.get("step")
    if step == "frq_name":
        if not text or len(text) > 200 or text.startswith("/"):
            send(chat_id, "📄 %s" % F("Send the file/app name (max 200 chars)."))
            return
        st["file_name"] = text
        st["step"] = "frq_desc"
        set_state(chat_id, st)
        send(chat_id, "📝 %s\n\n<i>%s</i>" % (F("Describe it — what is it, which version?"), F("Send /skip if you do not want to.")))
    elif step == "frq_desc":
        st["description"] = "" if text == "/skip" else (text or "")[:500]
        st["step"] = "frq_link"
        set_state(chat_id, st)
        send(chat_id, "🔗 %s\n\n<i>%s</i>" % (F("Source link (Play Store / site / TG post)?"), F("Send /skip if none.")))
    elif step == "frq_link":
        st["source_link"] = "" if text == "/skip" else (text or "")[:300]
        st["step"] = "frq_prio"
        set_state(chat_id, st)
        send(chat_id, "⚡ %s" % F("Priority:"),
             [[("🟢 Normal", "frq:p:normal"), ("🟡 Soon", "frq:p:soon"), ("🔴 Urgent", "frq:p:urgent")]])

def frq_finalize(chat_id, u, prio):
    st = get_state(chat_id) or {}
    rid = next_id("sup_frid")
    r = {"id": rid, "user": str(u.get("id")), "uname": str(u.get("username") or "").lower(),
         "file_name": st.get("file_name", "?"), "description": st.get("description", ""),
         "source_link": st.get("source_link", ""), "priority": prio,
         "status": "pending", "note": "", "created": int(time.time())}
    save_obj("sup_frq", r)
    clear_state(chat_id)
    audit("support.frq", "#%s %s" % (rid, r["file_name"]))
    send(chat_id, "✅ <b>%s #%s</b> %s\n\n%s\n\n%s"
         % (F("FILE REQUEST SUBMITTED"), rid, DIV, frq_card(r), F("Track it anytime under 🎫 My Tickets.")),
         frq_kb(r))
    notify_frq_admins(r)

def frq_set_status(chat_id, rid, status, note=""):
    r = get_obj("sup_frq", rid)
    if not r:
        send(chat_id, "❌ %s" % F("Request not found."))
        return
    r["status"] = status
    if note:
        r["note"] = str(note)[:300]
    save_obj("sup_frq", r)
    audit("support.frq_%s" % status, "#%s" % rid)
    send(chat_id, "✅ <b>%s #%s → %s</b>" % (F("FILE REQUEST"), rid, status.upper()), frq_kb(r, True))
    # notify the requester
    send(int(r["user"]),
         {"pending": "🟡 <b>%s #%s</b>\n\n%s\n\n<i>%s</i>",
          "approved": "✅ <b>%s #%s</b>\n\n%s\n\n💬 %s",
          "rejected": "❌ <b>%s #%s</b>\n\n%s\n\n💬 %s",
          "delivered": "📦 <b>%s #%s</b>\n\n%s\n\n🎉 %s"}[status]
         % (F("FILE REQUEST"), rid, frq_card(r),
            {"pending": F("We are working on it."),
             "approved": (esc(r["note"]) if r.get("note") else F("Approved — coming soon.")),
             "rejected": (esc(r["note"]) if r.get("note") else F("Rejected — try a different source or open live support.")),
             "delivered": F("Your file is ready — check the main store bot /store or ask here.")}[status]))

# --- feedback save ---------------------------------------------------------
def fb_save(chat_id, u, rating, text, category="general"):
    fid = next_id("sup_fbid")
    fb = {"id": fid, "user": str(u.get("id")), "uname": str(u.get("username") or "").lower(),
          "rating": int(rating), "category": category, "text": str(text or "")[:800],
          "created": int(time.time())}
    save_obj("sup_fb", fb)
    fb_stamp(str(u.get("id")))
    clear_state(chat_id)
    audit("support.fb", "#%s r=%s" % (fid, rating))
    send(chat_id, "🙏 <b>%s</b> %s\n\n%s <code>%s/5</code>\n\n💬 %s\n\n🌟 %s"
         % (F("THANK YOU"), DIV, "★" * int(rating), rating, esc(text or "—"),
            F("Feedback reaches the team directly.")),
         [[("🏠 Back to menu", "m:menu")]])

# === ADMIN (reads/writes the SAME bot_admins table as the website) ==========
ADMIN_HELP = ("🛡️ <b>%s</b> %s\n\n"
              "/ticketsall — %s\n"
              "/filereqs — %s\n"
              "/feedbackstats — %s\n"
              "/admins — %s\n"
              "/addadmin @user — %s\n"
              "/removeadmin @user — %s\n"
              "/broadcast TEXT — %s\n"
              "/sethours 09:00-22:00 — %s\n"
              "/stats — %s"
              % (F("ADMIN COMMANDS"), DIV,
                 F("list open tickets"), F("pending file requests"),
                 F("ratings overview"), F("list staff"),
                 F("grant support access"), F("revoke support access"),
                 F("message every user"), F("set support hours"),
                 F("bot + support numbers")))

def admin_panel_kb():
    return [[("🎫 Open tickets", "a:tickets"), ("📁 File requests", "a:frqs")],
            [("⭐ Feedback stats", "a:fbstats"), ("🛡️ Staff", "a:staff")],
            [("📈 Stats", "a:stats"), ("📖 Admin help", "a:help")]]

def cmd_admin(chat_id, u):
    send(chat_id, ADMIN_HELP, admin_panel_kb())

def cmd_tickets(chat_id, status="open"):
    rows = [t for t in load_objects("sup_ticket", 300) if t.get("status") == status]
    if not rows:
        send(chat_id, "🎫 <b>%s</b> %s\n\n<i>%s</i>" % (F(status.upper() + " TICKETS"), DIV, F("Nothing here.")),
             [[("🔁 Claimed", "a:tk:claimed"), ("🟢 Closed", "a:tk:closed"), ("🟠 Open", "a:tk:open")]])
        return
    body = "\n\n".join(ticket_card(t, True) for t in rows[:8])
    kbs = []
    for t in rows[:4]:
        if t.get("status") in ("open", "claimed"):
            is_open = t.get("status") == "open"
            kbs.append([("%s #%s" % ("✅ Claim" if is_open else "❌ Close", t["id"]),
                         ("a:claim:%s" if is_open else "a:close:%s") % t["id"])])
    kbs.append([("🔁 Claimed", "a:tk:claimed"), ("🟢 Closed", "a:tk:closed"), ("🟠 Open", "a:tk:open")])
    send(chat_id, "🎫 <b>%s</b> %s\n\n%s" % (F(status.upper() + " TICKETS"), DIV, body), kbs)

def cmd_frqs(chat_id, status="pending"):
    rows = [r for r in load_objects("sup_frq", 200) if r.get("status") == status]
    if not rows:
        send(chat_id, "📁 <b>%s</b> %s\n\n<i>%s</i>" % (F(status.upper() + " REQUESTS"), DIV, F("Nothing here.")),
             [[("🟡 Pending", "a:fr:pending"), ("📦 Delivered", "a:fr:delivered")]])
        return
    body = "\n\n".join(frq_card(r, True) for r in rows[:8])
    kbs = []
    for r in rows[:4]:
        if r.get("status") == "pending":
            kbs.append([("✅ #%s" % r["id"], "a:fapp:%s" % r["id"]),
                        ("❌ #%s" % r["id"], "a:frej:%s" % r["id"]),
                        ("📦 #%s" % r["id"], "a:fdel:%s" % r["id"])])
    kbs.append([("🟡 Pending", "a:fr:pending"), ("📦 Delivered", "a:fr:delivered")])
    send(chat_id, "📁 <b>%s</b> %s\n\n%s" % (F(status.upper() + " REQUESTS"), DIV, body), kbs)

def cmd_fbstats(chat_id):
    rows, dist, avg = fb_stats()
    bars = "\n".join("%d★ %s %d" % (n, "█" * min(dist[n], 30), dist[n]) for n in range(5, 0, -1))
    recent = "\n".join("• %s★ %s — %s" % (r.get("rating"), esc(r.get("uname") or r.get("user")),
                       esc(str(r.get("text") or "—"))[:80]) for r in rows[:6])
    send(chat_id, "⭐ <b>%s</b> %s\n\n🌟 %s <code>%.2f/5</code>\n📦 %s <code>%d</code>\n\n%s\n\n<b>%s:</b>\n%s"
         % (F("FEEDBACK OVERVIEW"), DIV, F("Average"), avg, F("Total"), len(rows), bars,
            F("Recent"), recent or "—"))

def cmd_admins(chat_id):
    rows = admin_rows()
    body = "\n".join("%d. @%s %s" % (i + 1, r.get("username"),
                     "🛡️" if str(r.get("username")).lower() == OWNER else "")
                     for i, r in enumerate(rows)) or F("No staff yet.")
    send(chat_id, "🛡️ <b>%s</b> %s\n\n%s\n\n💡 %s"
         % (F("SUPPORT STAFF"), DIV, body, F("Same list shown on the website Support tab.")))

def cmd_addadmin(chat_id, u, target):
    uname = str(target or "").strip().lstrip("@").lower()
    if not uname:
        send(chat_id, "ℹ️ Usage: <code>/addadmin @username</code>")
        return
    r = supa("POST", "bot_admins", {"username": uname, "active": True,
             "added_by": str(u.get("username") or OWNER)},
             prefer="resolution=merge-duplicates,return=minimal")
    if r == "__DUP__":
        supa("PATCH", "bot_admins", {"active": True}, params="username=eq." + q(uname), prefer="return=minimal")
    audit("support.admin_added", "%s by %s" % (uname, u.get("username")))
    send(chat_id, "✅ <b>%s</b> @%s\n\n🛡️ %s"
         % (F("ADMIN ADDED"), esc(uname), F("They now receive live tickets and file requests.")))

def cmd_removeadmin(chat_id, u, target):
    uname = str(target or "").strip().lstrip("@").lower()
    if not uname:
        send(chat_id, "ℹ️ Usage: <code>/removeadmin @username</code>")
        return
    if uname == OWNER:
        send(chat_id, "🔒 %s" % F("The owner account cannot be removed."))
        return
    supa("PATCH", "bot_admins", {"active": False}, params="username=eq." + q(uname), prefer="return=minimal")
    audit("support.admin_removed", "%s by %s" % (uname, u.get("username")))
    send(chat_id, "🗑️ <b>%s</b> @%s" % (F("ADMIN REMOVED"), esc(uname)))

def cmd_broadcast(chat_id, text):
    st = {"step": "bc", "text": str(text)[:3500]}
    set_state(chat_id, st)
    send(chat_id, "📢 <b>%s</b> %s\n\n%s" % (F("BROADCAST PREVIEW"), DIV, credit(st["text"])),
         [[("✅ Send to everyone", "bc:go"), ("❌ Cancel", "bc:no")]])

def do_broadcast(chat_id, u):
    st = get_state(chat_id) or {}
    text = str(st.get("text") or "")
    clear_state(chat_id)
    if not text:
        send(chat_id, "❌ %s" % F("Nothing to send."))
        return
    send(chat_id, "📤 <b>%s</b> …" % F("Sending broadcast"))
    rows = supa("GET", "bot_users", params="select=tg_user_id&limit=5000")
    ids = [r["tg_user_id"] for r in (rows if rows != "__DUP__" else []) if r.get("tg_user_id")]
    ok = 0
    for uid in ids:
        try:
            tg("sendMessage", {"chat_id": int(uid), "text": text, "parse_mode": "HTML",
                               "disable_web_page_preview": True})
            ok += 1
        except Exception:
            pass
        time.sleep(0.05)          # stay under Telegram's rate limit
    audit("support.broadcast", "%d/%d sent by %s" % (ok, len(ids), u.get("username")))
    send(chat_id, "📢 <b>%s</b>\n\n✅ %d / %d" % (F("BROADCAST COMPLETE"), ok, len(ids)))

def cmd_sethours(chat_id, value):
    if not re.match(r"\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}", value or ""):
        send(chat_id, "ℹ️ Usage: <code>/sethours 09:00-22:00</code>")
        return
    upsert_setting("support_hours", value)
    audit("support.hours", value)
    send(chat_id, "🕐 <b>%s</b> <code>%s</code>" % (F("HOURS UPDATED"), esc(value)))

def cmd_stats(chat_id):
    tk = load_objects("sup_ticket", 500)
    fr = load_objects("sup_frq", 300)
    rows, dist, avg = fb_stats()
    send(chat_id, "📈 <b>%s</b> %s\n\n"
         "🎫 %s <b>%d</b> (🟠 %d · 🔵 %d · 🟢 %d)\n"
         "📁 %s <b>%d</b> (🟡 %d · 📦 %d)\n"
         "⭐ %s <b>%d</b> · 🌟 %.2f\n"
         "🛡️ %s <b>%d</b>\n"
         "🕐 %s <code>%s</code> %s"
         % (F("SUPPORT DASHBOARD"), DIV,
            F("Tickets"), len(tk),
            len([t for t in tk if t.get("status") == "open"]),
            len([t for t in tk if t.get("status") == "claimed"]),
            len([t for t in tk if t.get("status") == "closed"]),
            F("File reqs"), len(fr),
            len([r for r in fr if r.get("status") == "pending"]),
            len([r for r in fr if r.get("status") == "delivered"]),
            F("Feedback"), len(rows), avg,
            F("Staff"), len(admin_rows()),
            F("Hours"), esc(cfg("support_hours", "09:00-22:00 IST")),
            "🟢" if is_online() else "🔴"))

# === MESSAGE ROUTER =========================================================
def handle_message(msg):
    chat = msg.get("chat") or {}
    chat_id = chat.get("id")
    u = msg.get("from") or {}
    uid = u.get("id")
    if not chat_id or not uid:
        return
    raw = str(msg.get("text") or msg.get("caption") or "")
    cmd = raw.split()[0].split("@")[0].lower() if raw.startswith("/") else ""
    private = chat.get("type") == "private"
    ensure_user(u)
    remember_chat(u)
    admin = is_admin(u)

    if not private and not cmd:
        return                                       # groups: commands only
    st = get_state(chat_id) if private else None
    if st and cmd in ("/start", "/help", "/cancel", "/menu"):
        clear_state(chat_id)
        st = None
    if cmd == "/start":
        send(chat_id, welcome_text(), menu_kb())
        return
    if cmd in ("/menu", "/help"):
        send(chat_id, HELP_TEXT if cmd == "/help" else welcome_text(), menu_kb())
        return
    if cmd == "/cancel":
        clear_state(chat_id)
        send(chat_id, "🚫 <b>%s</b>\n\n%s" % (F("CANCELLED"), F("No pending flow. Pick something from the menu.")), menu_kb())
        return
    if cmd == "/faq":
        send(chat_id, "❓ <b>%s</b> %s\n\n%s" % (F("FREQUENTLY ASKED"), DIV, F("Pick a topic:")), FAQ_ROWS)
        return
    if cmd == "/tickets":
        mine = [t for t in load_objects("sup_ticket", 200) if str(t.get("user")) == str(uid)]
        frs = [r for r in load_objects("sup_frq", 100) if str(r.get("user")) == str(uid)]
        if not mine and not frs:
            send(chat_id, "🎫 <b>%s</b> %s\n\n<i>%s</i>" % (F("MY TICKETS"), DIV, F("No tickets yet.")), menu_kb())
            return
        body = "\n\n".join(ticket_card(t) for t in mine[:6])
        if frs:
            body += "\n\n" + "\n\n".join(frq_card(r) for r in frs[:6])
        send(chat_id, "🎫 <b>%s</b> %s\n\n%s" % (F("MY TICKETS"), DIV, body), menu_kb())
        return
    if cmd == "/feedback":
        if fb_cd(str(uid)):
            send(chat_id, "⏳ %s" % F("You already sent feedback in the last 24 hours. Thank you!"), menu_kb())
            return
        set_state(chat_id, {"step": "fb_rate"})
        send(chat_id, "⭐ <b>%s</b> %s\n\n%s" % (F("RATE US"), DIV, F("How was your experience?")),
             [[("1★", "fb:1"), ("2★", "fb:2"), ("3★", "fb:3")], [("4★", "fb:4"), ("5★", "fb:5")]])
        return
    if cmd == "/hours":
        send(chat_id, "🕐 <b>%s</b> %s\n\n%s <code>%s</code>\n%s"
             % (F("SUPPORT HOURS"), DIV, F("Hours:"), esc(cfg("support_hours", "09:00-22:00 IST")),
                ("🟢 " + F("ONLINE now")) if is_online() else ("🔴 " + F("OFFLINE now"))), menu_kb())
        return
    if cmd == "/rules":
        send(chat_id, "📜 <b>%s</b> %s\n\n%s" % (F("RULES"), DIV,
             esc(cfg("support_rules", "1. Be respectful — abuse gets an instant ban.\n2. No spam, no flooding, no advertising.\n3. Never share your password or login code — staff will never ask.\n4. One live ticket at a time.\n5. File requests: one active request per person."))), menu_kb())
        return
    if admin and cmd in ("/admin", "/panel"):
        cmd_admin(chat_id, u)
        return

    if admin and cmd == "/ticketsall":
        cmd_tickets(chat_id, "open")
        return
    if admin and cmd == "/filereqs":
        cmd_frqs(chat_id, "pending")
        return
    if admin and cmd == "/feedbackstats":
        cmd_fbstats(chat_id)
        return
    if admin and cmd == "/admins":
        cmd_admins(chat_id)
        return
    if admin and cmd == "/addadmin":
        cmd_addadmin(chat_id, u, raw.split()[1] if len(raw.split()) > 1 else "")
        return
    if admin and cmd == "/removeadmin":
        cmd_removeadmin(chat_id, u, raw.split()[1] if len(raw.split()) > 1 else "")
        return
    if admin and cmd == "/broadcast":
        rest = raw[len("/broadcast"):].strip()
        if not rest:
            send(chat_id, "ℹ️ Usage: <code>/broadcast Your message here</code>")
            return
        cmd_broadcast(chat_id, rest)
        return
    if admin and cmd == "/sethours":
        cmd_sethours(chat_id, raw[len("/sethours"):].strip())
        return
    if admin and cmd == "/stats":
        cmd_stats(chat_id)
        return
    if cmd:
        send(chat_id, "❓ <b>%s</b>\n\n%s" % (F("UNKNOWN COMMAND"), F("Use /start for the menu.")), menu_kb())
        return

    # ---- state machine (private only) ------------------------------------
    if st:
        step = st.get("step", "")
        if step.startswith("frq_"):
            frq_advance(chat_id, st, raw)
            return
        if step == "fb_text":
            if len(raw) < 3 and raw != "/skip":
                send(chat_id, "✏️ %s" % F("Send a few words (or /skip):"))
                return
            fb_save(chat_id, u, st.get("rating", 5), "" if raw == "/skip" else raw, st.get("category", "general"))
            return
        if step == "fb_rate":
            send(chat_id, "⭐ %s" % F("Tap a star button first."), menu_kb())
            return
        if step == "bc":
            send(chat_id, "📢 %s" % F("Tap ✅ Send or ❌ Cancel."), menu_kb())
            return

    # ---- live ticket relay -------------------------------------------------
    if private:
        t = open_live(uid)
        if t:
            key = str(u.get("username") or "").lower()
            if admin and t.get("status") == "claimed" and str(t.get("assigned", "")).lower() == key:
                relay_admin_msg(t, u, raw)          # admin typing = reply to their user
            else:
                relay_user_msg(t, chat_id, raw)
            return

    # ---- keyword auto-reply (settings.support_auto_reply JSON) ------------
    try:
        auto = json.loads(cfg("support_auto_reply", "{}"))
    except Exception:
        auto = {}
    low = raw.lower()
    if isinstance(auto, dict):
        for k, v in auto.items():
            if k and str(k).lower() in low:
                send(chat_id, str(v), menu_kb())
                return
    send(chat_id, HELP_TEXT, menu_kb())

# === CALLBACK ROUTER ========================================================
def handle_callback(q):
    chat_id = (q.get("message") or {}).get("chat", {}).get("id") or q.get("from", {}).get("id")
    u = q.get("from") or {}
    uid = u.get("id")
    data = str(q.get("data") or "")
    if not chat_id:
        return
    ensure_user(u)
    remember_chat(u)
    admin = is_admin(u)
    try:
        tg("answerCallbackQuery", {"callback_query_id": str(q.get("id"))})
    except Exception:
        pass
    parts = data.split(":")
    ns = parts[0]

    # ---- main menu ---------------------------------------------------------
    if ns == "m":
        clear_state(chat_id)
        item = parts[1] if len(parts) > 1 else "menu"
        if item == "menu":
            send(chat_id, welcome_text(), menu_kb())
        elif item == "live":
            start_live(u, chat_id)
        elif item == "file":
            set_state(chat_id, {"step": "frq_name"})
            send(chat_id, "📁 <b>%s</b> %s\n\n%s" % (F("REQUEST A FILE"), DIV,
                 F("What file, app or mod apk do you need? Send its name.")))
        elif item == "fb":
            if fb_cd(str(uid)):
                send(chat_id, "⏳ %s" % F("You already sent feedback in the last 24 hours."), menu_kb())
            else:
                set_state(chat_id, {"step": "fb_rate"})
                send(chat_id, "⭐ <b>%s</b> %s\n\n%s" % (F("RATE US"), DIV, F("How was your experience?")),
                     [[("1★", "fb:1"), ("2★", "fb:2"), ("3★", "fb:3")], [("4★", "fb:4"), ("5★", "fb:5")]])
        elif item == "faq":
            send(chat_id, "❓ <b>%s</b> %s\n\n%s" % (F("FREQUENTLY ASKED"), DIV, F("Pick a topic:")), FAQ_ROWS)
        elif item == "tickets":
            handle_message({"chat": {"id": chat_id, "type": "private"}, "from": u, "text": "/tickets"})
        elif item == "stats":
            mine = [t for t in load_objects("sup_ticket", 200) if str(t.get("user")) == str(uid)]
            frs = [r for r in load_objects("sup_frq", 100) if str(r.get("user")) == str(uid)]
            myfb = [r for r in load_objects("sup_fb", 300) if str(r.get("user")) == str(uid)]
            avg = (sum(int(r.get("rating", 0)) for r in myfb) / len(myfb)) if myfb else 0
            first = min([x.get("created", int(time.time())) for x in mine + frs + myfb] or [int(time.time())])
            days = (int(time.time()) - first) // 86400
            send(chat_id, "📊 <b>%s</b> %s\n\n🎫 %s <b>%d</b>\n📁 %s <b>%d</b>\n⭐ %s <b>%d</b> · 🌟 %.1f\n🧾 %s <b>%d</b> %s"
                 % (F("MY STATS"), DIV, F("Tickets"), len(mine), F("File requests"), len(frs),
                    F("Feedback"), len(myfb), avg, F("Member for"), days, F("days")), menu_back())
        elif item == "news":
            send(chat_id, "🔔 <b>%s</b> %s\n\n%s" % (F("ANNOUNCEMENTS"), DIV,
                 esc(cfg("support_news", "No announcements right now. Check back soon!"))), menu_back())
        elif item == "rules":
            send(chat_id, "📜 <b>%s</b> %s\n\n%s" % (F("RULES"), DIV,
                 esc(cfg("support_rules", "1. Be respectful — abuse gets an instant ban.\n2. No spam, no flooding, no advertising.\n3. Never share your password or login code — staff will never ask.\n4. One live ticket at a time.\n5. File requests: one active request per person."))), menu_back())
        elif item == "hours":
            send(chat_id, "🕐 <b>%s</b> %s\n\n%s <code>%s</code>\n%s"
                 % (F("SUPPORT HOURS"), DIV, F("Hours:"), esc(cfg("support_hours", "09:00-22:00 IST")),
                    ("🟢 " + F("ONLINE now")) if is_online() else ("🔴 " + F("OFFLINE now"))), menu_back())
        elif item == "acct":
            send(chat_id, "👤 <b>%s</b> %s\n\n📛 %s\n🆔 <code>%s</code>\n\n🛍️ %s /start %s"
                 % (F("MY ACCOUNT"), DIV, esc(str(u.get("first_name") or "—")), uid,
                    F("Buy files in the store bot:"), F("there.")), menu_back())
        elif item == "credits":
            send(chat_id, "💎 <b>%s</b> %s\n\n%s" % (F("PROJECT CREDITS"), DIV,
                 credit("🚀 <b>Project:</b> PoppyGram\n👨‍💻 <b>Developer:</b> <a href=\"%s\">%s</a>\n👑 <b>Owner:</b> %s\n🆘 <b>Support:</b> @poppygramsupportbot" % (GITHUB_URL, GITHUB_USER, OWNER))), menu_back())
        return

    # ---- FAQ ---------------------------------------------------------------
    if ns == "faq":
        send(chat_id, FAQ_ANS.get(data, F("Topic not found.")),
             [[("❓ All topics", "m:faq"), ("🏠 Menu", "m:menu")]])
        return

    # ---- feedback stars ----------------------------------------------------
    if ns == "fb" and len(parts) > 1 and parts[1].isdigit():
        set_state(chat_id, {"step": "fb_text", "rating": int(parts[1]), "category": "general"})
        send(chat_id, "⭐ <code>%s/5</code> %s\n\n💬 %s\n\n<i>%s</i>"
             % (parts[1], DIV, F("Any details you want to share?"), F("Send /skip to finish.")))
        return

    # ---- file request priority --------------------------------------------
    if ns == "frq" and len(parts) > 2 and parts[1] == "p":
        frq_finalize(chat_id, u, parts[2])
        return

    # ---- broadcast ---------------------------------------------------------
    if ns == "bc":
        if not admin:
            return
        if parts[1] == "go":
            do_broadcast(chat_id, u)
        else:
            clear_state(chat_id)
            send(chat_id, "❌ %s" % F("Broadcast cancelled."))
        return

    # ---- user ticket actions ----------------------------------------------
    if ns == "u":
        if parts[1] == "close":
            t = get_obj("sup_ticket", parts[2])
            if t and str(t.get("user")) == str(uid):
                t["status"] = "closed"
                t["closed"] = int(time.time())
                save_obj("sup_ticket", t)
                audit("support.ticket_closed", "#%s by user" % t["id"])
                send(chat_id, "✅ <b>%s #%s</b>" % (F("TICKET CLOSED"), t["id"]),
                     [[("⭐ Rate the service", "m:fb")], [("🏠 Menu", "m:menu")]])
            else:
                send(chat_id, "❌ %s" % F("Ticket not found."))
        elif parts[1] == "frcancel":
            frq_set_status(chat_id, parts[2], "rejected", "Cancelled by user")
        return

    # ---- admin actions (ticket claim/close, file reqs, panel) --------------
    if ns == "a":
        if not admin:
            send(chat_id, "🔒 %s" % F("Admins only."))
            return
        act = parts[1] if len(parts) > 1 else ""
        if act == "tickets":
            cmd_tickets(chat_id, "open")
        elif act == "tk" and len(parts) > 2:
            cmd_tickets(chat_id, parts[2])
        elif act == "frqs":
            cmd_frqs(chat_id, "pending")
        elif act == "fr" and len(parts) > 2:
            cmd_frqs(chat_id, parts[2])
        elif act == "fbstats":
            cmd_fbstats(chat_id)
        elif act == "staff":
            cmd_admins(chat_id)
        elif act == "stats":
            cmd_stats(chat_id)
        elif act == "help":
            cmd_admin(chat_id, u)
        elif act == "claim" and len(parts) > 2:
            t = get_obj("sup_ticket", parts[2])
            if not t:
                send(chat_id, "❌ %s" % F("Ticket not found."))
            elif t.get("status") != "open":
                send(chat_id, "⚠️ %s" % F("Already claimed or closed."))
            else:
                t["status"] = "claimed"
                t["assigned"] = str(u.get("username") or "").lower()
                save_obj("sup_ticket", t)
                audit("support.ticket_claimed", "#%s by %s" % (t["id"], t["assigned"]))
                send(chat_id, "🔵 <b>%s #%s</b>\n\n💬 %s" % (F("CLAIMED"), t["id"],
                     F("Just type here — your messages relay straight to the user.")), ticket_kb(t, True))
                send(int(t["user"]), "🔵 <b>%s</b> %s\n\n🛡️ <b>%s</b> %s"
                     % (F("SUPPORT MANAGER JOINED"), DIV, esc(str(u.get("first_name") or t["assigned"])),
                        F("is handling your ticket.")))
        elif act == "close" and len(parts) > 2:
            t = get_obj("sup_ticket", parts[2])
            if not t:
                send(chat_id, "❌ %s" % F("Ticket not found."))
            else:
                t["status"] = "closed"
                t["closed"] = int(time.time())
                save_obj("sup_ticket", t)
                audit("support.ticket_closed", "#%s by %s" % (t["id"], u.get("username")))
                send(chat_id, "✅ <b>%s #%s</b>" % (F("CLOSED"), t["id"]))
                send(int(t["user"]), "✅ <b>%s #%s</b> %s\n\n%s"
                     % (F("TICKET CLOSED"), t["id"], DIV, F("Glad we could help! A quick rating means a lot:")),
                     [[("⭐ Rate us", "m:fb")], [("🏠 Menu", "m:menu")]])
        elif act == "who" and len(parts) > 2:
            t = get_obj("sup_ticket", parts[2])
            if t:
                send(chat_id, "👤 <b>%s</b>\n\n📛 %s\n🆔 <code>%s</code>\n🏷️ @%s"
                     % (F("USER INFO"), esc(t.get("name")), esc(t.get("user")), esc(t.get("uname") or "—")),
                     ticket_kb(t, True))
        elif act == "fapp" and len(parts) > 2:
            frq_set_status(chat_id, parts[2], "approved")
        elif act == "frej" and len(parts) > 2:
            frq_set_status(chat_id, parts[2], "rejected", "Not available right now")
        elif act == "fdel" and len(parts) > 2:
            frq_set_status(chat_id, parts[2], "delivered")
        return

    # ---- unknown callback: back to menu ------------------------------------
    send(chat_id, welcome_text(), menu_kb())

# === WEBHOOK ENTRY ==========================================================
def process_update(update):
    if not isinstance(update, dict):
        return
    if update.get("callback_query"):
        handle_callback(update["callback_query"])
    elif update.get("message"):
        msg = update["message"]
        if isinstance(msg.get("text"), str) or msg.get("document") is not None or isinstance(msg.get("caption"), str):
            handle_message(msg)
    # edited/channel posts etc. are silently ignored (never crash)

def remember_update(update_id):
    # Idempotent consume — same pattern as the store bot, separate keyspace
    # (sup_upd:*) so the two bots can never collide on processed_updates.
    if update_id is None:
        return True
    r = put_setting("sup_upd:%s" % update_id, str(int(time.time())))
    if r == "__DUP__":
        return False
    # keep the idempotency table from growing forever: drop rows older than 48h
    try:
        if int(update_id) % 50 == 0:
            cutoff = int(time.time()) - 172800
            for row in scan("sup_upd", 400):
                try:
                    if int(row["value"]) < cutoff:
                        del_setting(row["key"])
                except Exception:
                    pass
    except Exception:
        pass
    return True

class handler(BaseHTTPRequestHandler):
    server_version = "PoppygramSupport/1.0"

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        # Health probe: proves the token works without exposing it.
        global BOT_USERNAME
        try:
            if not BOT_USERNAME:
                BOT_USERNAME = str(tg("getMe").get("username") or "")
            self._json(200, {"ok": True, "bot": BOT_USERNAME, "webhook": "/api/support"})
        except Exception as e:
            self._json(500, {"ok": False, "error": str(e)[:200]})

    def do_POST(self):
        if self.path.split("?")[0] != "/api/support":
            self._json(404, {"error": "Not found"})
            return
        hdr = self.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
        if hdr != WEBHOOK_SECRET:
            self._json(403, {"error": "Forbidden"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            update = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            self._json(400, {"error": "Bad JSON"})
            return
        upd_id = update.get("update_id")
        try:
            if not remember_update(upd_id):
                self._json(200, {"ok": True, "duplicate": True})
                return
            process_update(update)
        except Exception as e:
            # Never let an exception escape the handler (an escaped exception
            # kills the response with a framework 500 instead of JSON).
            audit("support.error", str(e)[:300])
            chat_id = ((update.get("message") or {}).get("chat") or {}).get("id") \
                or ((update.get("callback_query") or {}).get("message") or {}).get("chat", {}).get("id")
            if chat_id:
                send(chat_id, "⚠️ <b>%s</b>\n\n<i>%s</i>\n\n🔄 %s"
                     % (F("TEMPORARY ERROR"), F("The request could not be completed."), F("Please try again.")))
            # 200 anyway so Telegram never retries a permanently failing update;
            # include a short reason for debugging in the response body.
            self._json(200, {"ok": False, "error": str(e)[:300]})
            return
        self._json(200, {"ok": True})

    def log_message(self, fmt, *args):
        pass                                   # silence Vercel access noise
