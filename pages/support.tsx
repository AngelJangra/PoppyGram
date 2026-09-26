// PoppyGram Support Webapp Shell
import { useEffect, useState } from "react";
// Global CSS is imported in pages/_app.tsx (Next.js requires all global
// stylesheet imports to live there — importing here breaks `next build`).

type Ticket = {
  id: number;
  kind: string;
  subject: string;
  status: string;
  assigned_to?: string;
  tg_user_id: string;
  username?: string;
  priority: string;
  created_at: string;
  updated_at: string;
};
type FileReq = {
  id: number;
  tg_user_id: string;
  username?: string;
  file_name: string;
  description?: string;
  priority: string;
  status: string;
  handled_by?: string;
  created_at: string;
};
type FeedItem = {
  id: number;
  username?: string;
  tg_user_id?: string;
  rating: number;
  text?: string;
  category?: string;
  created_at: string;
};
type BotAdmin = { username: string; active: boolean; added_by?: string };
type Tab = "stats" | "tickets" | "requests" | "feedback" | "staff" | "settings";

const api = async (path: string, options?: RequestInit) => {
  const r = await fetch(path, options);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String(d.error || d.message || "Request failed"));
  return d;
};
const fmtDate = (s: string) => new Date(s).toLocaleString("en-IN");
const statusColor = (s: string) =>
  s === "open" || s === "pending" || s === "claimed"
    ? "#fbbf24"
    : s === "approved"
      ? "#38bdf8"
      : s === "closed" || s === "rejected"
        ? "#f87171"
        : "#8b5cf6";
const prioIcon = (p: string) =>
  p === "urgent" ? "🔴" : p === "soon" ? "🟡" : "🟢";
function FANCY(s: string): string {
  let o = "";
  for (const ch of String(s)) {
    const c = ch.codePointAt(0) || 0;
    if (c >= 0x41 && c <= 0x5a) o += String.fromCodePoint(0x1d5a0 + (c - 0x41));
    else if (c >= 0x61 && c <= 0x7a)
      o += String.fromCodePoint(0x1d5ba + (c - 0x61));
    else o += ch;
  }
  return o;
}
function KV(p: { label: string; value: number | string | object }) {
  return (
    <div className="sp-kv-item">
      <span>{p.label}</span>
      <strong>
        {typeof p.value === "object"
          ? JSON.stringify(p.value)
          : String(p.value)}
      </strong>
    </div>
  );
}

function Header({ botUsername }: { botUsername: string }) {
  return (
    <header className="sp-header">
      <div className="sp-logo">
        <img src="/poppygram.png" alt="PoppyGram" /> PoppyGram
      </div>
      <nav className="sp-nav">
                <a href={`https://t.me/${botUsername || "poppygram"}`}>Main bot</a>
                <a
          href="https://t.me/poppygramsupportbot"
          target="_blank"
          rel="noopener"
        >
          Support bot
        </a>
        <a
          href="https://github.com/AngelJangra/PoppyGram"
          target="_blank"
          rel="noopener"
        >
          GitHub
        </a>
        <a href="/support" className="sp-active">
          Support
        </a>
        <a href="/admin">Admin console</a>
      </nav>
    </header>
  );
}

function StatsView() {
  const [stats, setStats] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api("/api/admin/support?tab=stats")
      .then((d) => setStats(d.stats))
      .catch((e) => setErr(String(e?.message)));
  }, []);
  if (err) return <div className="sp-err">{err}</div>;
  if (!stats) return <div className="sp-loading">Loading…</div>;
  return (
    <section className="sp-section">
      <h2>📊 {FANCY("Overview")}</h2>
      <div className="sp-kv">
        <KV label="Tickets" value={stats.tickets} />
        <KV label="Requests" value={stats.file_requests} />
        <KV label="Feedback" value={stats.feedback} />
      </div>
    </section>
  );
}

function TicketsView() {
  const [list, setList] = useState<Ticket[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => {
    api("/api/admin/support?tab=tickets")
      .then((d) => setList(d.tickets || []))
      .catch((e) => setErr(String(e?.message)));
  }, []);
  if (err) return <div className="sp-err">{err}</div>;
  const unread = list.filter((t) => t.status === "open");
  return (
    <section className="sp-section">
      <h2>
        🎫 {FANCY("Tickets")}
        <span className="sp-sub">
          {" "}
          {unread.length} open · {list.length} total
        </span>
      </h2>
      {!list.length ? (
        <p className="sp-empty">No tickets yet.</p>
      ) : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th>#</th>
                <th>User</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Assign</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <td>{t.id}</td>
                  <td>
                    {t.username ? `@${t.username}` : ""}
                    <br />
                    <small>{String(t.tg_user_id)}</small>
                  </td>
                  <td>
                    {prioIcon(t.priority)} {t.kind}
                  </td>
                  <td style={{ color: statusColor(t.status) }}>{t.status}</td>
                  <td>{t.assigned_to || "—"}</td>
                  <td>{fmtDate(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RequestsView() {
  const [list, setList] = useState<FileReq[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => {
    api("/api/admin/support?tab=requests")
      .then((d) => setList(d.requests || []))
      .catch((e) => setErr(String(e?.message)));
  }, []);
  if (err) return <div className="sp-err">{err}</div>;
  return (
    <section className="sp-section">
      <h2>
        📁 {FANCY("File Requests")}{" "}
        <span className="sp-sub">
          {list.filter((r) => r.status === "pending").length} pending
        </span>
      </h2>
      {!list.length ? (
        <p className="sp-empty">No file requests.</p>
      ) : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th>#</th>
                <th>File</th>
                <th>Pri</th>
                <th>Status</th>
                <th>Who</th>
                <th>Since</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.file_name}</td>
                  <td>
                    {prioIcon(r.priority)} {r.priority}
                  </td>
                  <td style={{ color: statusColor(r.status) }}>{r.status}</td>
                  <td>{r.handled_by || "—"}</td>
                  <td>{fmtDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FeedbackView() {
  const [list, setList] = useState<FeedItem[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => {
    api("/api/admin/support?tab=feedback")
      .then((d) => setList(d.feedback || []))
      .catch((e) => setErr(String(e?.message)));
  }, []);
  if (err) return <div className="sp-err">{err}</div>;
  const avg = list.length
    ? (list.reduce((a, f) => a + f.rating, 0) / list.length).toFixed(2)
    : "—";
  return (
    <section className="sp-section">
      <h2>
        ⭐ {FANCY("Feedback")}{" "}
        <span className="sp-sub">
          avg {avg} / 5 from {list.length}
        </span>
      </h2>
      {!list.length ? (
        <p className="sp-empty">No feedback yet.</p>
      ) : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <thead>
              <tr>
                <th>⭐</th>
                <th>User</th>
                <th>Category</th>
                <th>Comment</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {list.map((f) => (
                <tr key={f.id}>
                  <td>{f.rating}/5</td>
                  <td>
                    {f.username ? `@${f.username}` : `ID ${f.tg_user_id}`}
                  </td>
                  <td>{f.category || "general"}</td>
                  <td>{f.text || ""}</td>
                  <td>{fmtDate(f.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StaffView() {
  const [staff, setStaff] = useState<BotAdmin[]>([]);
  const [err, setErr] = useState("");
  const [newU, setNewU] = useState("");
  const load = () => {
    api("/api/admin/support?tab=staff")
      .then((d) => setStaff(d.staff || []))
      .catch(setErr);
  };
  useEffect(load, []);
  const toggle = async (a: BotAdmin) => {
    try {
      await api("/api/admin/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggleadmin",
          username: a.username,
          admin_username: "admin",
        }),
      });
      await load();
    } catch (e: any) {
      setErr(String(e?.message));
    }
  };
  const add = async () => {
    if (!newU.trim()) return;
    try {
      await api("/api/admin/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "addadmin",
          username: newU.trim(),
          admin_username: "admin",
        }),
      });
      setNewU("");
      await load();
    } catch (e: any) {
      setErr(String(e?.message));
    }
  };
  if (err) return <div className="sp-err">{err}</div>;
  return (
    <section className="sp-section">
      <h2>🛡️ {FANCY("Staff")}</h2>
      <table className="sp-table">
        <thead>
          <tr>
            {" "}
            <th>Username</th>
            <th>Added by</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.username}>
              <td>@{s.username}</td>
              <td>{s.added_by || "—"}</td>
              <td style={{ color: s.active ? "#4ade80" : "#f87171" }}>
                {s.active ? "active" : "inactive"}
              </td>
              <td>
                {s.username !== "drangeljangra" ? (
                  <button
                    className="sp-btn sp-btn-sm"
                    onClick={() => toggle(s)}
                  >
                    {s.active ? "Deactivate" : "Activate"}
                  </button>
                ) : (
                  "👑"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sp-add-row">
        <input
          className="sp-input"
          value={newU}
          onChange={(e) => setNewU(e.target.value)}
          placeholder="@username"
        />
        <button className="sp-btn sp-btn-sm" onClick={add}>
          Add
        </button>
      </div>
    </section>
  );
}

function SettingsView() {
  const [set, setSet] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [k, setK] = useState("");
  const [v, setV] = useState("");
  const load = () => {
    api("/api/admin/support?tab=settings")
      .then((d: any) => {
        const m: Record<string, string> = {};
        for (const s of d.settings || []) m[s.key] = s.value;
        return setSet(m);
      })
      .catch(setErr);
  };
  useEffect(load, []);
  const save = async () => {
    if (!k.trim()) return;
    try {
      await api("/api/admin/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "setsetting",
          key: k.trim(),
          value: v,
          admin_username: "admin",
        }),
      });
      setK("");
      setV("");
      await load();
    } catch (e: any) {
      setErr(String(e?.message));
    }
  };
  if (err) return <div className="sp-err">{err}</div>;
  return (
    <section className="sp-section">
      <h2>⚙️ {FANCY("Settings")}</h2>
      <div className="sp-kv">
        {Object.entries(set).map(([key, val]) =>
          KV({ label: key, value: val }),
        )}
      </div>
      <hr className="sp-hr" />
      <div className="sp-row">
        <input
          className="sp-input"
          value={k}
          onChange={(e) => setK(e.target.value)}
          placeholder="key"
        />
        <input
          className="sp-input"
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="value"
        />
        <button className="sp-btn sp-btn-sm" onClick={save}>
          Save
        </button>
      </div>
      {(k === "support_faq" || k === "support_auto_reply") && (
        <p className="sp-hint">Must be valid JSON.</p>
      )}
    </section>
  );
}

export default function Support() {
  const [tab, setTab] = useState<Tab>("stats");
  const [botUsername, setBotUsername] = useState("");
  useEffect(() => {
    fetch("/api/web/session").then((r) => r.json()).then((d) => setBotUsername(d.bot_username || "")).catch(() => {});
  }, []);
  return (
    <div className="sp-page-wrapper">
      <>
                <Header botUsername={botUsername} />
        <main className="sp-main">
          <aside className="sp-sidebar">
            <button
              className={"sp-navbtn " + (tab === "stats" ? "sp-active" : "")}
              onClick={() => setTab("stats")}
            >
              Stats
            </button>
            <button
              className={"sp-navbtn " + (tab === "tickets" ? "sp-active" : "")}
              onClick={() => setTab("tickets")}
            >
              Tickets
            </button>
            <button
              className={"sp-navbtn " + (tab === "requests" ? "sp-active" : "")}
              onClick={() => setTab("requests")}
            >
              Requests
            </button>
            <button
              className={"sp-navbtn " + (tab === "feedback" ? "sp-active" : "")}
              onClick={() => setTab("feedback")}
            >
              Feedback
            </button>
            <button
              className={"sp-navbtn " + (tab === "staff" ? "sp-active" : "")}
              onClick={() => setTab("staff")}
            >
              Staff
            </button>
            <button
              className={"sp-navbtn " + (tab === "settings" ? "sp-active" : "")}
              onClick={() => setTab("settings")}
            >
              Settings
            </button>
            <div className="sp-footer">
              ⚡ by{" "}
              <a href="https://github.com/AngelJangra/PoppyGram">AngelJangra</a>
            </div>
          </aside>
          <section className="sp-content">
            {tab === "stats" && <StatsView />}
            {tab === "tickets" && <TicketsView />}
            {tab === "requests" && <RequestsView />}
            {tab === "feedback" && <FeedbackView />}
            {tab === "staff" && <StaffView />}
            {tab === "settings" && <SettingsView />}
          </section>
        </main>
      </>
    </div>
  );
}
