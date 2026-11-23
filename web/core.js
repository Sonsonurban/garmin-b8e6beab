"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- formatting ----------
const N = (v, d = 0) => (v == null || !isFinite(v) ? "–" : Number(v).toLocaleString("es-CL", { maximumFractionDigits: d, minimumFractionDigits: d }));
const pace = (s) => { if (s == null || !isFinite(s) || s <= 0) return "–"; let m = Math.floor(s / 60), x = Math.round(s % 60); if (x === 60) { m++; x = 0; } return `${m}:${String(x).padStart(2, "0")}`; };
const dur = (s) => { if (s == null) return "–"; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const hm = (s) => (s == null ? "–" : `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, "0")}`);
const km = (m, d = 1) => (m == null ? "–" : N(m / 1000, d));
const dt = (iso, o = { weekday: "short", day: "numeric", month: "short" }) => new Date(iso.length > 10 ? iso.replace(" ", "T") : iso + "T12:00:00").toLocaleDateString("es-CL", o);
const dshort = (iso) => dt(iso, { day: "numeric", month: "short" });
const dmy = (iso) => dt(iso, { day: "numeric", month: "short", year: "numeric" });
const ago = (iso) => { if (!iso) return "sin sincronizar"; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 2 ? "ahora" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`; };
const TYPES = { running: "Correr", trail_running: "Trail", track_running: "Pista", treadmill_running: "Cinta", virtual_run: "Correr", cycling: "Ciclismo", indoor_cycling: "Bici fija", walking: "Caminata", hiking: "Senderismo", strength_training: "Fuerza", lap_swimming: "Natación", open_water_swimming: "Natación", breathwork: "Respiración", indoor_cardio: "Cardio", fitness_equipment: "Gimnasio" };
const tname = (t) => TYPES[t] || (t || "Actividad").replace(/_/g, " ");
const ICON = { run: "🏃", cycling: "🚴", strength_training: "🏋", walking: "🚶", hiking: "🥾", swim: "🏊", other: "●" };
const iconOf = (a) => (a.run ? ICON.run : /cycl/.test(a.ty) ? ICON.cycling : /strength|fitness/.test(a.ty) ? ICON.strength_training : /walk/.test(a.ty) ? ICON.walking : /hik/.test(a.ty) ? ICON.hiking : /swim/.test(a.ty) ? ICON.swim : ICON.other);

// ---------- dates ----------
const isoDay = (d) => d.toLocaleDateString("sv-SE");
const todayIso = () => isoDay(new Date());
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return isoDay(d); };
const weekStart = (iso) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDay(d); };
const monthKey = (iso) => iso.slice(0, 7);
const sum = (a, f = (x) => x) => a.reduce((t, x) => t + (f(x) || 0), 0);
const mean = (a) => { const v = a.filter((x) => x != null && isFinite(x)); return v.length ? v.reduce((p, c) => p + c, 0) / v.length : null; };
const pctile = (v, arr) => { const a = arr.filter((x) => x != null); if (a.length < 5 || v == null) return null; return (100 * a.filter((x) => x < v).length + 50 * a.filter((x) => x === v).length) / a.length; };
const rolling = (y, k) => y.map((_, i) => { const w = y.slice(Math.max(0, i - k + 1), i + 1).filter((v) => v != null); return w.length >= Math.min(3, k) ? w.reduce((a, b) => a + b, 0) / w.length : null; });
// range that ignores start/stop artefacts: 2nd-98th percentile with a little padding
const robust = (arr, lo = 0.02, hi = 0.98) => { const v = arr.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b); if (v.length < 10) return null; const a = v[Math.floor(v.length * lo)], b = v[Math.min(v.length - 1, Math.ceil(v.length * hi) - 1)], pad = (b - a) * 0.1 || 1; return [a - pad, b + pad]; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const stat = (v, unit, label, cls = "") => `<div class="stat ${cls}"><div class="v num">${v}${unit ? `<small>${unit}</small>` : ""}</div><div class="l">${label}</div></div>`;
const delta = (cur, prev, invert = false, unit = "%") => {
  if (cur == null || prev == null || !prev) return `<span class="d0">–</span>`;
  const p = ((cur - prev) / Math.abs(prev)) * 100, good = invert ? p < 0 : p > 0;
  return `<span class="${Math.abs(p) < 0.5 ? "d0" : good ? "dup" : "ddn"}">${p > 0 ? "▲" : p < 0 ? "▼" : "•"} ${N(Math.abs(p), Math.abs(p) < 10 ? 1 : 0)}${unit}</span>`;
};
const card = (title, body, opts = {}) => `<section class="card ${opts.cls || ""}">${title ? `<div class="row ch"><h2>${title}</h2>${opts.right || ""}</div>` : ""}${opts.sub ? `<div class="muted sub">${opts.sub}</div>` : ""}${body}</section>`;

// ---------- encrypted data, opened in the browser with your passphrase ----------
let BUNDLE = null, D = null;
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const keydb = {
  open: () => new Promise((res, rej) => { const r = indexedDB.open("mg", 1); r.onupgradeneeded = () => r.result.createObjectStore("k"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
  async get() { try { const d = await this.open(); return await new Promise((res) => { const q = d.transaction("k").objectStore("k").get("key"); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch { return null; } },
  async put(v) { try { const d = await this.open(); await new Promise((res) => { const t = d.transaction("k", "readwrite"); t.objectStore("k").put(v, "key"); t.oncomplete = res; t.onerror = res; }); } catch {} },
  async clear() { try { const d = await this.open(); await new Promise((res) => { const t = d.transaction("k", "readwrite"); t.objectStore("k").clear(); t.oncomplete = res; t.onerror = res; }); } catch {} },
};
async function deriveKey(pw, salt) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
}
async function openBlob(blob, key) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.slice(19, 31) }, key, blob.slice(31));
  const text = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(text);
}
// true = unlocked, false = passphrase needed. The derived key (not the passphrase) stays on this device.
async function loadBundle(pw) {
  const r = await fetch("data.bin?" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error("No se pudo descargar los datos (" + r.status + ")");
  const blob = new Uint8Array(await r.arrayBuffer());
  if (String.fromCharCode(...blob.slice(0, 3)) !== "MG1") throw new Error("Formato de datos desconocido");
  const salt = blob.slice(3, 19), id = hex(salt), cached = await keydb.get();
  if (cached && cached.salt === id) {
    try { BUNDLE = await openBlob(blob, cached.key); D = prepare(BUNDLE); return true; } catch { await keydb.clear(); }
  }
  if (!pw) return false;
  const key = await deriveKey(pw, salt);
  BUNDLE = await openBlob(blob, key); // OperationError on a wrong passphrase
  D = prepare(BUNDLE);
  await keydb.put({ salt: id, key });
  return true;
}

// ---------- prepared data ----------
function prepare(B) {
  const d = { B };
  d.acts = B.activities.map((a) => ({ ...a, date: a.s.slice(0, 10), ts: +new Date(a.s.replace(" ", "T")), pace: a.d > 0 && a.t ? a.t / (a.d / 1000) : null, act: a.cal != null ? Math.max(0, a.cal - (a.bmr || 0)) : null }));
  d.byId = new Map(d.acts.map((a) => [a.id, a]));
  d.runs = d.acts.filter((a) => a.run && a.d > 800);
  d.daily = B.daily;
  d.dm = new Map(B.daily.map((x) => [x.date, x]));
  d.load = B.load;
  d.lm = new Map(B.load.dates.map((x, i) => [x, { load: B.load.load[i], atl: B.load.atl[i], ctl: B.load.ctl[i] }]));
  d.first = d.acts.length ? d.acts[0].date : todayIso();
  return d;
}
const sinceFor = (range) => ({ "7d": addDays(todayIso(), -6), "4w": addDays(todayIso(), -27), "30d": addDays(todayIso(), -29), "12w": addDays(todayIso(), -83), "90d": addDays(todayIso(), -89), "6m": addDays(todayIso(), -182), "1y": addDays(todayIso(), -364), all: "0000-00-00" }[range] || "0000-00-00");

// recovery score 0-100: where last night sits against YOUR own recent history (self-calibrating)
function recovery(date) {
  const row = D.dm.get(date); if (!row) return null;
  const hist = D.daily.filter((x) => x.date <= date && x.date > addDays(date, -60));
  const parts = [];
  const hp = pctile(row.hrv, hist.map((x) => x.hrv)); if (hp != null) parts.push([hp, 0.4, "HRV", `${row.hrv} ms`]);
  const rp = pctile(row.rhr, hist.map((x) => x.rhr)); if (rp != null) parts.push([100 - rp, 0.2, "FC reposo", `${row.rhr} lpm`]);
  if (row.sleepScore != null) parts.push([row.sleepScore, 0.25, "Sueño", `puntaje ${row.sleepScore}`]);
  if (row.bbW != null) parts.push([row.bbW, 0.15, "Batería al despertar", `${row.bbW}/100`]);
  if (parts.length < 2) return null;
  const w = sum(parts, (p) => p[1]);
  return { score: Math.round(sum(parts, (p) => p[0] * p[1]) / w), parts: parts.map((p) => ({ v: Math.round(p[0]), n: p[2], raw: p[3] })) };
}
// effort of a day as % of your usual hard day (90th percentile of the last 90 days with training)
function effortPct(date) {
  const loads = []; for (let i = 0; i < 90; i++) { const l = D.lm.get(addDays(date, -i)); if (l && l.load > 0) loads.push(l.load); }
  if (loads.length < 5) return null;
  loads.sort((a, b) => a - b);
  const ref = loads[Math.floor(loads.length * 0.9)];
  const l = D.lm.get(date);
  return Math.round(((l ? l.load : 0) / ref) * 100);
}
// weekly load vs your 4-week weekly average, in %
function loadRatio(date) {
  const wk = (end) => { let t = 0; for (let i = 0; i < 7; i++) { const l = D.lm.get(addDays(end, -i)); t += l ? l.load : 0; } return t; };
  const acute = wk(date);
  const chronic = (wk(date) + wk(addDays(date, -7)) + wk(addDays(date, -14)) + wk(addDays(date, -21))) / 4;
  return chronic > 0 ? { pct: Math.round((acute / chronic) * 100), acute: Math.round(acute), chronic: Math.round(chronic) } : null;
}
const ratioZone = (p) => (p == null ? ["info", "Sin datos"] : p < 80 ? ["info", "Carga baja"] : p <= 120 ? ["good", "Zona óptima"] : p <= 150 ? ["warn", "Carga alta"] : ["bad", "Carga muy alta"]);

// ---------- shell ----------
const TABS = { home: "Hoy", acts: "Entrenos", prog: "Progreso", health: "Salud", recs: "Récords" };
let tab = "home";
const VIEWS = {};
async function api() { /* data is local now */ }
function showLogin() { $("#app").hidden = true; $("#detail").hidden = true; $("#login").hidden = false; $("#pw").focus(); }
async function show(t) {
  if (!D) return;
  tab = t; $("#title").textContent = TABS[t];
  $$("nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  try { await VIEWS[t](); }
  catch (e) { console.error(e); $("#view").innerHTML = `<div class="empty">No se pudo mostrar esta pantalla (${esc(e.message)}).</div>`; }
  window.scrollTo(0, 0);
}
function updateSync() { const o = BUNDLE; $("#sync").textContent = `Actualizado ${ago(o.last_sync)} · ${D.acts.length} actividades`; }
async function boot() {
  if (!BUNDLE) { try { if (!(await loadBundle())) return showLogin(); } catch (e) { showLogin(); $("#login-err").textContent = e.message; return; } }
  $("#app").hidden = false; $("#login").hidden = true;
  await show(tab); updateSync();
}
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#login-btn"); $("#login-err").textContent = ""; btn.disabled = true; btn.textContent = "Descifrando…";
  try {
    if (!(await loadBundle($("#pw").value))) throw new Error("Clave incorrecta");
    $("#pw").value = ""; $("#login").hidden = true; boot();
  } catch (err) { $("#login-err").textContent = err.name === "OperationError" ? "Clave incorrecta" : err.message; }
  btn.disabled = false; btn.textContent = "Entrar";
});
$("nav").onclick = (e) => { const b = e.target.closest("button"); if (b) { $("#detail").hidden = true; show(b.dataset.tab); } };
$("#refresh").onclick = async () => {
  const btn = $("#refresh"); btn.classList.add("spin");
  try { await loadBundle(); await show(tab); updateSync(); } catch (e) { $("#sync").textContent = "No se pudo actualizar"; }
  btn.classList.remove("spin");
};
document.addEventListener("visibilitychange", async () => { if (!document.hidden && BUNDLE) { try { const prev = BUNDLE.generated; await loadBundle(); if (BUNDLE.generated !== prev) { show(tab); updateSync(); } } catch {} } });
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]"); if (b) { openActivity(+b.dataset.act); return; }
  if (!e.target.closest(".chart")) $$(".chart .tip").forEach((t) => (t.style.display = "none"));
});
$("#back").onclick = () => { $("#detail").hidden = true; };
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
