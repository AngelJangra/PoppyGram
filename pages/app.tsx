// ---------------------------------------------------------------------------
// PoppyGram User Webapp — /app
// Browser-based interface for regular Telegram users to interact with both
// bots WITHOUT opening Telegram: browse products, purchase, check balance,
// read FAQ, create support tickets, request files.
// Users enter their Telegram user ID (shown by /profile in the bot).
// ---------------------------------------------------------------------------
"use client";
import { useEffect, useState } from "react";
import {
  ShoppingCart, History, HelpCircle, Send, FileText,
  User, RefreshCw, Download, Search, X,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────
type Product = {
  id: number;
  name: string;
  description: string;
  price: number;
  file_name: string;
  file_size: number;
  photo_id: string | null;
  created_at: string;
};
type Purchase = {
  id: number;
  product_id: number;
  price: number;
  created_at: string;
  store_products: { name: string; file_name: string; price: number; description: string };
};
type Ticket = {
  id: number;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
};
type Me = {
  tg_user_id: string;
  username: string;
  first_name: string;
  last_name: string;
  credit: number;
  auth_verified: boolean;
  unlimited: boolean;
  can_claim_freecredits: boolean;
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

// ── Telegram ID banner ─────────────────────────────────────────────────────
function TgIdBanner({ tgId, setTgId }: { tgId: string; setTgId: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = input.trim();
    if (!/^\d{6,15}$/.test(val)) {
      alert("Enter a valid Telegram user ID (6-15 digits). Find yours via /profile in the bot.");
      return;
    }
    setTgId(val);
    sessionStorage.setItem("poppygram_tg_id", val);
    setEditing(false);
  };

  const handleClear = () => {
    setTgId("");
    sessionStorage.removeItem("poppygram_tg_id");
    setEditing(true);
    setInput("");
  };

  if (!tgId && !editing) {
    return (
      <div className="wa-id-banner wa-id-missing">
        <User size={18} />
        <span>Enter your Telegram user ID to see your balance, purchases and tickets.</span>
        <button className="wa-btn-small" onClick={() => setEditing(true)}>Enter ID</button>
      </div>
    );
  }

  if (editing || !tgId) {
    return (
      <form className="wa-id-banner wa-id-input" onSubmit={handleSubmit}>
        <User size={18} />
        <input
          type="text" inputMode="numeric"
          placeholder="Telegram user ID (e.g. 123456789)"
          value={input} onChange={(e) => setInput(e.target.value)} autoFocus
        />
        <button type="submit" className="wa-btn-small" disabled={!input.trim()}>Save</button>
        {tgId && <button type="button" className="wa-btn-small wa-btn-ghost" onClick={() => setEditing(false)}>Cancel</button>}
      </form>
    );
  }

  return (
    <div className="wa-id-banner wa-id-ready">
      <User size={16} />
      <span>Telegram ID: <b>{tgId}</b></span>
      <button className="wa-btn-small wa-btn-ghost" onClick={handleClear}>Change</button>
    </div>
  );
}

// ── ProductCard ────────────────────────────────────────────────────────────
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

// ── StoreTab ────────────────────────────────────────────────────────────────
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
  if (!products.length)
    return (
      <div className="wa-empty">
        <ShoppingCart size={48} />
        <p>No products available yet.</p>
      </div>
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
      <div className="wa-empty">
        <History size={48} />
        <p>No purchases yet. Browse the Store to get started!</p>
      </div>
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

// ── SupportTab ──────────────────────────────────────────────────────────────
function SupportTab({
  faq, tickets, tgId,
  onTicketCreate, onFileRequest, onRefresh,
}: {
  faq: Record<string, string>;
  tickets: Ticket[];
  tgId: string;
  onTicketCreate: (subject: string, message: string) => Promise<void>;
  onFileRequest: (fileName: string, description: string, sourceLink: string) => Promise<void>;
  onRefresh: () => void;
}) {
  const [section, setSection] = useState<"faq" | "ticket" | "filereq" | "tickets">("faq");
  const [ticketForm, setTicketForm] = useState({ subject: "", message: "" });
  const [fileForm, setFileForm] = useState({ file_name: "", description: "", source_link: "" });

  const handleTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    await onTicketCreate(ticketForm.subject, ticketForm.message);
    setTicketForm({ subject: "", message: "" });
    setSection("tickets");
    onRefresh();
  };
  const handleFile = async (e: React.FormEvent) => {
    e.preventDefault();
    await onFileRequest(fileForm.file_name, fileForm.description, fileForm.source_link);
    setFileForm({ file_name: "", description: "", source_link: "" });
    setSection("tickets");
    onRefresh();
  };

  return (
    <div className="wa-support">
      <div className="wa-support-nav">
        <button className={section === "faq" ? "wa-btn-small wa-btn-active" : "wa-btn-small"} onClick={() => setSection("faq")}>FAQ</button>
        <button className={section === "ticket" ? "wa-btn-small wa-btn-active" : "wa-btn-small"} onClick={() => setSection("ticket")}>New Ticket</button>
        <button className={section === "filereq" ? "wa-btn-small wa-btn-active" : "wa-btn-small"} onClick={() => setSection("filereq")}>Request File</button>
        <button className={section === "tickets" ? "wa-btn-small wa-btn-active" : "wa-btn-small"} onClick={() => setSection("tickets")}>My Tickets</button>
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
          <input type="text" placeholder="File name (what are you looking for?)" value={fileForm.file_name}
            onChange={(e) => setFileForm({ ...fileForm, file_name: e.target.value })} required maxLength={255} />
          <textarea placeholder="Description (optional) — context, source, or details" value={fileForm.description}
            onChange={(e) => setFileForm({ ...fileForm, description: e.target.value })} maxLength={2000} rows={4} />
          <input type="url" placeholder="Source link (optional — Google Drive, Dropbox, etc.)" value={fileForm.source_link}
            onChange={(e) => setFileForm({ ...fileForm, source_link: e.target.value })} maxLength={500} />
          <button type="submit" className="wa-btn wa-btn-primary" disabled={!tgId}>
            <FileText size={16} /> Submit Request
          </button>
        </form>
      )}

      {section === "tickets" && (
        <div className="wa-tickets">
          {!tgId && <p className="wa-muted">Enter your Telegram ID to view your tickets.</p>}
          {tgId && tickets.length === 0 && (
            <div className="wa-empty"><HelpCircle size={24} /><p>No tickets yet. Open one above!</p></div>
          )}
          {tickets.map((t) => (
            <div key={t.id} className="wa-card wa-ticket-row">
              <div className="wa-ticket-info">
                <h3>{t.subject || "(no subject)"}</h3>
                <span className={`wa-badge wa-badge-${t.status}`}>{t.status}</span>
              </div>
              <small>#{t.id} · {new Date(t.created_at).toLocaleDateString("en-IN")}</small>
            </div>
          ))}
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
  const [tgId, setTgId] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("store");
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [faq, setFaq] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const saved = sessionStorage.getItem("poppygram_tg_id");
    if (saved) setTgId(saved);
  }, []);

  useEffect(() => {
    const loadPublic = async () => {
      try {
        const [p, f] = await Promise.all([api("/api/web/products"), api("/api/web/faq")]);
        setProducts(p.products || []);
        setFaq(f.faq || {});
      } catch (e: any) { setError(e.message || "Failed to load data"); }
    };
    loadPublic();
  }, []);

  const loadUserData = async () => {
    if (!tgId) return;
    setLoading(true); setError("");
    try {
      const [u, h, t] = await Promise.all([
        api(`/api/web/user?id=${tgId}`),
        api(`/api/web/history?id=${tgId}`).catch(() => ({ purchases: [] })),
        api(`/api/web/ticket?id=${tgId}`).catch(() => ({ tickets: [] })),
      ]);
      setMe(u); setPurchases(h.purchases || []); setTickets(t.tickets || []);
    } catch (e: any) { setError(e.message || "Failed to load user data"); }
    finally { setLoading(false); }
  };

  const refresh = () => { if (tgId) loadUserData(); };
  useEffect(() => { if (tgId) loadUserData(); }, [tgId]);

  const handleBuy = async (p: Product) => {
    if (!tgId) { alert("Please enter your Telegram user ID first."); return; }
    const confirmed = confirm(`Purchase "${p.name}" for ${p.price} credits?\n\nThe file will be delivered to your Telegram account.`);
    if (!confirmed) return;
    setLoading(true); setError("");
    try {
      const result = await api("/api/web/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tg_user_id: tgId, product_id: p.id, expected_price: p.price }),
      });
      if (result.ok) {
        alert(`✅ Purchase successful!\n\nNew balance: ${result.unlimited ? "UNLIMITED" : result.balance} credits\n📦 File delivered to your Telegram account.`);
        refresh();
      } else { alert(`❌ ${result.error || "Purchase failed"}`); }
    } catch (e: any) { alert(`❌ ${e.message || "Purchase failed"}`); }
    finally { setLoading(false); }
  };

  const handleTicketCreate = async (subject: string, message: string) => {
    if (!tgId) { alert("Please enter your Telegram user ID first."); return; }
    setLoading(true); setError("");
    try {
      const result = await api("/api/web/ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tg_user_id: tgId, subject, message, username: me?.username || "" }),
      });
      alert(`✅ Ticket #${result.ticket.id} created. A support manager will reply shortly.`);
    } catch (e: any) { alert(`❌ ${e.message || "Failed to create ticket"}`); }
    finally { setLoading(false); }
  };

  const handleFileRequest = async (fileName: string, description: string, sourceLink: string) => {
    if (!tgId) { alert("Please enter your Telegram user ID first."); return; }
    setLoading(true); setError("");
    try {
      const result = await api("/api/web/filerequest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tg_user_id: tgId, file_name: fileName, description, source_link: sourceLink, username: me?.username || "" }),
      });
      alert(`✅ File request #${result.request.id} submitted. A support manager will review it.`);
    } catch (e: any) { alert(`❌ ${e.message || "Failed to submit request"}`); }
    finally { setLoading(false); }
  };

  const handleClaim = async () => {
    if (!tgId) { alert("Please enter your Telegram user ID first."); return; }
    try {
      const result = await api("/api/web/freecredits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tg_user_id: tgId }),
      });
      alert(result.unlimited ? "✅ You have unlimited credits!" : `✅ Claimed! New balance: ${result.balance} credits`);
      refresh();
    } catch (e: any) { alert(`❌ ${e.message || "Failed to claim credits"}`); }
  };
  return (
    <div className="sp-page-wrapper wa-app">
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
        <TgIdBanner tgId={tgId} setTgId={setTgId} />
      </header>

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
        {!tgId && activeTab !== "store" && (
          <div className="wa-id-required">
            <User size={32} />
            <p>Please enter your Telegram user ID to access this section.</p>
          </div>
        )}
        {activeTab === "store" && (
          <StoreTab products={products} loading={loading && !products.length} onBuy={handleBuy} />
        )}
        {activeTab === "purchases" && tgId && <PurchasesTab purchases={purchases} />}
        {activeTab === "support" && (
          <SupportTab faq={faq} tickets={tickets} tgId={tgId}
            onTicketCreate={handleTicketCreate} onFileRequest={handleFileRequest} onRefresh={refresh} />
        )}
        {activeTab === "profile" && (tgId ? (
          <ProfileTab me={me} onClaim={handleClaim} onRefresh={refresh} />
        ) : (
          <div className="wa-id-required"><User size={32} /><p>Please enter your Telegram user ID to view your profile.</p></div>
        ))}
      </main>
    </div>
  );
}

