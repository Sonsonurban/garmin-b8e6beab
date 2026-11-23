"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: (k) => { try { localStorage.removeItem(k); } catch {} } };

// ---------- formatting ----------
const pace = (secPerKm) => { if (!isFinite(secPerKm) || secPerKm <= 0) return "–"; const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60); return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`; };
const dur = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const km = (m, d = 1) => ((m || 0) / 1000).toFixed(d);
const fmtDate = (iso, opts = { weekday: "short", day: "numeric", month: "short" }) => new Date(iso.replace(" ", "T")).toLocaleDateString("es-CL", opts);
const hrs = (s) => (s ? (s / 3600).toFixed(1) : "–");
const TYPES = { running: "Correr", trail_running: "Trail", treadmill_running: "Cinta", cycling: "Ciclismo", walking: "Caminata", hiking: "Senderismo", strength_training: "Fuerza", lap_swimming: "Natación", open_water_swimming: "Natación" };
const isRun = (t) => ["running", "trail_running", "treadmill_running"].includes(t);
const ago = (iso) => { if (!iso) return "sin sincronizar"; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 2 ? "ahora" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`; };

// ---------- data: one encrypted file, opened in this browser with your passphrase ----------
let BUNDLE = null;
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
// Returns true when unlocked, false when a passphrase is needed. The derived key (not the passphrase)
// is kept on this device as a non-extractable key, so you type the passphrase once per phone.
async function loadBundle(pw) {
  const r = await fetch("data.bin?" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error("No se pudo descargar los datos (" + r.status + ")");
  const blob = new Uint8Array(await r.arrayBuffer());
  if (String.fromCharCode(...blob.slice(0, 3)) !== "MG1") throw new Error("Formato de datos desconocido");
  const salt = blob.slice(3, 19), id = hex(salt), cached = await keydb.get();
  if (cached && cached.salt === id) {
    try { BUNDLE = await openBlob(blob, cached.key); return true; } catch { await keydb.clear(); }
  }
  if (!pw) return false;
  const key = await deriveKey(pw, salt);
  BUNDLE = await openBlob(blob, key); // throws OperationError on a wrong passphrase
  await keydb.put({ salt: id, key });
  return true;
}
async function api(path, opts = {}) {
  if (!BUNDLE) { showLogin(); throw new Error("401"); }
  const u = new URL(path, location.href), q = u.searchParams, p = u.pathname.replace(/^.*\/api\//, "");
  if (p === "overview") return BUNDLE.overview;
  if (p === "activities") { const o = +q.get("offset") || 0, l = +q.get("limit") || 30, t = q.get("type"); return BUNDLE.activities.filter((a) => !t || a.type === t).slice(o, o + l); }
  const m = p.match(/^activity\/(\d+)$/);
  if (m) { const a = BUNDLE.activity[m[1]]; if (!a) throw new Error("404"); return JSON.parse(JSON.stringify(a)); }
  if (p === "daily") { const since = new Date(Date.now() - (+q.get("days") || 60) * 864e5).toLocaleDateString("sv-SE"); return BUNDLE.daily.filter((d) => d.date >= since); }
  if (p === "sync") { await loadBundle(); return { status: "ok" }; } // reloads the latest published data
  throw new Error("404");
}
function showLogin() { $("#app").hidden = true; $("#detail").hidden = true; $("#login").hidden = false; $("#pw").focus(); }
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#login-btn"); $("#login-err").textContent = ""; btn.disabled = true; btn.textContent = "Descifrando…";
  try {
    if (!(await loadBundle($("#pw").value))) throw new Error("Clave incorrecta");
    $("#pw").value = ""; $("#login").hidden = true; boot();
  } catch (err) { $("#login-err").textContent = err.name === "OperationError" ? "Clave incorrecta" : err.message; }
  btn.disabled = false; btn.textContent = "Entrar";
});

// ---------- charts (SVG, no libraries) ----------
const W = 340;
function barChart(vals, { h = 110, color = "var(--accent)", labels = [], fmt = (v) => v, hiLast = true } = {}) {
  const max = Math.max(...vals, 1), n = vals.length, bw = W / n, pad = 14;
  const bars = vals.map((v, i) => { const bh = (v / max) * (h - pad); return `<rect x="${i * bw + bw * .12}" y="${h - bh}" width="${bw * .76}" height="${Math.max(bh, v ? 2 : 0)}" rx="2.5" fill="${color}" opacity="${hiLast && i !== n - 1 ? .55 : 1}"/>`; }).join("");
  const step = Math.ceil(n / 6), lab = labels.map((l, i) => (i % step === 0 || i === n - 1) && l ? `<text x="${i * bw + bw / 2}" y="${h + 12}" text-anchor="middle">${esc(l)}</text>` : "").join("");
  return `<svg viewBox="0 0 ${W} ${h + 16}"><text x="0" y="8">${fmt(max)}</text>${bars}${lab}</svg>`;
}
function lineChart(series, { h = 110, labels = [], fmt = (v) => Math.round(v), zero = false } = {}) {
  const all = series.flatMap((s) => s.data.filter((v) => v != null));
  if (!all.length) return `<div class="muted">Sin datos todavía</div>`;
  let min = Math.min(...all), max = Math.max(...all); if (zero) { min = Math.min(min, 0); max = Math.max(max, 0); }
  if (min === max) { min -= 1; max += 1; }
  const n = Math.max(...series.map((s) => s.data.length)), X = (i) => (i / Math.max(n - 1, 1)) * (W - 4) + 2, Y = (v) => h - 6 - ((v - min) / (max - min)) * (h - 22);
  let out = `<text x="0" y="8">${fmt(max)}</text><text x="0" y="${h}">${fmt(min)}</text>`;
  if (zero) out += `<line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--line)" stroke-dasharray="3 3"/>`;
  for (const s of series) {
    let d = "", pen = false, last = null;
    s.data.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`; pen = true; last = [X(i), Y(v)]; });
    if (s.area) { const first = s.data.findIndex((v) => v != null); out += `<path d="${d}L${last[0]} ${h}L${X(first)} ${h}Z" fill="${s.color}" opacity=".12"/>`; }
    out += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (last) out += `<circle cx="${last[0]}" cy="${last[1]}" r="3.5" fill="${s.color}"/>`;
  }
  const step = Math.ceil(n / 5);
  out += labels.map((l, i) => (i % step === 0 ? `<text x="${X(i)}" y="${h + 12}" text-anchor="${i === 0 ? "start" : "middle"}">${esc(l)}</text>` : "")).join("");
  return `<svg viewBox="0 0 ${W} ${h + 16}">${out}</svg>`;
}
function heatmap(heat) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) - 25 * 7);
  const c = 11.5, g = 2.2; let out = "";
  const maxKm = Math.max(...Object.values(heat), 10);
  for (let w = 0; w < 26; w++) for (let d = 0; d < 7; d++) {
    const dt = new Date(monday); dt.setDate(monday.getDate() + w * 7 + d); if (dt > today) continue;
    const k = dt.toLocaleDateString("sv-SE"), v = heat[k] || 0;
    out += `<rect x="${w * (c + g)}" y="${d * (c + g)}" width="${c}" height="${c}" rx="3" fill="${v ? "var(--accent)" : "var(--surface2)"}" opacity="${v ? .3 + .7 * Math.min(v / maxKm, 1) : 1}"><title>${k}: ${v} km</title></rect>`;
  }
  return `<svg viewBox="0 0 ${26 * (c + g)} ${7 * (c + g)}">${out}</svg>`;
}
function routeSvg(poly) {
  const lat0 = poly.reduce((a, p) => a + p[0], 0) / poly.length, k = Math.cos((lat0 * Math.PI) / 180);
  const pts = poly.map((p) => [p[1] * k, -p[0]]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const hh = 230, s = Math.min((W - 30) / (x1 - x0 || 1), (hh - 30) / (y1 - y0 || 1)), ox = (W - (x1 - x0) * s) / 2, oy = (hh - (y1 - y0) * s) / 2;
  const P = pts.map((p) => [ox + (p[0] - x0) * s, oy + (p[1] - y0) * s]);
  return `<svg viewBox="0 0 ${W} ${hh}"><path d="M${P.map((p) => p.map((v) => v.toFixed(1)).join(" ")).join("L")}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${P[0][0]}" cy="${P[0][1]}" r="5" fill="var(--bg)" stroke="var(--accent2)" stroke-width="3"/><circle cx="${P.at(-1)[0]}" cy="${P.at(-1)[1]}" r="5" fill="var(--bad)"/></svg>`;
}
const stat = (v, unit, label) => `<div class="stat"><div class="v num">${v}<small>${unit}</small></div><div class="l">${label}</div></div>`;

// ---------- screens ----------
let tab = "home", period = "week", ov = null, actsLoaded = [], actsDone = false;

async function renderHome() {
  if (!ov) ov = await api("/api/overview");
  const p = ov.periods[period], wk = ov.weekly, cur = wk.at(-1), prev = wk.at(-2);
  const delta = p.prev_km ? Math.round(((p.km - p.prev_km) / p.prev_km) * 100) : null;
  const f = ov.form.at(-1) || {}, a = ov.acwr;
  const zone = a == null ? ["info", "Sin datos"] : a < 0.8 ? ["info", "Carga baja"] : a <= 1.3 ? ["good", "Zona óptima"] : a <= 1.5 ? ["warn", "Carga alta"] : ["bad", "Riesgo de lesión"];
  const d = ov.latest_daily, rd = d?.readiness;
  const R = ov.records, rc = (label, r, val, sub) => r ? `<button class="rec" data-act="${r.id}"><div>${label}<div class="muted">${fmtDate(r.date, { day: "numeric", month: "short", year: "numeric" })}</div></div><b class="num">${val}</b></button>` : "";
  $("#view").innerHTML = `
  <div class="card hero">
    <div class="seg" id="seg">${[["week", "7 días"], ["month", "Mes"], ["year", "Año"], ["all", "Total"]].map(([k, l]) => `<button data-p="${k}" class="${k === period ? "on" : ""}">${l}</button>`).join("")}</div>
    <div style="margin:14px 0 10px">${stat(p.km.toFixed(1), "km", `${p.runs} ${p.runs === 1 ? "salida" : "salidas"}${period === "week" && delta != null ? ` · ${delta >= 0 ? "+" : ""}${delta}% vs 7 días previos` : ""}`).replace('class="stat"', 'class="stat hero"')}</div>
    <div class="grid3">${stat(p.hours, "h", "tiempo")}${stat(p.gain.toLocaleString("es-CL"), "m", "desnivel +")}${stat(p.runs ? pace((p.hours * 3600) / p.km) : "–", "/km", "ritmo medio")}</div>
  </div>
  <div class="card"><h2>Volumen semanal · 26 semanas</h2>${barChart(wk.map((w) => w.km), { labels: wk.map((w) => new Date(w.week).toLocaleDateString("es-CL", { day: "numeric", month: "short" })), fmt: (v) => v.toFixed(0) + " km" })}</div>
  <div class="card">
    <div class="row"><h2 style="margin:0">Forma y carga</h2><span class="pill ${zone[0]}">${zone[1]}</span></div>
    <div class="grid3" style="margin:12px 0">${stat(Math.round(f.fitness ?? 0), "", "forma física")}${stat(Math.round(f.fatigue ?? 0), "", "fatiga")}${stat((f.form > 0 ? "+" : "") + Math.round(f.form ?? 0), "", "frescura")}</div>
    ${lineChart([{ data: ov.form.map((x) => x.fitness), color: "var(--accent2)", area: true }, { data: ov.form.map((x) => x.fatigue), color: "var(--warn)" }], { labels: ov.form.map((x) => new Date(x.date).toLocaleDateString("es-CL", { day: "numeric", month: "short" })) })}
    <div class="legend"><span><i style="background:var(--accent2)"></i>Forma (42 d)</span><span><i style="background:var(--warn)"></i>Fatiga (7 d)</span><span>Ratio agudo:crónico <b class="num">${a ?? "–"}</b></span></div>
  </div>
  ${d ? `<div class="card"><h2>Recuperación · ${fmtDate(d.date)}</h2><div class="grid3" style="row-gap:16px">
    ${rd != null ? stat(rd, "", "preparación") : stat(d.vo2max ? d.vo2max.toFixed(1) : (ov.vo2max.at(-1)?.vo2max ?? "–"), "", "VO₂ máx")}${stat(d.sleep_score ?? "–", "", `sueño · ${hrs(d.sleep_s)} h`)}${stat(d.hrv_avg ?? "–", "ms", `HRV · ${esc((d.hrv_status || "").toLowerCase())}`)}
    ${stat(d.resting_hr ?? "–", "lpm", "FC reposo")}${stat(d.bb_high ?? "–", "", "Body Battery máx")}${stat((d.steps ?? 0).toLocaleString("es-CL"), "", "pasos")}</div></div>` : ""}
  <div class="card"><h2>Constancia · 26 semanas</h2>${heatmap(ov.heat)}<div class="legend"><span>Más oscuro = menos km ese día</span></div></div>
  <div class="card"><h2>Mejores marcas</h2>
    ${rc("Ritmo en 5 km+", R.pace_5k, R.pace_5k ? pace(R.pace_5k.dur / (R.pace_5k.dist / 1000)) + " /km" : "")}
    ${rc("Ritmo en 10 km+", R.pace_10k, R.pace_10k ? pace(R.pace_10k.dur / (R.pace_10k.dist / 1000)) + " /km" : "")}
    ${rc("Ritmo en 21 km+", R.pace_21k, R.pace_21k ? pace(R.pace_21k.dur / (R.pace_21k.dist / 1000)) + " /km" : "")}
    ${rc("Salida más larga", R.longest, R.longest ? km(R.longest.dist) + " km" : "")}
    ${rc("Mayor desnivel", R.climb, R.climb ? Math.round(R.climb.gain) + " m" : "")}
    <div class="muted" style="margin-top:10px">Calculadas sobre la actividad completa, no sobre tramos.</div></div>
  ${ov.vo2max.length > 1 ? `<div class="card"><h2>VO₂ máx</h2>${lineChart([{ data: ov.vo2max.map((x) => x.vo2max), color: "var(--accent)", area: true }], { labels: ov.vo2max.map((x) => new Date(x.date).toLocaleDateString("es-CL", { day: "numeric", month: "short" })), fmt: (v) => v.toFixed(1) })}</div>` : ""}`;
  $("#seg").onclick = (e) => { const b = e.target.closest("button"); if (b) { period = b.dataset.p; renderHome(); } };
  $("#view").insertAdjacentHTML("beforeend", '<button class="more" id="lock">Bloquear en este teléfono</button>');
  $("#lock").onclick = async () => { await keydb.clear(); location.reload(); };
}

const actRow = (a) => `<button class="act" data-act="${a.id}"><div class="t">${esc(a.name || TYPES[a.type] || a.type)}</div><div class="km num">${isRun(a.type) || a.distance_m > 800 ? km(a.distance_m, 2) + " km" : dur(a.duration_s)}</div>
  <div class="m">${fmtDate(a.start_time)} · ${esc(TYPES[a.type] || a.type)}${a.avg_hr ? ` · ${Math.round(a.avg_hr)} lpm` : ""}</div><div class="m num" style="text-align:right">${a.distance_m > 800 ? pace(a.duration_s / (a.distance_m / 1000)) + " /km · " : ""}${dur(a.duration_s)}</div></button>`;

async function renderActs(more = false) {
  if (!more) { actsLoaded = []; actsDone = false; }
  if (!actsDone) {
    const rows = await api(`/api/activities?limit=30&offset=${actsLoaded.length}`);
    actsLoaded = actsLoaded.concat(rows); if (rows.length < 30) actsDone = true;
  }
  $("#view").innerHTML = actsLoaded.length ? `<div class="card list">${actsLoaded.map(actRow).join("")}</div>${actsDone ? "" : '<button class="more" id="more">Cargar más</button>'}` : `<div class="empty">Aún no hay actividades. Pulsa ⟳ para sincronizar.</div>`;
  const m = $("#more"); if (m) m.onclick = () => renderActs(true);
}

async function renderHealth() {
  const d = await api("/api/daily?days=30"); if (!d.length) { $("#view").innerHTML = `<div class="empty">Sin datos de salud todavía.</div>`; return; }
  const L = d.map((x) => new Date(x.date).toLocaleDateString("es-CL", { day: "numeric", month: "short" }));
  const avg = (k) => { const v = d.map((x) => x[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const stages = d.map((x) => ({ deep: x.deep_s || 0, rem: x.rem_s || 0, light: x.light_s || 0 }));
  const maxS = Math.max(...stages.map((s) => s.deep + s.rem + s.light), 1), bw = W / d.length, hh = 110;
  const sleepSvg = `<svg viewBox="0 0 ${W} ${hh + 16}"><text x="0" y="8">${(maxS / 3600).toFixed(0)} h</text>${stages.map((s, i) => { let y = hh, o = ""; for (const [k, c] of [["deep", "var(--z2)"], ["rem", "var(--z3)"], ["light", "var(--z1)"]]) { const bh = (s[k] / maxS) * (hh - 14); y -= bh; o += `<rect x="${i * bw + bw * .12}" y="${y}" width="${bw * .76}" height="${bh}" fill="${c}"/>`; } return o; }).join("")}</svg>`;
  $("#view").innerHTML = `
  <div class="card"><h2>Sueño · 30 noches</h2><div class="muted" style="margin-bottom:6px">Promedio ${hrs(avg("sleep_s"))} h · puntaje ${Math.round(avg("sleep_score") || 0) || "–"}</div>${sleepSvg}
    <div class="legend"><span><i style="background:var(--z2)"></i>Profundo</span><span><i style="background:var(--z3)"></i>REM</span><span><i style="background:var(--z1)"></i>Ligero</span></div></div>
  <div class="card"><h2>HRV nocturna</h2><div class="muted" style="margin-bottom:6px">Promedio ${Math.round(avg("hrv_avg") || 0) || "–"} ms</div>${lineChart([{ data: d.map((x) => x.hrv_avg), color: "var(--accent2)", area: true }], { labels: L, fmt: (v) => Math.round(v) + " ms" })}</div>
  <div class="card"><h2>FC en reposo</h2><div class="muted" style="margin-bottom:6px">Promedio ${Math.round(avg("resting_hr") || 0) || "–"} lpm</div>${lineChart([{ data: d.map((x) => x.resting_hr), color: "var(--bad)" }], { labels: L, fmt: (v) => Math.round(v) + " lpm" })}</div>
  <div class="card"><h2>Body Battery</h2>${lineChart([{ data: d.map((x) => x.bb_high), color: "var(--accent)", area: true }, { data: d.map((x) => x.bb_low), color: "var(--warn)" }], { labels: L })}<div class="legend"><span><i style="background:var(--accent)"></i>Máximo del día</span><span><i style="background:var(--warn)"></i>Mínimo</span></div></div>
  <div class="card"><h2>Estrés promedio</h2>${lineChart([{ data: d.map((x) => x.stress_avg), color: "var(--warn)" }], { labels: L })}</div>
  <div class="card"><h2>Pasos</h2><div class="muted" style="margin-bottom:6px">Promedio ${Math.round(avg("steps") || 0).toLocaleString("es-CL")} por día</div>${barChart(d.map((x) => x.steps || 0), { labels: L, fmt: (v) => (v / 1000).toFixed(0) + "k" })}</div>`;
}

async function openActivity(id) {
  $("#detail").hidden = false; $("#d-body").innerHTML = `<div class="empty">Cargando…</div>`; $("#detail").scrollTop = 0;
  const a = await api(`/api/activity/${id}`);
  $("#d-title").textContent = a.name || TYPES[a.type] || "Actividad";
  if (a.splits) a.splits = a.splits.filter((s) => !s.dist || s.dist >= 200);
  if (a.splits) a.splits.forEach((s) => { if (s.dist && s.dur) s.speed = s.dist / s.dur; });
  const speedMax = a.splits ? Math.max(...a.splits.map((s) => s.speed || 0), 0.1) : 1;
  const zc = ["var(--z1)", "var(--z2)", "var(--z3)", "var(--z4)", "var(--z5)"], zt = a.hr_zones ? a.hr_zones.reduce((x, y) => x + y, 0) || 1 : 1;
  const fast = a.splits ? Math.max(...a.splits.map((s) => s.speed || 0)) : 0;
  $("#d-body").innerHTML = `
  <div class="muted">${fmtDate(a.start_time, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${a.start_time.slice(11, 16)}</div>
  <div class="card"><div class="grid2" style="row-gap:16px">${stat(km(a.distance_m, 2), "km", "distancia")}${stat(dur(a.duration_s), "", "tiempo")}
    ${stat(a.distance_m ? pace(a.duration_s / (a.distance_m / 1000)) : "–", "/km", "ritmo medio")}${stat(Math.round(a.elev_gain || 0), "m", "desnivel +")}
    ${stat(a.avg_hr ? Math.round(a.avg_hr) : "–", "lpm", `FC media · máx ${a.max_hr ? Math.round(a.max_hr) : "–"}`)}${stat(a.avg_cadence ? Math.round(a.avg_cadence) : "–", "ppm", "cadencia")}
    ${stat(a.aerobic_te != null ? a.aerobic_te.toFixed(1) : "–", "", "efecto aeróbico")}${stat(a.load ? Math.round(a.load) : "–", "", a.load_est ? "carga (estimada)" : "carga de entreno")}</div></div>
  ${a.polyline && a.polyline.length > 3 ? `<div class="card"><h2>Ruta</h2>${routeSvg(a.polyline)}<div class="legend"><span><i style="background:var(--accent2)"></i>Inicio</span><span><i style="background:var(--bad)"></i>Fin</span></div></div>` : ""}
  ${a.hr_zones ? `<div class="card"><h2>Zonas de frecuencia cardíaca</h2>
    <div style="display:flex;height:18px;border-radius:9px;overflow:hidden;gap:2px">${a.hr_zones.map((s, i) => `<div style="flex:${Math.max(s, 0.001)};background:${zc[i] || zc[4]}"></div>`).join("")}</div>
    <div style="margin-top:12px;display:grid;gap:6px">${a.hr_zones.map((s, i) => `<div class="row"><span><i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${zc[i] || zc[4]};margin-right:8px"></i>Zona ${i + 1}</span><span class="num muted">${dur(s)} · ${Math.round((s / zt) * 100)}%</span></div>`).join("")}</div></div>` : ""}
  ${a.splits && a.splits.length > 1 ? `<div class="card"><h2>Parciales</h2><div style="display:grid;gap:7px">${a.splits.map((s, i) => { const p = s.speed ? 1000 / s.speed : 0; return `<div style="display:grid;grid-template-columns:22px 1fr 46px 34px;gap:8px;align-items:center;font-size:13px"><span class="muted num">${i + 1}</span><div style="background:var(--surface2);border-radius:5px;height:14px"><div style="width:${((s.speed || 0) / speedMax) * 100}%;height:100%;border-radius:5px;background:${s.speed === fast ? "var(--accent)" : "var(--accent2)"}"></div></div><span class="num">${pace(p)}</span><span class="num muted">${s.hr ? Math.round(s.hr) : ""}</span></div>`; }).join("")}</div>
    <div class="legend"><span>Ritmo por km · FC a la derecha · verde = más rápido</span></div></div>` : ""}`;
}
$("#back").onclick = () => { $("#detail").hidden = true; };
document.addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b) openActivity(b.dataset.act); });

// ---------- shell ----------
const TITLES = { home: "Resumen", acts: "Actividades", health: "Salud" };
async function show(t) {
  tab = t; $("#title").textContent = TITLES[t];
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
  try { await ({ home: renderHome, acts: () => renderActs(false), health: renderHealth }[t])(); }
  catch (e) { if (e.message !== "401") $("#view").innerHTML = `<div class="empty">No se pudo cargar (${esc(e.message)}).</div>`; }
  window.scrollTo(0, 0);
}
document.querySelector("nav").onclick = (e) => { const b = e.target.closest("button"); if (b) show(b.dataset.tab); };
$("#refresh").onclick = async () => {
  const btn = $("#refresh"); btn.classList.add("spin");
  try { await api("/api/sync", { method: "POST" }); ov = null; await show(tab); await updateSync(); }
  catch (e) { if (e.message !== "401") $("#sync").textContent = "Falló la sincronización"; }
  btn.classList.remove("spin");
};
async function updateSync() { try { const o = ov || (ov = await api("/api/overview")); $("#sync").textContent = `Actualizado ${ago(o.last_sync)} · ${o.activity_count} actividades`; } catch {} }
async function boot() {
  if (!BUNDLE) { try { if (!(await loadBundle())) return showLogin(); } catch (e) { showLogin(); $("#login-err").textContent = e.message; return; } }
  $("#app").hidden = false; $("#login").hidden = true; ov = null;
  await show(tab); updateSync();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && BUNDLE && tab === "home") { ov = null; show(tab); updateSync(); } });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
