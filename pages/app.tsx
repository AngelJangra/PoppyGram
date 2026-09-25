// ---------------------------------------------------------------------------
// PoppyGram User Webapp — /app
// Browser-based interface for the store bot + support bot with Telegram login.
// Users click "Login with Telegram" → widget verifies them → session cookie
// stored → all bot features available (browse, buy, support chat).
// ---------------------------------------------------------------------------
"use client";
import { useEffect, useState, useRef } from "react";
import {
  ShoppingCart, History, HelpCircle, Send, FileText,
  User, RefreshCw, Download, Search, X, LogOut,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────
type Product = {
  id: number; name: string; description: string;
  price: number; file_name: string; file_size: number;
  photo_id: string | null; created_at: string;
};
type Purchase = {
  id: number; product_id: number; price: number; created_at: string;
  store_products: { name: string; file_name: string; price: number; description: string };
};
type Ticket = { id: number; subject: string; status: string; priority: string; created_at: string; updated_at: string };
type SupportMessage = {
  id: number; ticket_id: number; sender_role: string; text: string; file_id?: string; created_at: string;
};
type Me = {
  tg_user_id: string; username: string; first_name: string; last_name: string;
  credit: number; auth_verified: boolean; unlimited: boolean; can_claim_freecredits: boolean;
};
type Tab = "store" | "purchases" | "support" | "profile";
const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: "store", label: "Store", icon: ShoppingCart },
  { id: "purchases", label: "My Purchases", icon: History },
  { id: "support", label: "Support", icon: HelpCircle },
  { id: "profile", label: "Profile", icon: User },
];
const api = async (path: string, options?: RequestInit) => {
  const r = await fetch(path, options);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(String(d.error || d.message || d || "Request failed"));
  return d;
};

// ── Telegram Login Widget ────────────────────────────────────────────────────
function TelegramLogin({ onLogin }: { onLogin: () => void }) {
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (window as any).onTelegramAuth = (user: any) => {
      fetch("/api/web/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(user),
      }).then(async (r) => {
        const d = await r.json();
        if (d.ok) onLogin();
        else alert("Login failed: " + (d.error || "unknown error"));
      }).catch(() => alert("Login request failed"));
    };
    fetch("/api/web/session").then((r) => r.json()).then((d) => {
      setBotUsername(d.bot_username || "");
      setLoading(false);
      if (d.bot_username && containerRef.current) {
        const script = document.createElement("script");
        script.src = "https://telegram.org/js/telegram-widget.js?app=PoppyGram";
        script.async = true;
        script.setAttribute("data-telegram-login", d.bot_username);
        script.setAttribute("data-size", "large");
        script.setAttribute("data-onauth", "onTelegramAuth");
        script.setAttribute("data-request-access", "write");
        containerRef.current.innerHTML = "";
        containerRef.current.appendChild(script);
      }
    });
  }, [onLogin]);
  const [botUsername, setBotUsername] = useState("");

  if (loading) return <div className="wa-loading">Loading login…</div>;
  return <div ref={containerRef} className="wa-tg-login-container" />;
}

// ── Header ───────────────────────────────────────────────────────────────────
function WebAppHeader({
  user, onLogout,
}: { user: Me | null; onLogout: () => void }) {
  return (
    <header className="wa-header">
      <div className="wa-header-inner">
        <div className="wa-logo">
          <span className="wa-logo-icon">💎</span>
          <span className="wa-logo-text">PoppyGram</span>
        </div>
        <div className="wa-bot-links">
          <a href="https://t.me/poppygram" target="_blank" rel="noopener noreferrer">🛍️ Store Bot</a>
          <span>|</span>
          <a href="https://t.me/poppygramsupportbot" target="_blank" rel="noopener noreferrer">🛡️ Support Bot</a>
        </div>
      </div>
      {user && (
        <div className="wa-user-bar">
          <User size={16} />
          <span>{user.first_name || user.username || `ID ${user.tg_user_id}`}</span>
          <span className="wa-user-balance">💰 {user.unlimited ? "∞" : user.credit}</span>
          <button className="wa-btn-small wa-btn-ghost" onClick={onLogout}>
            <LogOut size={14} /> Logout
          </button>
        </div>
      )}
    </header>
  );
}

// ── ProductCard ──────────────────────────────────────────────────────────────
function ProductCard({ p, onBuy }: { p: Product; onBuy: (p: Product) => void }) {
  const [imgErr, setImgErr] = useState(false);
  return (
    <div className="wa-card wa-product-card">
      {p.photo_id && !imgErr ? (
        <img src={`/api/web/photo?id=${p.photo_id}`} alt={p.name}
          onError={() => setImgErr(true)} className="wa-product-img" />
      ) : (
        <div className="wa-product-placeholder">📦</div>
      )}
      <div className="wa-product-body">
        <h3 className="wa-product-name">{p.name}</h3>
        {p.description && <p className="wa-product-desc">{p.description}</p>}
        <div className="wa-product-meta">
          <span className="wa-product-price">{p.price === 0 ? "FREE" : `${p.price} credits`}</span>
          <span className="wa-product-file">{p.file_name}</span>
          {p.file_size > 0 && <span className="wa-product-size">{(p.file_size / 1024).toFixed(1)} KB</span>}
        </div>
        <button className="wa-btn wa-btn-primary wa-buy-btn" onClick={() => onBuy(p)}>
          <Download size={16} /> {p.price === 0 ? "Get" : `Buy (${p.price})`}
        </button>
      </div>
    </div>
  );
}

// ── StoreTab ─────────────────────────────────────────────────────────────────
function StoreTab({
  products, loading, onBuy,
}: { products: Product[]; loading: boolean; onBuy: (p: Product) => void }) {
  const [q, setQ] = useState("");
  const [filtered, setFiltered] = useState<Product[]>(products);
  useEffect(() => {
    if (!q.trim()) { setFiltered(products); return; }
    const lower = q.toLowerCase();
    setFiltered(products.filter((p) =>
      p.name.toLowerCase().includes(lower) ||
      p.description.toLowerCase().includes(lower) ||
      p.file_name.toLowerCase().includes(lower)));
  }, [q, products]);
  if (loading) return <div className="wa-loading">Loading products…</div>;
  if (!products.length) return (
    <div className="wa-empty"><ShoppingCart size={48} /><p>No products available yet.</p></div>
  );
  return (
    <div className="wa-store">
      <div className="wa-search-bar">
        <Search size={18} />
        <input type="text" placeholder="Search products…" value={q}
          onChange={(e) => setQ(e.target.value)} />
        {q && <X size={14} onClick={() => setQ("")} className="wa-search-clear" />}
      </div>
      <div className="wa-product-grid">
        {filtered.map((p) => <ProductCard key={p.id} p={p} onBuy={onBuy} />)}
      </div>
    </div>
  );
}

// ── PurchasesTab ─────────────────────────────────────────────────────────────
function PurchasesTab({ purchases }: { purchases: Purchase[] }) {
  if (!purchases.length)
    return (
      <div className="wa-empty"><History size={48} /><p>No purchases yet. Browse the Store!</p></div>
    );
  return (
    <div className="wa-purchases">
      {purchases.map((p) => (
        <div key={p.id} className="wa-card wa-purchase-row">
          <div className="wa-purchase-info">
            <h3>{p.store_products?.name || "Unknown product"}</h3>
            <span>📄 {p.store_products?.file_name || "Unknown file"}</span>
            <span>💰 Paid: {p.price} credits</span>
            <span>📅 {new Date(p.created_at).toLocaleDateString("en-IN")}</span>
          </div>
          <Download size={20} className="wa-purchase-icon" />
        </div>
      ))}
    </div>
  );
}

// ── SupportTab ────────────────────────────────────────────────────────────────
function SupportTab({
  faq, tickets, tgId,
  onTicketCreate, onFileRequest, onRefresh,
}: {
  faq: Record<string, string>; tickets: Ticket[]; tgId: string;
  onTicketCreate: (subject: string, message: string) => Promise<void>;
  onFileRequest: (fileName: string, description: string, sourceLink: string) => Promise<void>;
  onRefresh: () => void;
}) {
  const [section, setSection] = useState<"faq" | "ticket" | "filereq" | "tickets" | "messages">("faq");
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [polling, setPolling] = useState(false);
  const [ticketForm, setTicketForm] = useState({ subject: "", message: "" });
  const [fileForm, setFileForm] = useState({ file_name: "", description: "", source_link: "" });

  // Poll for messages every 5s when viewing a ticket
  useEffect(() => {
    if (section !== "messages" || !activeTicket || !tgId) return;
    setPolling(true);
    let cancelled = false;
    const fetchMessages = async () => {
      try {
        const d = await api(`/api/web/messages?ticket_id=${activeTicket.id}&tg_user_id=${tgId}`);
        if (!cancelled) setMessages(d.messages || []);
      } catch {}
    };
    fetchMessages();
    const timer = setInterval(fetchMessages, 5000);
    return () => { cancelled = true; clearInterval(timer); setPolling(false); };
  }, [section, activeTicket, tgId]);

  const openTicket = (t: Ticket) => { setActiveTicket(t); setSection("messages"); };
  const backToList = () => { setActiveTicket(null); setMessages([]); setSection("tickets"); };

  const handleTicket = async (e: React.FormEvent) => {
    e.preventDefault(); await onTicketCreate(ticketForm.subject, ticketForm.message);
    setTicketForm({ subject: "", message: "" }); setSection("tickets"); onRefresh();
  };
  const handleFile = async (e: React.FormEvent) => {
    e.preventDefault(); await onFileRequest(fileForm.file_name, fileForm.description, fileForm.source_link);
    setFileForm({ file_name: "", description: "", source_link: "" }); setSection("tickets"); onRefresh();
  };

  return (
    <div className="wa-support">
      <div className="wa-support-nav">
        <button className={section === "faq" ? "wa-btn-small wa-btn-active" : "wa-btn-small"} onClick={() => setSection("faq")}>FAQ</button>
        <button className={section === "ticket" ? "wa-btn-small wa-btn-active" : "wa-btn-small"} onClick={() => setSection("ticket")}>New Ticket</button>
        <button className={section === "filereq" ? "wa-btn-small wa-btn-active" : "wa-btn-small"} onClick={() => setSection("filereq")}>Request File</button>
        <button className={section === "tickets" ? "wa-btn-small wa-btn-active" : "wa-btn-small"} onClick={() => setSection("tickets")}>My Tickets</button>
        {section === "messages" && activeTicket && (
          <span className="wa-nav-back" onClick={backToList}>← Tickets</span>
        )}
      </div>

      {section === "faq" && (
        <div className="wa-faq">
          {Object.entries(faq).length === 0 && <p>Loading FAQ…</p>}
          {Object.entries(faq).map(([q, a]) => (
            <details key={q} className="wa-faq-item">
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      )}

      {section === "ticket" && (
        <form className="wa-form" onSubmit={handleTicket}>
          <h3>Create Support Ticket</h3>
          <input type="text" placeholder="Subject" value={ticketForm.subject}
            onChange={(e) => setTicketForm({ ...ticketForm, subject: e.target.value })} required maxLength={200} />
          <textarea placeholder="Describe your issue…" value={ticketForm.message}
            onChange={(e) => setTicketForm({ ...ticketForm, message: e.target.value })} required maxLength={2000} rows={5} />
          <button type="submit" className="wa-btn wa-btn-primary" disabled={!tgId}>
            <Send size={16} /> Submit Ticket
          </button>
        </form>
      )}

      {section === "filereq" && (
        <form className="wa-form" onSubmit={handleFile}>
          <h3>Request a File</h3>
          <input type="text" placeholder="File name" value={fileForm.file_name}
            onChange={(e) => setFileForm({ ...fileForm, file_name: e.target.value })} required maxLength={255} />
          <textarea placeholder="Description (optional)" value={fileForm.description}
            onChange={(e) => setFileForm({ ...fileForm, description: e.target.value })} maxLength={2000} rows={4} />
          <input type="url" placeholder="Source link (optional)" value={fileForm.source_link}
            onChange={(e) => setFileForm({ ...fileForm, source_link: e.target.value })} maxLength={500} />
          <button type="submit" className="wa-btn wa-btn-primary" disabled={!tgId}>
            <FileText size={16} /> Submit Request
          </button>
        </form>
      )}

      {section === "tickets" && (
        <div className="wa-tickets">
          {!tgId && <p className="wa-muted">Log in to view your tickets.</p>}
          {tgId && tickets.length === 0 && (
            <div className="wa-empty"><HelpCircle size={24} /><p>No tickets yet. Open one above!</p></div>
          )}
          {tickets.map((t) => (
            <div key={t.id} className="wa-card wa-ticket-row" onClick={() => openTicket(t)}>
              <div className="wa-ticket-info">
                <h3>{t.subject || "(no subject)"}</h3>
                <span className={`wa-badge wa-badge-${t.status}`}>{t.status}</span>
              </div>
              <small>#{t.id} · {new Date(t.created_at).toLocaleDateString("en-IN")}</small>
            </div>
          ))}
        </div>
      )}

      {section === "messages" && activeTicket && (
        <div className="wa-messages">
          <div className="wa-msg-header">
            <h3>Ticket #{activeTicket.id}: {activeTicket.subject || "(no subject)"}</h3>
            <span className={`wa-badge wa-badge-${activeTicket.status}`}>{activeTicket.status}</span>
          </div>
          <div className="wa-msg-list">
            {messages.length === 0 ? (
              <p className="wa-muted">No messages yet. A support manager will reply shortly.</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={`wa-msg ${m.sender_role === "admin" ? "wa-msg-admin" : "wa-msg-user"}`}>
                  <div className="wa-msg-bubble">
                    <span className="wa-msg-sender">{m.sender_role === "admin" ? "🛡️ Support" : "👤 You"}</span>
                    <p className="wa-msg-text">{m.text}</p>
                    <small className="wa-msg-time">
                      {new Date(m.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                    </small>
                  </div>
                </div>
              ))
            )}
          </div>
          {polling && <div className="wa-msg-polling">🔄 Checking for new messages…</div>}
        </div>
      )}
    </div>
  );
}

// ── ProfileTab ───────────────────────────────────────────────────────────────
function ProfileTab({
  me, onClaim, onRefresh,
}: { me: Me | null; onClaim: () => Promise<void>; onRefresh: () => void }) {
  const [claiming, setClaiming] = useState(false);
  const handleClaim = async () => {
    setClaiming(true);
    try { await onClaim(); onRefresh(); }
    finally { setClaiming(false); }
  };
  if (!me) return <div className="wa-loading">Loading profile…</div>;
  return (
    <div className="wa-profile">
      <div className="wa-card wa-profile-card">
        <User size={48} className="wa-profile-icon" />
        <h2>{me.first_name || me.username || `User ${me.tg_user_id}`}</h2>
        {me.username && <span className="wa-username">@{me.username}</span>}
        <div className="wa-balance-card">
          <RefreshCw size={20} onClick={onRefresh} className="wa-balance-refresh" />
          <div className="wa-balance-amount">{me.unlimited ? "UNLIMITED" : `${me.credit}`}</div>
          <span className="wa-balance-label">credits</span>
        </div>
      </div>
      <div className="wa-card">
        <h3>Account Status</h3>
        <div className="wa-status-grid">
          <div className="wa-status-row">
            <span>Verified</span>
            <span className={`wa-badge ${me.auth_verified ? "wa-badge-green" : "wa-badge-gray"}`}>
              {me.auth_verified ? "Yes" : "No"}
            </span>
          </div>
          <div className="wa-status-row">
            <span>Unlimited Access</span>
            <span className={`wa-badge ${me.unlimited ? "wa-badge-green" : "wa-badge-gray"}`}>
              {me.unlimited ? "Yes" : "No"}
            </span>
          </div>
        </div>
        {!me.auth_verified && (
          <div className="wa-note">
            <p>To claim free credits and authenticate your account:</p>
            <ol>
              <li>Open the PoppyGram bot in Telegram.</li>
              <li>Send <code>/auth</code>.</li>
              <li>Open the verification link and complete login.</li>
              <li>Refresh this page to update your status.</li>
            </ol>
          </div>
        )}
      </div>
      <div className="wa-card">
        <h3>Free Credits</h3>
        <p>Claim 100 free credits after verifying your Telegram account. One claim per 24 hours.</p>
        <button className="wa-btn wa-btn-primary" onClick={handleClaim}
          disabled={claiming || !me.can_claim_freecredits}>
          {claiming ? "Claiming…" : "Claim 100 Credits"}
        </button>
        {!me.can_claim_freecredits && me.auth_verified && !me.unlimited && (
          <small>Already claimed or on cooldown.</small>
        )}
      </div>
      <div className="wa-card">
        <h3>Quick Links</h3>
        <div className="wa-links">
          <a href="https://t.me/poppygram" target="_blank" rel="noopener noreferrer" className="wa-link">
            💎 PoppyGram Store Bot
          </a>
          <a href="https://t.me/poppygramsupportbot" target="_blank" rel="noopener noreferrer" className="wa-link">
            🛡️ PoppyGram Support Bot
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Main App ────────────────────────────────────────────────────────────────
export default function WebApp() {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("store");
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [faq, setFaq] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    const init = async () => {
      try {
        const [session, p, f] = await Promise.all([
          api("/api/web/session"),
          api("/api/web/products"),
          api("/api/web/faq"),
        ]);
        if (session.user) setUser(session.user);
        setProducts(p.products || []);
        setFaq(f.faq || {});
      } catch (e: any) { setError(e.message || "Failed to load data"); }
      finally { setLoading(false); }
    };
    init();
  }, []);

  const loadUserData = async () => {
    if (!user) return;
    try {
      const [h, t] = await Promise.all([
        api(`/api/web/history?id=${user.tg_user_id}`),
        api(`/api/web/ticket?id=${user.tg_user_id}`),
      ]);
      setPurchases(h.purchases || []);
      setTickets(t.tickets || []);
    } catch (e: any) { setError(e.message || "Failed to load user data"); }
  };
  const refresh = () => { loadUserData(); };
  useEffect(() => { loadUserData(); }, [user]);

  const handleLogout = async () => {
    await api("/api/web/logout", { method: "POST" });
    setUser(null);
    window.location.reload();
  };
  const handleLogin = () => {
    api("/api/web/session").then((s) => { if (s.user) setUser(s.user); }).catch(() => {});
  };

  const handleBuy = async (p: Product) => {
    if (!user) { alert("Please log in with Telegram first."); return; }
    const confirmed = confirm(`Purchase "${p.name}" for ${p.price} credits?\n\nThe file will be delivered to your Telegram account.`);
    if (!confirmed) return;
    try {
      const result = await api("/api/web/purchase", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tg_user_id: user.tg_user_id, product_id: p.id, expected_price: p.price }),
      });
      if (result.ok) {
        alert(`✅ Purchase successful!\n\nNew balance: ${result.unlimited ? "UNLIMITED" : result.balance} credits\n📦 File delivered to your Telegram.`);
        refresh();
      } else { alert(`❌ ${result.error || "Purchase failed"}`); }
    } catch (e: any) { alert(`❌ ${e.message || "Purchase failed"}`); }
  };

  const handleTicketCreate = async (subject: string, message: string) => {
    if (!user) { alert("Please log in with Telegram first."); return; }
    try {
      const result = await api("/api/web/ticket", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tg_user_id: user.tg_user_id, subject, message, username: user.username }),
      });
      alert(`✅ Ticket #${result.ticket.id} created. A support manager will reply shortly.`);
    } catch (e: any) { alert(`❌ ${e.message}`); }
  };

  const handleFileRequest = async (fileName: string, description: string, sourceLink: string) => {
    if (!user) { alert("Please log in with Telegram first."); return; }
    try {
      const result = await api("/api/web/filerequest", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tg_user_id: user.tg_user_id, file_name: fileName, description, source_link: sourceLink, username: user.username }),
      });
      alert(`✅ File request #${result.request.id} submitted. A support manager will review it.`);
    } catch (e: any) { alert(`❌ ${e.message}`); }
  };

  const handleClaim = async () => {
    if (!user) return;
    try {
      const result = await api("/api/web/freecredits", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tg_user_id: user.tg_user_id }),
      });
      alert(result.unlimited ? "✅ You have unlimited credits!" : `✅ Claimed! New balance: ${result.balance} credits`);
      refresh();
    } catch (e: any) { alert(`❌ ${e.message}`); }
  };

  return (
    <div className="sp-page-wrapper wa-app">
      <WebAppHeader user={user} onLogout={handleLogout} />

      {!user && (
        <div className="wa-login-section">
          <div className="wa-card wa-login-card">
            <h2>💎 Welcome to PoppyGram</h2>
            <p>Log in with your Telegram account to browse products, check balance, and contact support.</p>
            <TelegramLogin onLogin={handleLogin} />
            <p className="wa-login-note">You must have an active chat with @poppygram in Telegram.</p>
          </div>
        </div>
      )}

      {user && (
        <>
          <nav className="wa-tab-nav">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.id} className={`wa-tab-btn ${activeTab === t.id ? "wa-tab-active" : ""}`}
                  onClick={() => { setActiveTab(t.id); setError(""); }}>
                  <Icon size={18} />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </nav>

          {error && <div className="wa-error-banner">{error}</div>}

          <main className="wa-main">
            {activeTab === "store" && (
              <StoreTab products={products} loading={!products.length} onBuy={handleBuy} />
            )}
            {activeTab === "purchases" && <PurchasesTab purchases={purchases} />}
            {activeTab === "support" && (
              <SupportTab faq={faq} tickets={tickets} tgId={user.tg_user_id}
                onTicketCreate={handleTicketCreate} onFileRequest={handleFileRequest}
                onRefresh={() => { refresh(); loadUserData(); }} />
            )}
            {activeTab === "profile" && (
              <ProfileTab me={user} onClaim={handleClaim}
                onRefresh={() => { refresh(); loadUserData(); }} />
            )}
          </main>
        </>
      )}
    </div>
  );
}