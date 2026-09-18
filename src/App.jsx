import { useState, useEffect, useCallback, useRef, Component } from "react";
import "./App.css";

// ─── CONFIG ────────────────────────────────────────
const SB = import.meta.env.VITE_SUPABASE_URL;
const AK = import.meta.env.VITE_SUPABASE_ANON_KEY;
const AUTH_KEY = "hh_auth_v1";
const MAX_AGE_MS = 10 * 24 * 60 * 60 * 1000; // 10 days
const BUCKET = "patient-attachments";

// ─── DB / AUTH / STORAGE HELPERS ──────────────────
const hd = (t) => ({ "Content-Type": "application/json", apikey: AK, Authorization: `Bearer ${t || AK}` });
const dbGet = (p, t) => fetch(`${SB}/rest/v1/${p}`, { headers: hd(t) }).then(r => r.json());
const dbPost = (tbl, data, t) => fetch(`${SB}/rest/v1/${tbl}`, { method: "POST", headers: { ...hd(t), Prefer: "return=representation" }, body: JSON.stringify(data) }).then(r => r.json());
const dbPatch = (tbl, id, data, t) => fetch(`${SB}/rest/v1/${tbl}?id=eq.${id}`, { method: "PATCH", headers: { ...hd(t), Prefer: "return=representation" }, body: JSON.stringify(data) }).then(r => r.json());
const dbDel = (tbl, col, val, t) => fetch(`${SB}/rest/v1/${tbl}?${col}=eq.${val}`, { method: "DELETE", headers: hd(t) });

const authIn = (e, p) => fetch(`${SB}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "Content-Type": "application/json", apikey: AK }, body: JSON.stringify({ email: e, password: p }) }).then(r => r.json());
const authUp = (e, p, n) => fetch(`${SB}/auth/v1/signup`, { method: "POST", headers: { "Content-Type": "application/json", apikey: AK }, body: JSON.stringify({ email: e, password: p, data: { full_name: n } }) }).then(r => r.json());

const stUpload = (path, blob, t) => fetch(`${SB}/storage/v1/object/${BUCKET}/${path}`, { method: "POST", headers: { Authorization: `Bearer ${t || AK}`, apikey: AK, "Content-Type": "image/jpeg" }, body: blob });
const stSign = async (path, t) => { const r = await fetch(`${SB}/storage/v1/object/sign/${BUCKET}/${path}`, { method: "POST", headers: { Authorization: `Bearer ${t || AK}`, apikey: AK, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 3600 }) }); const d = await r.json(); return d?.signedURL ? `${SB}/storage/v1${d.signedURL}` : null; };
const stDelete = (path, t) => fetch(`${SB}/storage/v1/object/${BUCKET}/${path}`, { method: "DELETE", headers: { Authorization: `Bearer ${t || AK}`, apikey: AK } });

const compressImage = (file, maxW = 1600, quality = 0.72) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error("compress failed")), "image/jpeg", quality);
    };
    img.onerror = reject;
    img.src = e.target.result;
  };
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

// ─── CONSTANTS ─────────────────────────────────────
const NUTRITION = [{ v: "normal_diet", l: "Normal diet" }, { v: "npo", l: "NPO" }, { v: "oral_fluids", l: "Oral fluids" }, { v: "fluids_per_ryle", l: "Fluids per Ryle" }, { v: "soft_diet", l: "Soft diet" }, { v: "soft_diet_per_ryle", l: "Soft diet per Ryle" }];
const BOWEL_C = [{ v: "open", l: "Open" }, { v: "flatus_only", l: "Flatus only" }, { v: "no_stool_flatus", l: "No stool / no flatus" }, { v: "stoma_not_functioning", l: "Stoma - not functioning" }, { v: "stoma_functioning", l: "Stoma - functioning" }];
const BOWEL_S = [{ v: "audible_normal", l: "Audible normal" }, { v: "sluggish", l: "Sluggish" }, { v: "silent", l: "Silent" }, { v: "exaggerated", l: "Exaggerated" }];
const TUBE_TYPES = [{ v: "ryle", l: "Ryle tube" }, { v: "urinary_catheter", l: "Urinary catheter" }, { v: "drain", l: "Drain" }, { v: "intercostal", l: "Intercostal tube" }, { v: "pigtail", l: "Pigtail" }];
const OTHER_SPECIALTIES = ["Cardiology", "Chest", "Neurology", "Neurosurgery", "Orthopedics", "Urology", "Nephrology", "ICU", "Vascular", "Plastic Surgery", "ENT", "Endocrinology"];
const COND_COLOR = { stable: "#059669", borderline: "#D97706", critical: "#DC2626" };
const COND_BG = { stable: "#D1FAE5", borderline: "#FEF3C7", critical: "#FEE2E2" };
const COND_TEXT = { stable: "#065F46", borderline: "#92400E", critical: "#991B1B" };

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtTime = (d) => d ? new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";

// ─── ERROR BOUNDARY ──────────────────────────────
class ErrorBoundary extends Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(e) { console.error("HelioHandover crash:", e); }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", background: "#0C2340", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ background: "white", borderRadius: 16, padding: 28, maxWidth: 320, textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0C2340", marginBottom: 8 }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.6, marginBottom: 20 }}>
            Close the app completely and reopen it.<br />If the problem persists, tap Reload below.
          </div>
          <button onClick={() => { try { localStorage.removeItem(AUTH_KEY); } catch (e) {} window.location.reload(); }}
            style={{ background: "#0C2340", color: "white", border: "none", borderRadius: 8, padding: "11px 24px", fontSize: 14, fontWeight: 500, cursor: "pointer", width: "100%" }}>
            🔄 Reload app
          </button>
        </div>
      </div>
    );
  }
}

// ─── UI PRIMITIVES ─────────────────────────────────
function Badge({ label, bg, color }) {
  return <span className="badge" style={{ background: bg, color }}>{label}</span>;
}
function CondBadge({ c }) {
  if (!c) return null;
  return <Badge label={c} bg={COND_BG[c] || "#F3F4F6"} color={COND_TEXT[c] || "#374151"} />;
}
function Inp({ label, k, type = "text", form, set, placeholder = "", min, max }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input value={form[k] || ""} onChange={e => set(k, e.target.value)} type={type} placeholder={placeholder} min={min} max={max} />
    </div>
  );
}
function Sel({ label, k, opts, form, set, nullable = true }) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={form[k] || ""} onChange={e => set(k, e.target.value)}>
        {nullable && <option value="">Select...</option>}
        {opts.map(o => <option key={o.v || o.id} value={o.v || o.id}>{o.l || o.name}</option>)}
      </select>
    </div>
  );
}
function TA({ label, k, rows = 3, form, set, placeholder = "" }) {
  return (
    <div className="field">
      <label>{label}</label>
      <textarea value={form[k] || ""} onChange={e => set(k, e.target.value)} rows={rows} placeholder={placeholder} />
    </div>
  );
}
function Chk({ label, k, form, set }) {
  return (
    <label className="chk-label">
      <input type="checkbox" checked={!!form[k]} onChange={e => set(k, e.target.checked)} />
      {label}
    </label>
  );
}
const SecTitle = ({ title, icon = "" }) => (
  <div style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.07em", padding: "14px 0 8px", borderTop: "1.5px solid #E5E7EB", marginTop: 8 }}>{icon} {title}</div>
);

// ─── LIGHTBOX (full-screen viewer with next/prev + swipe) ──
function Lightbox({ images, startIndex, onClose }) {
  const [idx, setIdx] = useState(startIndex);
  const total = images.length;
  const touchX = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIdx(i => Math.min(i + 1, total - 1));
      if (e.key === "ArrowLeft") setIdx(i => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [total, onClose]);

  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (dx > 50) setIdx(i => Math.max(i - 1, 0));
    if (dx < -50) setIdx(i => Math.min(i + 1, total - 1));
    touchX.current = null;
  };

  const current = images[idx];
  return (
    <div onClick={onClose} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <button onClick={e => { e.stopPropagation(); onClose(); }} style={{ position: "absolute", top: 16, right: 16, width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.15)", color: "white", border: "none", fontSize: 20, cursor: "pointer", zIndex: 1 }}>×</button>
      {total > 1 && <div style={{ position: "absolute", top: 16, left: 16, color: "white", fontSize: 12, background: "rgba(255,255,255,0.15)", padding: "4px 10px", borderRadius: 12 }}>{idx + 1} / {total}</div>}
      {total > 1 && idx > 0 && <button onClick={e => { e.stopPropagation(); setIdx(i => i - 1); }} style={{ position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)", width: 42, height: 42, borderRadius: "50%", background: "rgba(255,255,255,0.15)", color: "white", border: "none", fontSize: 22, cursor: "pointer" }}>‹</button>}
      {total > 1 && idx < total - 1 && <button onClick={e => { e.stopPropagation(); setIdx(i => i + 1); }} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 42, height: 42, borderRadius: "50%", background: "rgba(255,255,255,0.15)", color: "white", border: "none", fontSize: 22, cursor: "pointer" }}>›</button>}
      {current?.url && <img src={current.url} onClick={e => e.stopPropagation()} alt="" style={{ maxWidth: "92vw", maxHeight: "85vh", objectFit: "contain", borderRadius: 4 }} />}
      {current?.label && <div onClick={e => e.stopPropagation()} style={{ position: "absolute", bottom: 18, left: 0, right: 0, textAlign: "center", color: "white", fontSize: 12, opacity: 0.85 }}>{current.label}</div>}
    </div>
  );
}

// ─── ATTACHMENTS (labs / imaging photos) ──────────
function AttachmentBox({ patientId, category, token, user, pending, onPendingChange }) {
  const [items, setItems] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [viewerIdx, setViewerIdx] = useState(null);
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);

  const load = useCallback(() => {
    if (!patientId) return;
    dbGet(`patient_attachments?patient_id=eq.${patientId}&category=eq.${category}&order=created_at.desc`, token)
      .then(async rows => {
        if (!Array.isArray(rows)) { setItems([]); return; }
        const withUrls = await Promise.all(rows.map(async r => ({ ...r, url: await stSign(r.file_path, token) })));
        setItems(withUrls);
      });
  }, [patientId, category, token]);
  useEffect(() => { load(); }, [load]);

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    if (!patientId) {
      const additions = files.map(file => ({ tempId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, file, previewUrl: URL.createObjectURL(file) }));
      onPendingChange(prev => [...prev, ...additions]);
      e.target.value = "";
      return;
    }

    setUploading(true);
    for (const file of files) {
      try {
        const blob = await compressImage(file);
        const path = `${patientId}/${category}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
        const up = await stUpload(path, blob, token);
        if (up.ok) {
          await dbPost("patient_attachments", { patient_id: patientId, category, file_path: path, uploaded_by: user.id, uploaded_by_name: user.full_name || user.email || "Unknown" }, token);
        }
      } catch (err) { /* skip failed file, continue with the rest */ }
    }
    await load();
    setUploading(false);
    e.target.value = "";
  };

  const handleDelete = async (item) => {
    if (item._pending) {
      URL.revokeObjectURL(item.url);
      onPendingChange(prev => prev.filter(p => p.tempId !== item.id));
      return;
    }
    await stDelete(item.file_path, token);
    await dbDel("patient_attachments", "id", item.id, token);
    load();
  };

  const display = patientId ? items : (pending || []).map(p => ({ id: p.tempId, _pending: true, url: p.previewUrl }));

  return (
    <>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4, marginBottom: 10 }}>
      {display.map((it, i) => (
        <div key={it.id} style={{ position: "relative", width: 66, height: 66 }}>
          {it.url ? <img src={it.url} onClick={() => setViewerIdx(i)} alt="attachment" style={{ width: 66, height: 66, objectFit: "cover", borderRadius: 8, border: "1px solid #E5E7EB", cursor: "pointer" }} />
            : <div style={{ width: 66, height: 66, borderRadius: 8, background: "#F3F4F6" }} />}
          <button onClick={() => handleDelete(it)} style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", background: "#DC2626", color: "white", border: "none", fontSize: 12, lineHeight: 1, cursor: "pointer" }}>×</button>
        </div>
      ))}
      <button onClick={() => cameraRef.current?.click()} disabled={uploading} title="Take photo"
        style={{ width: 66, height: 66, borderRadius: 8, border: "2px dashed #D1D5DB", background: "#F9FAFB", color: "#6B7280", fontSize: 20, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
        <span>{uploading ? "…" : "📷"}</span>
        <span style={{ fontSize: 9, fontWeight: 500 }}>Camera</span>
      </button>
      <button onClick={() => galleryRef.current?.click()} disabled={uploading} title="Choose from gallery"
        style={{ width: 66, height: 66, borderRadius: 8, border: "2px dashed #D1D5DB", background: "#F9FAFB", color: "#6B7280", fontSize: 20, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
        <span>{uploading ? "…" : "🖼️"}</span>
        <span style={{ fontSize: 9, fontWeight: 500 }}>Gallery</span>
      </button>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handleFiles} />
      <input ref={galleryRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleFiles} />
      {!patientId && display.length > 0 && <div style={{ fontSize: 11, color: "#9CA3AF", width: "100%", marginTop: 2 }}>📌 Will upload when you save the patient</div>}
    </div>
    {viewerIdx !== null && <Lightbox images={display.map(it => ({ url: it.url }))} startIndex={viewerIdx} onClose={() => setViewerIdx(null)} />}
    </>
  );
}

function AttachmentGallery({ patientId, category, token }) {
  const [items, setItems] = useState([]);
  const [viewerIdx, setViewerIdx] = useState(null);
  useEffect(() => {
    if (!patientId) return;
    dbGet(`patient_attachments?patient_id=eq.${patientId}&category=eq.${category}&order=created_at.desc`, token)
      .then(async rows => {
        if (!Array.isArray(rows) || rows.length === 0) { setItems([]); return; }
        const withUrls = await Promise.all(rows.map(async r => ({ ...r, url: await stSign(r.file_path, token) })));
        setItems(withUrls);
      });
  }, [patientId, category, token]);
  if (items.length === 0) return null;
  return (
    <>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
      {items.map((it, i) => it.url && (
        <img key={it.id} src={it.url} onClick={() => setViewerIdx(i)} alt="attachment" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: "1px solid #E5E7EB", cursor: "pointer" }} />
      ))}
    </div>
    {viewerIdx !== null && <Lightbox images={items.map(it => ({ url: it.url }))} startIndex={viewerIdx} onClose={() => setViewerIdx(null)} />}
    </>
  );
}

// ─── AUTH ───────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!email || !pw) { setErr("Email and password required"); return; }
    setLoading(true); setErr("");
    try {
      const data = mode === "login" ? await authIn(email, pw) : await authUp(email, pw, name);
      if (data.access_token) onAuth({ token: data.access_token, user: data.user, savedAt: Date.now() });
      else setErr(data.msg || data.error_description || "Authentication failed");
    } catch { setErr("Network error"); }
    setLoading(false);
  };

  return (
    <div className="auth-bg">
      <div className="auth-card">
        <div className="auth-header">
          <img src="/logo.png" alt="HelioHandover" className="auth-logo-img" />
          <div className="auth-logo">HelioHandover</div>
          <div className="auth-sub">General Surgery · Heliopolis Hospital</div>
        </div>
        <div className="tab-row">
          {["login", "register"].map(m => (
            <button key={m} onClick={() => setMode(m)} className={`tab-btn ${mode === m ? "active" : ""}`}>
              {m === "login" ? "Sign in" : "Register"}
            </button>
          ))}
        </div>
        {mode === "register" && <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" className="auth-input" />}
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" className="auth-input" />
        <input value={pw} onChange={e => setPw(e.target.value)} placeholder="Password" type="password" className="auth-input" />
        {err && <div className="err-box">{err}</div>}
        <button onClick={submit} disabled={loading} className="btn-primary btn-full">
          {loading ? "..." : mode === "login" ? "Sign in" : "Create account"}
        </button>
        <div className="auth-copyright">© Mirhan Ashour. All rights reserved.</div>
      </div>
    </div>
  );
}

function PendingScreen({ onLogout }) {
  return (
    <div className="auth-bg">
      <div className="auth-card" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>⏳</div>
        <div className="auth-logo">Pending approval</div>
        <div className="auth-sub" style={{ marginBottom: 20 }}>
          Your account is awaiting approval from a department admin.
        </div>
        <button onClick={onLogout} className="btn-ghost btn-full">Sign out</button>
      </div>
    </div>
  );
}

// ─── PATIENT CARD ───────────────────────────────────
function PatientCard({ patient, onClick, onCheck, isConsult }) {
  const c = patient.general_condition;
  const bc = COND_COLOR[c] || "#E5E7EB";
  const consultants = patient.patient_consultants?.map(pc => pc.consultants?.name).filter(Boolean) || [];
  const lastChecked = patient.last_checked_at;
  const today = new Date().toDateString();
  const checkedToday = lastChecked && new Date(lastChecked).toDateString() === today;

  return (
    <div className={`patient-card ${isConsult ? "consult-card" : ""}`} style={{ borderLeftColor: isConsult ? "#7C3AED" : bc }} onClick={onClick}>
      <div className="card-top">
        <div>
          <div className="card-name">{patient.name}</div>
          <div className="card-sub">{patient.age}y · {patient.wards?.name || "—"}</div>
        </div>
        <div className="card-badges">
          {!isConsult && <CondBadge c={c} />}
          {isConsult && patient.consultation_admitted && <Badge label="Admitted" bg="#D1FAE5" color="#065F46" />}
        </div>
      </div>
      <div className="card-diag">Dx: {patient.diagnosis || "No diagnosis entered"}</div>
      {patient.surgery_status === "postop" && <div className="card-cons">🏥 POD {patient.postop_day ?? 0}</div>}
      {consultants.length > 0 && <div className="card-cons">👨‍⚕️ {consultants.join(" · ")}</div>}
      {patient.tasks_next_day && <div className="card-tasks">📋 {patient.tasks_next_day}</div>}
      <div className="card-bottom">
        <div className="card-tags">
          {patient.nutrition_status && <Badge label={patient.nutrition_status.replace(/_/g, " ")} bg="#F3F4F6" color="#374151" />}
        </div>
        {isConsult ? (
          !patient.consultation_admitted && <span style={{ fontSize: 11, color: "#7C3AED" }}>⏳ Awaiting result</span>
        ) : (
          <div className="card-check">
            <span style={{ fontSize: 11, color: checkedToday ? "#059669" : "#D97706" }}>
              {checkedToday ? "✓ Today" : lastChecked ? "Not checked today" : "Not checked"}
            </span>
            <button className={`check-btn ${checkedToday ? "checked" : ""}`} onClick={e => { e.stopPropagation(); onCheck(patient.id); }}>
              {checkedToday ? "✓" : "Check"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DASHBOARD ───────────────────────────────────────
function BoardView({ token, user, onSelect, onAdd, onLogout, onTokenExpired }) {
  const [patients, setPatients] = useState([]);
  const [wards, setWards] = useState([]);
  const [consultants, setConsultants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ ward: "", consultant: "", condition: "", status: "active", search: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const [p, w, c] = await Promise.all([
      dbGet(`patients?select=*,wards(id,name),patient_consultants(id,consultants(id,name))&order=ward_id.asc,general_condition.asc`, token),
      dbGet("wards?select=*&order=name.asc", token),
      dbGet("consultants?select=*&is_active=eq.true&order=name.asc", token)
    ]);
    if (!Array.isArray(p) && (p?.code || p?.message?.includes("JWT") || p?.message?.includes("expired"))) {
      onTokenExpired?.(); setLoading(false); return;
    }
    setPatients(Array.isArray(p) ? p : []); setWards(Array.isArray(w) ? w : []); setConsultants(Array.isArray(c) ? c : []);
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  const checkPatient = async (id) => {
    await dbPost("patient_checks", { patient_id: id, checked_by: user.id }, token);
    await dbPatch("patients", id, { last_checked_at: new Date().toISOString(), last_checked_by: user.id, updated_by: user.id }, token);
    load();
  };

  const matchesFilters = (p) => {
    if (filter.ward && p.ward_id !== filter.ward) return false;
    if (filter.condition && p.general_condition !== filter.condition) return false;
    if (filter.consultant && !p.patient_consultants?.some(pc => pc.consultants?.id === filter.consultant)) return false;
    if (filter.search) {
      const s = filter.search.toLowerCase();
      if (!p.name?.toLowerCase().includes(s) && !p.diagnosis?.toLowerCase().includes(s)) return false;
    }
    return true;
  };

  const pureConsults = patients.filter(p => p.supervision_type === "consultation" && !p.consultation_admitted && matchesFilters(p));
  const admittedAll = patients.filter(p => {
    const isUnderCare = p.supervision_type !== "consultation" || p.consultation_admitted;
    if (!isUnderCare) return false;
    const noStatus = p.supervision_type === "consultation" && !p.consultation_admitted && !p.patient_status;
    if (filter.status && !noStatus && p.patient_status !== filter.status) return false;
    return matchesFilters(p);
  });

  const wardGroups = {};
  admittedAll.forEach(p => {
    const wid = p.ward_id || "unassigned";
    if (!wardGroups[wid]) wardGroups[wid] = { name: p.wards?.name || "Unassigned", patients: [] };
    wardGroups[wid].patients.push(p);
  });
  Object.values(wardGroups).forEach(g => {
    const order = { critical: 0, borderline: 1, stable: 2 };
    g.patients.sort((a, b) => (order[a.general_condition] ?? 9) - (order[b.general_condition] ?? 9));
  });

  const stats = {
    admitted: patients.filter(p => p.patient_status === "active" && (p.supervision_type !== "consultation" || p.consultation_admitted)).length,
    critical: patients.filter(p => p.patient_status === "active" && p.general_condition === "critical").length,
    consults: pureConsults.length,
  };

  return (
    <div className="board-wrap">
      <div className="board-header">
        <div className="board-header-left">
          <img src="/logo.png" alt="" className="board-logo-img" />
          <div>
            <div className="board-title">HelioHandover</div>
            <div className="board-sub">General Surgery · Heliopolis Hospital</div>
          </div>
        </div>
        <button onClick={onLogout} className="btn-ghost">Sign out</button>
      </div>

      <div className="stats-row">
        <div className="stat-card" style={{ background: "#DBEAFE" }}><div className="stat-val" style={{ color: "#1E40AF" }}>{stats.admitted}</div><div className="stat-label" style={{ color: "#1E40AF" }}>Admitted</div></div>
        <div className="stat-card" style={{ background: "#FEE2E2" }}><div className="stat-val" style={{ color: "#991B1B" }}>{stats.critical}</div><div className="stat-label" style={{ color: "#991B1B" }}>Critical</div></div>
        <div className="stat-card" style={{ background: "#EDE9FE" }}><div className="stat-val" style={{ color: "#5B21B6" }}>{stats.consults}</div><div className="stat-label" style={{ color: "#5B21B6" }}>Consults</div></div>
      </div>

      <input value={filter.search} onChange={e => setFilter(f => ({ ...f, search: e.target.value }))} placeholder="🔍 Search name or diagnosis..." className="search-input" />

      <div className="filter-row">
        {["active", "discharged", "dama", "died"].map(s => (
          <button key={s} onClick={() => setFilter(f => ({ ...f, status: f.status === s ? "" : s }))} className={`filter-pill ${filter.status === s ? "active" : ""}`}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      <div className="filter-row">
        {["stable", "borderline", "critical"].map(c => (
          <button key={c} onClick={() => setFilter(f => ({ ...f, condition: f.condition === c ? "" : c }))}
            className="filter-pill" style={{ background: filter.condition === c ? COND_COLOR[c] : "", color: filter.condition === c ? "white" : "" }}>
            {c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        ))}
        <select value={filter.ward} onChange={e => setFilter(f => ({ ...f, ward: e.target.value }))} className="filter-select">
          <option value="">All wards</option>
          {wards.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select value={filter.consultant} onChange={e => setFilter(f => ({ ...f, consultant: e.target.value }))} className="filter-select">
          <option value="">All consultants</option>
          {consultants.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {loading ? <div className="empty-state">Loading patients...</div> : (
        <>
          <div className="section-banner care-banner">
            <span>🏥 UNDER OUR CARE</span><span>{admittedAll.length} patients</span>
          </div>
          {Object.entries(wardGroups).length === 0 && <div className="empty-state">No patients found</div>}
          {Object.entries(wardGroups).map(([wid, g]) => (
            <div key={wid} className="ward-group">
              <div className="ward-group-title">{g.name} <span className="ward-count">{g.patients.length}</span></div>
              {g.patients.map(p => <PatientCard key={p.id} patient={p} onClick={() => onSelect(p)} onCheck={checkPatient} />)}
            </div>
          ))}

          {pureConsults.length > 0 && (
            <>
              <div className="section-banner consult-banner" style={{ marginTop: admittedAll.length > 0 ? 20 : 0 }}>
                <span>📋 CONSULTATIONS</span><span>{pureConsults.length} patients</span>
              </div>
              {pureConsults.map(p => <PatientCard key={p.id} patient={p} isConsult onClick={() => onSelect(p)} onCheck={checkPatient} />)}
            </>
          )}
        </>
      )}

      <button onClick={onAdd} className="fab">+</button>
    </div>
  );
}

// ─── PATIENT FORM ───────────────────────────────────
function PatientForm({ token, user, patient, onSave, onBack }) {
  const [wards, setWards] = useState([]);
  const [consultants, setConsultants] = useState([]);
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [selCons, setSelCons] = useState(patient?.patient_consultants?.map(pc => pc.consultants?.id).filter(Boolean) || []);
  const [tubes, setTubes] = useState((patient?.patient_tubes || []).map(t => ({ ...t, _existing: true })));
  const [notifiedCons, setNotifiedCons] = useState(patient?.consultant_contacted_name ? patient.consultant_contacted_name.split(",").map(s => s.trim()).filter(Boolean) : []);
  const [otherSpec, setOtherSpec] = useState(patient?.other_specialities || []);
  const [pendingLabs, setPendingLabs] = useState([]);
  const [pendingImaging, setPendingImaging] = useState([]);

  const [supervisionType, setSupervisionType] = useState(patient?.supervision_type || "admitted");

  const [form, setFormState] = useState({
    name: patient?.name || "", age: patient?.age || "",
    admission_date: patient?.admission_date || new Date().toISOString().split("T")[0],
    ward_id: patient?.ward_id || "", department_type: patient?.department_type || "general_surgery",
    diagnosis: patient?.diagnosis || "", history: patient?.history || "",
    has_dm: patient?.has_dm || false, has_htn: patient?.has_htn || false,
    has_cardiac: patient?.has_cardiac || false, has_renal: patient?.has_renal || false,
    has_hepatic: patient?.has_hepatic || false, other_comorbidities: patient?.other_comorbidities || "",
    surgery_status: patient?.surgery_status || "followup", operation: patient?.operation || "",
    postop_day: patient?.postop_day ?? "",
    nutrition_status: patient?.nutrition_status || "normal_diet",
    general_condition: patient?.general_condition || "stable",
    case_complexity: patient?.case_complexity || "normal",
    bowel_condition: patient?.bowel_condition || "", bowel_sounds: patient?.bowel_sounds || "",
    chest_condition_comment: patient?.chest_condition_comment || "",
    general_examination: patient?.general_examination || "",
    abdomen_condition: patient?.abdomen_condition || "",
    other_speciality_diagnosis: patient?.other_speciality_diagnosis || "",
    vital_temp: patient?.vital_temp || "", vital_bp: patient?.vital_bp || "",
    vital_hr: patient?.vital_hr || "", vital_rr: patient?.vital_rr || "", vital_spo2: patient?.vital_spo2 || "",
    labs_summary: patient?.labs_summary || "", critical_labs: patient?.critical_labs || "",
    imaging_summary: patient?.imaging_summary || "", critical_imaging: patient?.critical_imaging || "",
    has_wound: patient?.has_wound || false, wound_condition: patient?.wound_condition || "",
    wound_dressing_done_today: patient?.wound_dressing_done_today || false,
    handover_notes: patient?.handover_notes || "", tasks_next_day: patient?.tasks_next_day || "",
    patient_status: patient?.patient_status || "active",
    consultation_cause: patient?.consultation_cause || "",
    consultation_reply: patient?.consultation_reply || "",
    consultation_admitted: patient?.consultation_admitted || false,
    awaiting_investigation: patient?.awaiting_investigation || false,
  });

  const set = (k, v) => setFormState(f => ({ ...f, [k]: v }));
  const fp = { form, set };

  useEffect(() => {
    Promise.all([
      dbGet("wards?select=*&order=name.asc", token),
      dbGet("consultants?select=*&is_active=eq.true&order=name.asc", token)
    ]).then(([w, c]) => { setWards(Array.isArray(w) ? w : []); setConsultants(Array.isArray(c) ? c : []); });
  }, []);

  const toggleCon = (id) => setSelCons(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const toggleNotifiedCon = (name) => setNotifiedCons(p => p.includes(name) ? p.filter(x => x !== name) : [...p, name]);
  const toggleOtherSpec = (s) => setOtherSpec(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);
  const addTube = () => setTubes(t => [...t, { tube_type: "drain", quantity: 1, site: "", content_quantity: "", content_color: "", emptied_previous_days: false, is_removed: false }]);
  const removeTube = (i) => setTubes(t => t.map((tb, x) => x === i ? { ...tb, is_removed: true } : tb));
  const restoreTube = (i) => setTubes(t => t.map((tb, x) => x === i ? { ...tb, is_removed: false } : tb));
  const setTube = (i, k, v) => setTubes(t => t.map((tb, x) => x === i ? { ...tb, [k]: v } : tb));

  const save = async () => {
    if (!form.name.trim()) { setErr("Patient name is required"); return; }
    setLoading(true); setErr("");
    try {
      const data = {
        ...form,
        supervision_type: supervisionType,
        age: form.age ? parseInt(form.age) : null,
        postop_day: form.postop_day !== "" ? parseInt(form.postop_day) : null,
        vital_temp: form.vital_temp ? parseFloat(form.vital_temp) : null,
        vital_hr: form.vital_hr ? parseInt(form.vital_hr) : null,
        vital_rr: form.vital_rr ? parseInt(form.vital_rr) : null,
        vital_spo2: form.vital_spo2 ? parseFloat(form.vital_spo2) : null,
        other_specialities: otherSpec,
        consultant_contacted_name: notifiedCons.join(", "),
        consultant_contacted: notifiedCons.length > 0,
        updated_by: user.id
      };
      let pid;
      if (patient?.id) {
        await dbPatch("patients", patient.id, data, token);
        pid = patient.id;
      } else {
        data.created_by = user.id;
        const r = await dbPost("patients", data, token);
        pid = (Array.isArray(r) ? r[0] : r)?.id;
      }
      if (pid) {
        await dbDel("patient_consultants", "patient_id", pid, token);
        if (selCons.length > 0) await dbPost("patient_consultants", selCons.map(cid => ({ patient_id: pid, consultant_id: cid })), token);

        for (const tb of tubes) {
          const { _existing, id, ...td } = tb;
          if (_existing && id) {
            await dbPatch("patient_tubes", id, td, token);
          } else if (!tb.is_removed) {
            await dbPost("patient_tubes", { ...td, patient_id: pid, is_removed: false }, token);
          }
        }
        const uploadPending = async (list, category) => {
          for (const p of list) {
            try {
              const blob = await compressImage(p.file);
              const path = `${pid}/${category}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
              const up = await stUpload(path, blob, token);
              if (up.ok) {
                await dbPost("patient_attachments", { patient_id: pid, category, file_path: path, uploaded_by: user.id, uploaded_by_name: user.full_name || user.email || "Unknown" }, token);
              }
              URL.revokeObjectURL(p.previewUrl);
            } catch (err) { /* skip failed file */ }
          }
        };
        await uploadPending(pendingLabs, "labs");
        await uploadPending(pendingImaging, "imaging");
      }
      onSave();
    } catch (e) { setErr("Error saving: " + e.message); }
    setLoading(false);
  };

  const visibleTubes = tubes.filter(t => !t.is_removed || t._existing);
  const TABS = supervisionType === "consultation" ? ["Patient", "Consult"] : ["Patient", "Clinical", "Data", "Tubes", "Handover"];

  return (
    <div className="form-wrap">
      <div className="form-header">
        <button onClick={onBack} className="back-btn">←</button>
        <div className="form-title">{patient ? "Edit patient" : "Add patient"}</div>
      </div>

      <div className="tab-bar">
        {TABS.map((t, i) => (
          <button key={i} onClick={() => setTab(i)} className={`tab-item ${tab === i ? "active" : ""}`}>{t}</button>
        ))}
      </div>

      <div className="form-body">
        {tab === 0 && <>
          <Inp label="Patient name *" k="name" {...fp} />
          <div className="two-col">
            <Inp label="Age" k="age" type="number" {...fp} />
            <Inp label="Admission date" k="admission_date" type="date" {...fp} />
          </div>
          <Sel label="Ward" k="ward_id" opts={wards.map(w => ({ v: w.id, l: w.name }))} {...fp} />
          <div className="field">
            <label>Supervision type</label>
            <select value={supervisionType} onChange={e => setSupervisionType(e.target.value)}>
              <option value="admitted">Admitted under our care</option>
              <option value="consultation">Consultation</option>
            </select>
          </div>
          {supervisionType !== "consultation" && (
            <Sel label="Patient status" k="patient_status" nullable={false} opts={[{ v: "active", l: "Active" }, { v: "discharged", l: "Discharged" }, { v: "dama", l: "DAMA" }, { v: "died", l: "Died" }]} {...fp} />
          )}
          <div className="field">
            <label>Consultants</label>
            <div className="cons-grid">
              {consultants.map(c => (
                <button key={c.id} onClick={() => toggleCon(c.id)} className={`cons-pill ${selCons.includes(c.id) ? "active" : ""}`}>{c.name}</button>
              ))}
            </div>
          </div>
        </>}

        {supervisionType === "consultation" && tab === 1 && <>
          <TA label="Consultation cause" k="consultation_cause" rows={3} {...fp} />
          <div className="field">
            <label>Other specialities involved</label>
            <div className="cons-grid">
              {OTHER_SPECIALTIES.map(s => (
                <button key={s} type="button" onClick={() => toggleOtherSpec(s)} className={`cons-pill ${otherSpec.includes(s) ? "active" : ""}`}>{s}</button>
              ))}
            </div>
          </div>
          {otherSpec.length > 0 && <Inp label="Other speciality diagnosis" k="other_speciality_diagnosis" {...fp} />}
          <TA label="Consultation reply" k="consultation_reply" rows={3} {...fp} />
          <Chk label="Awaiting investigation" k="awaiting_investigation" {...fp} />
          <div className="field">
            <label>Consultant(s) contacted</label>
            <div className="cons-grid">
              {consultants.map(c => (
                <button key={c.id} type="button" onClick={() => toggleNotifiedCon(c.name)} className={`cons-pill ${notifiedCons.includes(c.name) ? "active" : ""}`}>{c.name}</button>
              ))}
            </div>
          </div>
          <Chk label="Admitted to our supervision" k="consultation_admitted" {...fp} />
        </>}

        {supervisionType !== "consultation" && tab === 1 && <>
          <TA label="Diagnosis" k="diagnosis" rows={2} {...fp} />
          <TA label="History" k="history" rows={3} {...fp} />
          <div className="field"><label>Comorbidities</label>
            <div className="two-col">
              <Chk label="DM" k="has_dm" {...fp} />
              <Chk label="HTN" k="has_htn" {...fp} />
              <Chk label="Cardiac" k="has_cardiac" {...fp} />
              <Chk label="Renal" k="has_renal" {...fp} />
              <Chk label="Hepatic" k="has_hepatic" {...fp} />
            </div>
          </div>
          <Inp label="Other comorbidities" k="other_comorbidities" {...fp} />
          <Sel label="Surgery status" k="surgery_status" nullable={false} opts={[{ v: "followup", l: "Follow-up" }, { v: "preop", l: "Pre-op" }, { v: "postop", l: "Post-op" }]} {...fp} />
          {(form.surgery_status === "postop" || form.surgery_status === "preop") && (
            <div className={form.surgery_status === "postop" ? "two-col" : ""}>
              <Inp label={form.surgery_status === "postop" ? "Operation" : "Planned operation"} k="operation" {...fp} />
              {form.surgery_status === "postop" && <Inp label="POD #" k="postop_day" type="number" min={0} {...fp} />}
            </div>
          )}
          <Sel label="Nutrition status" k="nutrition_status" nullable={false} opts={NUTRITION} {...fp} />
          <div className="two-col">
            <Sel label="General condition" k="general_condition" nullable={false} opts={[{ v: "stable", l: "Stable" }, { v: "borderline", l: "Borderline" }, { v: "critical", l: "Critical" }]} {...fp} />
            <Sel label="Case complexity" k="case_complexity" nullable={false} opts={[{ v: "normal", l: "Normal" }, { v: "complicated", l: "Complicated" }, { v: "improved", l: "Improved" }]} {...fp} />
          </div>
          <SecTitle title="Examination" />
          <TA label="General examination" k="general_examination" rows={2} {...fp} />
          <TA label="Abdomen" k="abdomen_condition" rows={2} {...fp} />
          <Sel label="Bowel condition" k="bowel_condition" opts={BOWEL_C} {...fp} />
          <Sel label="Bowel sounds" k="bowel_sounds" opts={BOWEL_S} {...fp} />
          <TA label="Chest condition" k="chest_condition_comment" rows={2} {...fp} />
        </>}

        {supervisionType !== "consultation" && tab === 2 && <>
          <SecTitle title="Vital signs" />
          <div className="two-col">
            <Inp label="Temp (°C)" k="vital_temp" type="number" {...fp} />
            <Inp label="BP (mmHg)" k="vital_bp" placeholder="120/80" {...fp} />
            <Inp label="HR (bpm)" k="vital_hr" type="number" {...fp} />
            <Inp label="RR (/min)" k="vital_rr" type="number" {...fp} />
            <Inp label="SpO₂ (%)" k="vital_spo2" type="number" {...fp} />
          </div>
          <SecTitle title="Labs" />
          <TA label="Labs summary" k="labs_summary" rows={2} {...fp} />
          <TA label="⚠ Critical values" k="critical_labs" rows={2} {...fp} />
          <AttachmentBox patientId={patient?.id} category="labs" token={token} user={user} pending={pendingLabs} onPendingChange={setPendingLabs} />
          <SecTitle title="Imaging" />
          <TA label="Imaging summary" k="imaging_summary" rows={2} {...fp} />
          <TA label="⚠ Critical findings" k="critical_imaging" rows={2} {...fp} />
          <AttachmentBox patientId={patient?.id} category="imaging" token={token} user={user} pending={pendingImaging} onPendingChange={setPendingImaging} />
          <SecTitle title="Wound" />
          <Chk label="Has wound" k="has_wound" {...fp} />
          {form.has_wound && <>
            <TA label="Wound condition" k="wound_condition" rows={2} {...fp} />
            <Chk label="Dressing done today" k="wound_dressing_done_today" {...fp} />
          </>}
        </>}

        {supervisionType !== "consultation" && tab === 3 && <>
          <div className="tube-header">
            <span className="section-title" style={{ marginBottom: 0 }}>Tubes & drains ({visibleTubes.length})</span>
            <button onClick={addTube} className="btn-primary btn-sm">+ Add tube</button>
          </div>
          {visibleTubes.length === 0 && <div className="empty-state">No tubes. Click "Add tube" to add one.</div>}
          {tubes.map((tb, i) => (!tb.is_removed || tb._existing) && (
            <div key={i} className="tube-card" style={{ opacity: tb.is_removed ? 0.5 : 1 }}>
              <div className="tube-top">
                <select value={tb.tube_type} onChange={e => setTube(i, "tube_type", e.target.value)} className="tube-type-sel" disabled={tb.is_removed}>
                  {TUBE_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
                {tb.is_removed
                  ? <button onClick={() => restoreTube(i)} className="btn-primary btn-sm">Restore</button>
                  : <button onClick={() => removeTube(i)} className="btn-danger btn-sm">Remove</button>}
              </div>
              {!tb.is_removed && <>
                <div className="two-col">
                  {[["Quantity", "quantity", "number"], ["Site", "site", "text"], ["Output", "content_quantity", "text"], ["Color", "content_color", "text"]].map(([l, k, t]) => (
                    <div key={k} className="field">
                      <label>{l}</label>
                      <input type={t} value={tb[k] || ""} onChange={e => setTube(i, k, t === "number" ? parseInt(e.target.value) || 1 : e.target.value)} />
                    </div>
                  ))}
                </div>
                <label className="chk-label">
                  <input type="checkbox" checked={!!tb.emptied_previous_days} onChange={e => setTube(i, "emptied_previous_days", e.target.checked)} />
                  Emptied in previous days
                </label>
              </>}
            </div>
          ))}
        </>}

        {supervisionType !== "consultation" && tab === 4 && <>
          <TA label="Handover notes" k="handover_notes" rows={5} placeholder="Summary for the incoming team..." {...fp} />
          <TA label="Tasks for next day" k="tasks_next_day" rows={4} placeholder="Tasks to be done tomorrow..." {...fp} />
        </>}
      </div>

      {err && <div className="err-box">{err}</div>}

      <div className="form-footer">
        {tab > 0 && <button onClick={() => setTab(t => t - 1)} className="btn-ghost btn-flex">← Back</button>}
        {tab < TABS.length - 1
          ? <button onClick={() => setTab(t => t + 1)} className="btn-primary btn-flex">Next →</button>
          : <button onClick={save} disabled={loading} className="btn-success btn-flex">{loading ? "Saving..." : "Save patient ✓"}</button>}
      </div>
    </div>
  );
}

// ─── PATIENT DETAIL ──────────────────────────────────
function PatientDetail({ token, user, initial, onBack, onEdit, onCaseProgress }) {
  const [patient, setPatient] = useState(initial);

  useEffect(() => {
    dbGet(`patients?select=*,wards(id,name),patient_consultants(id,consultants(id,name)),patient_tubes(*)&id=eq.${initial.id}`, token)
      .then(p => { if (Array.isArray(p) && p[0]) setPatient(p[0]); });
  }, []);

  const consultants = patient.patient_consultants?.map(pc => pc.consultants?.name).filter(Boolean) || [];
  const tubes = (patient.patient_tubes || []).filter(t => !t.is_removed);
  const comorbidities = [patient.has_dm && "DM", patient.has_htn && "HTN", patient.has_cardiac && "Cardiac", patient.has_renal && "Renal", patient.has_hepatic && "Hepatic", patient.other_comorbidities].filter(Boolean).join(", ");
  const isConsult = patient.supervision_type === "consultation";

  const Sec = ({ title, children }) => (
    <div className="detail-section">
      <div className="detail-section-title">{title}</div>
      {children}
    </div>
  );
  const Row = ({ label, value }) => value ? (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-val">{value}</span>
    </div>
  ) : null;

  return (
    <div className="detail-wrap">
      <style>{`@media print { .no-print { display: none !important; } }`}</style>
      <div className="detail-header no-print">
        <button onClick={onBack} className="back-btn">←</button>
        <div style={{ flex: 1 }}>
          <div className="form-title">{patient.name}</div>
          <div className="board-sub">{patient.age}y · {patient.wards?.name || "—"}</div>
        </div>
        <button onClick={onCaseProgress} className="btn-ghost btn-sm">📜 Progress</button>
        <button onClick={onEdit} className="btn-primary btn-sm">✏ Edit</button>
        <button onClick={() => window.print()} className="btn-ghost btn-sm">🖨 Print</button>
      </div>

      <div className="badges-row">
        {!isConsult && <CondBadge c={patient.general_condition} />}
        {isConsult && <Badge label="Consultation" bg="#EDE9FE" color="#5B21B6" />}
        {patient.patient_status && patient.patient_status !== "active" && <Badge label={patient.patient_status.toUpperCase()} bg="#F3F4F6" color="#374151" />}
        {patient.critical_labs && <Badge label="⚠ Critical labs" bg="#FEE2E2" color="#991B1B" />}
        {patient.critical_imaging && <Badge label="⚠ Critical imaging" bg="#FEE2E2" color="#991B1B" />}
      </div>

      <Sec title="Patient info">
        <Row label="Name" value={patient.name} /><Row label="Age" value={patient.age ? `${patient.age} years` : null} />
        <Row label="Admission date" value={fmtDate(patient.admission_date)} /><Row label="Ward" value={patient.wards?.name} />
        <Row label="Consultants" value={consultants.join(", ") || null} />
      </Sec>

      {isConsult ? (
        <Sec title="Consultation">
          <Row label="Cause" value={patient.consultation_cause} />
          <Row label="Reply" value={patient.consultation_reply} />
          <Row label="Awaiting investigation" value={patient.awaiting_investigation ? "Yes" : null} />
          <Row label="Consultant(s) contacted" value={patient.consultant_contacted_name} />
          <Row label="Admitted to supervision" value={patient.consultation_admitted ? "Yes" : "No"} />
        </Sec>
      ) : (
        <>
          <Sec title="Clinical">
            <Row label="Diagnosis" value={patient.diagnosis} />
            {patient.history && <div className="detail-row"><span className="detail-label">History</span><span className="detail-val">{patient.history}</span></div>}
            <Row label="Comorbidities" value={comorbidities || null} />
            <Row label="Surgery status" value={patient.surgery_status === "postop" ? `Post-op (POD ${patient.postop_day ?? 0})` : patient.surgery_status} />
            <Row label="Operation" value={patient.operation} />
          </Sec>
          <Sec title="Condition">
            <Row label="General condition" value={patient.general_condition} />
            <Row label="Nutrition" value={patient.nutrition_status?.replace(/_/g, " ")} />
            <Row label="General examination" value={patient.general_examination} />
            <Row label="Abdomen" value={patient.abdomen_condition} />
            <Row label="Bowel condition" value={patient.bowel_condition?.replace(/_/g, " ")} />
            <Row label="Bowel sounds" value={patient.bowel_sounds?.replace(/_/g, " ")} />
            {patient.chest_condition_comment && <div className="detail-row"><span className="detail-label">Chest</span><span className="detail-val">{patient.chest_condition_comment}</span></div>}
          </Sec>
          {(patient.vital_temp || patient.vital_bp || patient.vital_hr || patient.vital_rr || patient.vital_spo2) && (
            <Sec title="Vital signs">
              <div className="vitals-row">
                {[{ l: "Temp", v: patient.vital_temp, u: "°C" }, { l: "BP", v: patient.vital_bp, u: "mmHg" }, { l: "HR", v: patient.vital_hr, u: "bpm" }, { l: "RR", v: patient.vital_rr, u: "/min" }, { l: "SpO₂", v: patient.vital_spo2, u: "%" }]
                  .filter(x => x.v).map(x => (
                    <div key={x.l} className="vital-card">
                      <div className="vital-val">{x.v}</div>
                      <div className="vital-label">{x.l} {x.u}</div>
                    </div>
                  ))}
              </div>
            </Sec>
          )}
          {tubes.length > 0 && (
            <Sec title="Tubes & drains">
              {tubes.map((tb, i) => (
                <div key={i} className="tube-item">
                  <div className="tube-name">{TUBE_TYPES.find(t => t.v === tb.tube_type)?.l || tb.tube_type} × {tb.quantity}{tb.site && <span className="tube-site"> — {tb.site}</span>}</div>
                  <div className="tube-details">
                    {tb.content_quantity && <span>Output: {tb.content_quantity}</span>}
                    {tb.content_color && <span>Color: {tb.content_color}</span>}
                    {tb.emptied_previous_days && <span>✓ Emptied</span>}
                  </div>
                </div>
              ))}
            </Sec>
          )}
          {(patient.labs_summary || patient.critical_labs) && (
            <Sec title="Labs">
              {patient.critical_labs && <div className="critical-box">⚠ Critical: {patient.critical_labs}</div>}
              {patient.labs_summary && <div className="detail-text">{patient.labs_summary}</div>}
              <AttachmentGallery patientId={patient.id} category="labs" token={token} />
            </Sec>
          )}
          {(patient.imaging_summary || patient.critical_imaging) && (
            <Sec title="Imaging">
              {patient.critical_imaging && <div className="critical-box">⚠ Critical: {patient.critical_imaging}</div>}
              {patient.imaging_summary && <div className="detail-text">{patient.imaging_summary}</div>}
              <AttachmentGallery patientId={patient.id} category="imaging" token={token} />
            </Sec>
          )}
          {patient.has_wound && (
            <Sec title="Wound">
              {patient.wound_condition && <div className="detail-text">{patient.wound_condition}</div>}
              {patient.wound_dressing_done_today && <div style={{ color: "#059669", fontSize: 13 }}>✓ Dressing done today</div>}
            </Sec>
          )}
          {(patient.handover_notes || patient.tasks_next_day) && (
            <Sec title="Handover notes & tasks">
              {patient.handover_notes && <><div className="sub-label">Notes</div><div className="detail-text">{patient.handover_notes}</div></>}
              {patient.tasks_next_day && <><div className="sub-label" style={{ marginTop: 10 }}>Tasks for tomorrow</div><div className="detail-text">{patient.tasks_next_day}</div></>}
            </Sec>
          )}
        </>
      )}
      <div style={{ height: 40 }} />
    </div>
  );
}

// ─── CASE PROGRESS (audit log timeline) ─────────────
const FIELD_LABELS = {
  general_condition: "Condition", diagnosis: "Diagnosis", surgery_status: "Surgery status",
  operation: "Operation", postop_day: "POD", nutrition_status: "Nutrition",
  general_examination: "General exam", abdomen_condition: "Abdomen",
  chest_condition_comment: "Chest", vital_hr: "HR", vital_rr: "RR", vital_spo2: "SpO2",
  vital_temp: "Temp", vital_bp: "BP", labs_summary: "Labs", critical_labs: "Critical labs",
  imaging_summary: "Imaging", critical_imaging: "Critical imaging", wound_condition: "Wound",
  handover_notes: "Handover notes", tasks_next_day: "Tasks", patient_status: "Status",
  ward_id: "Ward", other_speciality_diagnosis: "Other spec. Dx",
  consultation_cause: "Consult cause", consultation_reply: "Consult reply",
  consultation_admitted: "Admitted to supervision", awaiting_investigation: "Awaiting investigation",
  consultant_contacted: "Consultant contacted", consultant_contacted_name: "Consultant contacted (name)",
};

function CaseProgress({ token, patient, onBack, onHome }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wards, setWards] = useState([]);
  const [viewerIdx, setViewerIdx] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      dbGet(`audit_logs?table_name=eq.patients&record_id=eq.${patient.id}&order=changed_at.desc&select=id,action,changed_at,changed_by_name,old_data,new_data`, token),
      dbGet("wards?select=id,name", token),
      dbGet(`patient_attachments?patient_id=eq.${patient.id}&order=created_at.desc&select=id,category,file_path,uploaded_by_name,created_at`, token),
    ]).then(async ([h, w, a]) => {
      const edits = (Array.isArray(h) ? h : []).map(x => ({ ...x, _type: "edit" }));
      const rawPhotos = Array.isArray(a) ? a : [];
      const photos = await Promise.all(rawPhotos.map(async x => ({
        id: `photo_${x.id}`, _type: "photo", changed_at: x.created_at,
        changed_by_name: x.uploaded_by_name, category: x.category,
        url: await stSign(x.file_path, token),
      })));
      const merged = [...edits, ...photos].sort((p, q) => new Date(q.changed_at) - new Date(p.changed_at));
      setHistory(merged);
      setWards(Array.isArray(w) ? w : []);
      setLoading(false);
    });
  }, []);

  const allPhotos = history.filter(h => h._type === "photo");

  const rv = (val, field) => {
    if (val === null || val === undefined || val === "") return <span style={{ color: "#9CA3AF" }}>—</span>;
    if (typeof val === "boolean") return val ? "Yes" : "No";
    if (field === "Condition") return <span style={{ fontWeight: 600, color: COND_COLOR[val] || "#374151" }}>{val}</span>;
    if (field === "Ward" && typeof val === "string" && val.includes("-")) {
      const w = wards.find(x => x.id === val);
      return w ? w.name : <span style={{ color: "#9CA3AF", fontSize: 10 }}>Unknown ward</span>;
    }
    const s = String(val).replace(/_/g, " ");
    return s.length > 60 ? s.slice(0, 60) + "…" : s;
  };

  const getChanges = (h) => {
    const changes = [];
    const oldD = h.old_data || {}, newD = h.new_data || {};
    const keys = Object.keys(FIELD_LABELS);
    keys.forEach(k => {
      if (JSON.stringify(oldD[k]) !== JSON.stringify(newD[k])) {
        changes.push({ field: FIELD_LABELS[k], from: oldD[k], to: newD[k] });
      }
    });
    return changes;
  };

  const groups = []; const gMap = {};
  history.forEach(h => {
    const d = new Date(h.changed_at);
    const workDay = new Date(d);
    if (d.getHours() < 9) workDay.setDate(workDay.getDate() - 1);
    const key = workDay.toDateString();
    if (!gMap[key]) { gMap[key] = { key, date: workDay, entries: [] }; groups.push(gMap[key]); }
    gMap[key].entries.push(h);
  });

  return (
    <div className="detail-wrap">
      <div className="detail-header no-print">
        <button onClick={onBack} className="back-btn">←</button>
        <div style={{ flex: 1 }}>
          <div className="form-title">Case Progress</div>
          <div className="board-sub">{patient.name}</div>
        </div>
      </div>

      {loading && <div className="empty-state">Loading history...</div>}
      {!loading && groups.length === 0 && <div className="empty-state">No history recorded yet</div>}

      {groups.map(g => (
        <div key={g.key} style={{ marginBottom: 16, border: "1px solid #E5E7EB", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ background: "#0C2340", color: "white", padding: "8px 14px", fontSize: 13, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
            <span>{g.date.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</span>
            <span style={{ opacity: 0.7, fontWeight: 400 }}>{g.entries[g.entries.length - 1]?.changed_by_name}</span>
          </div>
          <div>
            {g.entries.map((h, ei) => {
              if (h._type === "photo") {
                return (
                  <div key={h.id} style={{ padding: "10px 14px", borderBottom: ei < g.entries.length - 1 ? "1px solid #F3F4F6" : "none" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        {h.url
                          ? <img src={h.url} onClick={() => setViewerIdx(allPhotos.findIndex(p => p.id === h.id))} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 6, border: "1px solid #E5E7EB", cursor: "pointer", flexShrink: 0 }} />
                          : <div style={{ width: 36, height: 36, borderRadius: 6, background: "#F3F4F6", flexShrink: 0 }} />}
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
                          📷 {h.category === "labs" ? "Lab" : "Imaging"} photo added <span style={{ fontWeight: 400, color: "#6B7280" }}>by {h.changed_by_name || "Unknown"}</span>
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: "#9CA3AF", flexShrink: 0 }}>{fmtTime(h.changed_at)}</div>
                    </div>
                  </div>
                );
              }
              const changes = getChanges(h); const isCreate = h.action === "INSERT";
              return (
                <div key={h.id} style={{ padding: "10px 14px", borderBottom: ei < g.entries.length - 1 ? "1px solid #F3F4F6" : "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
                      {isCreate ? "✚ Created" : "✎ Updated"} <span style={{ fontWeight: 400, color: "#6B7280" }}>by {h.changed_by_name || "Unknown"}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#9CA3AF" }}>{fmtTime(h.changed_at)}</div>
                  </div>
                  {changes.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {changes.map((c, j) => (
                        <div key={j} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, background: "#F8FAFC", borderRadius: 6, padding: "4px 8px" }}>
                          <span style={{ color: "#6B7280", minWidth: 85, flexShrink: 0 }}>{c.field}</span>
                          <span style={{ color: "#EF4444" }}>{rv(c.from, c.field)}</span>
                          <span style={{ color: "#D1D5DB" }}>→</span>
                          <span style={{ color: "#059669", fontWeight: 500 }}>{rv(c.to, c.field)}</span>
                        </div>
                      ))}
                    </div>
                  ) : <div style={{ fontSize: 12, color: "#9CA3AF" }}>{isCreate ? "Patient record created" : "No tracked changes"}</div>}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="bottom-nav no-print">
        <button onClick={onHome} className="btn-navy">🏥 Dashboard</button>
        <button onClick={onBack} className="btn-outline">← Patient info</button>
      </div>
      {viewerIdx !== null && <Lightbox
        images={allPhotos.map(p => ({ url: p.url, label: `${p.category === "labs" ? "Lab" : "Imaging"} · ${fmtDate(p.changed_at)}` }))}
        startIndex={viewerIdx}
        onClose={() => setViewerIdx(null)} />}
    </div>
  );
}

// ─── APP ROOT ────────────────────────────────────────
export default function App() {
  const [auth, setAuth] = useState(() => {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() - (parsed.savedAt || 0) > MAX_AGE_MS) { localStorage.removeItem(AUTH_KEY); return null; }
      return parsed;
    } catch { return null; }
  });
  const [approved, setApproved] = useState(() => {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || "{}").is_approved ?? null; } catch { return null; }
  });
  const [view, setView] = useState("board");
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (auth) { try { localStorage.setItem(AUTH_KEY, JSON.stringify(auth)); } catch (e) {} }
  }, [auth]);

  useEffect(() => {
    if (!auth?.user?.id) return;
    dbGet(`user_profiles?user_id=eq.${auth.user.id}&select=is_approved`, auth.token).then(r => {
      const isApproved = Array.isArray(r) && r[0] ? r[0].is_approved : false;
      setApproved(isApproved);
      setAuth(a => a ? { ...a, is_approved: isApproved } : a);
    });
  }, [auth?.user?.id]);

  const hiddenAt = useRef(null);
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) { hiddenAt.current = Date.now(); }
      else if (hiddenAt.current && Date.now() - hiddenAt.current > 3 * 60 * 1000) { setView("board"); setSelected(null); }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    const onPop = () => {
      if (view === "add" || view === "edit") setView(selected ? "detail" : "board");
      else if (view === "detail" || view === "caseprogress") setView("board");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [view, selected]);

  const go = (v, p) => { window.history.pushState({ v }, ""); setSelected(p ?? selected); setView(v); };

  const handleTokenExpired = () => { try { localStorage.removeItem(AUTH_KEY); } catch (e) {} setAuth(null); setApproved(null); };
  const handleLogout = () => { try { localStorage.removeItem(AUTH_KEY); } catch (e) {} setAuth(null); setApproved(null); };

  if (!auth) return <AuthScreen onAuth={a => { setAuth(a); }} />;
  if (approved === false) return <PendingScreen onLogout={handleLogout} />;

  if (view === "board") return <BoardView token={auth.token} user={auth.user} onSelect={p => go("detail", p)} onAdd={() => go("add", null)} onLogout={handleLogout} onTokenExpired={handleTokenExpired} />;
  if (view === "add" || view === "edit") return <PatientForm token={auth.token} user={auth.user} patient={view === "edit" ? selected : null} onSave={() => go("board")} onBack={() => go(view === "edit" ? "detail" : "board")} />;
  if (view === "detail") return <PatientDetail token={auth.token} user={auth.user} initial={selected} onBack={() => go("board")} onEdit={() => go("edit")} onCaseProgress={() => go("caseprogress")} />;
  if (view === "caseprogress") return <CaseProgress token={auth.token} patient={selected} onBack={() => go("detail")} onHome={() => go("board")} />;
  return null;
}

export { ErrorBoundary };
