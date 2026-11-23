"use strict";
/* Interactive SVG charts, no libraries.
   chart(host, {
     x: [..numbers],  xfmt: (x,i)=>string,
     kind: "line" | "bar" | "stack",
     series: [{name, y:[..], color, fmt, area, dash, hidden, noTip}],
     height, yMin, yMax, yfmt, invert (smaller = higher, for pace), zero (force 0 baseline),
     band: {lo:[..], hi:[..], color}     // shaded range per point (e.g. HRV balanced band)
     refs: [{y, label, color}],           // horizontal reference lines
     avg: true,                           // dashed average line + "vs average" in the tooltip
     delta: true,                         // "vs previous" in the tooltip
     group: ChartGroup,                   // charts in a group scrub together
     onScrub: (i)=>void,
   })
   Touch: drag a finger across the chart (vertical swipes still scroll the page). */

const NS = "http://www.w3.org/2000/svg";
const W = 360;

function niceTicks(min, max, n = 4) {
  const span = max - min || 1, raw = span / n, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 1e-6; v += step) out.push(+v.toFixed(10));
  return out;
}
const esc2 = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

class ChartGroup {
  constructor() { this.items = []; }
  add(c) { this.items.push(c); }
  emit(i, src) { this.items.forEach((c) => c !== src && c.setIndex(i, true)); }
  clear(src) { this.items.forEach((c) => c !== src && c.clearIndex(true)); }
}

function chart(host, o) {
  const n = (o.x || []).length;
  host.classList.add("chart");
  if (!n) { host.innerHTML = '<div class="muted pad">Sin datos para este período</div>'; return null; }
  const kind = o.kind || "line", H = o.height || 150;
  const m = { l: o.yLabels === false ? 8 : 40, r: 10, t: 10, b: o.xLabels === false ? 6 : 20 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const series = o.series.filter((s) => !s.hidden);
  const yfmt = o.yfmt || ((v) => (Math.abs(v) >= 100 ? Math.round(v) : +v.toFixed(1)).toLocaleString("es-CL"));

  // y extent
  let lo = Infinity, hi = -Infinity;
  if (kind === "stack") {
    for (let i = 0; i < n; i++) { const t = series.reduce((a, s) => a + (s.y[i] || 0), 0); hi = Math.max(hi, t); }
    lo = 0;
  } else {
    for (const s of series) for (const v of s.y) if (v != null && isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (o.band) { for (const v of o.band.lo) if (v != null) lo = Math.min(lo, v); for (const v of o.band.hi) if (v != null) hi = Math.max(hi, v); }
    if (kind === "bar" || o.zero) lo = Math.min(lo, 0);
  }
  if (!isFinite(lo)) { host.innerHTML = '<div class="muted pad">Sin datos para este período</div>'; return null; }
  if (o.yMin != null) lo = o.yMin;
  if (o.yMax != null) hi = o.yMax;
  if (hi === lo) { hi += 1; lo -= 1; }
  if (o.yMin == null && kind === "line" && !o.zero) { const p = (hi - lo) * 0.08; lo -= p; }
  if (o.yMax == null) hi += (hi - lo) * 0.04;
  let ticks;
  if (o.step) { ticks = []; for (let v = Math.ceil(lo / o.step) * o.step; v <= hi + 1e-9; v += o.step) ticks.push(v); }
  else ticks = niceTicks(lo, hi, 4).filter((t) => t >= lo - 1e-9 && t <= hi + 1e-9);
  const X = (i) => (kind === "bar" || kind === "stack" ? m.l + ((i + 0.5) * pw) / n : m.l + (n === 1 ? pw / 2 : (i * pw) / (n - 1)));
  const Y = (v) => { const f = (v - lo) / (hi - lo); return o.invert ? m.t + f * ph : m.t + ph - f * ph; };
  const base = Y(Math.max(lo, 0) === 0 && !o.invert ? 0 : lo);

  let g = "";
  for (const t of ticks) {
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/>`;
    if (o.yLabels !== false) g += `<text x="${m.l - 5}" y="${Y(t) + 3}" text-anchor="end">${esc2(yfmt(t))}</text>`;
  }
  if (o.band) {
    const up = [], dn = [];
    for (let i = 0; i < n; i++) if (o.band.lo[i] != null && o.band.hi[i] != null) { up.push([X(i), Y(o.band.hi[i])]); dn.push([X(i), Y(o.band.lo[i])]); }
    if (up.length > 1) g += `<path d="M${up.map((p) => p.join(" ")).join("L")}L${dn.reverse().map((p) => p.join(" ")).join("L")}Z" fill="${o.band.color || "var(--accent)"}" opacity=".13"/>`;
  }
  for (const r of o.refs || []) {
    if (r.y < lo || r.y > hi) continue;
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(r.y)}" y2="${Y(r.y)}" stroke="${r.color || "var(--muted)"}" stroke-dasharray="4 4" opacity=".7"/>`;
    if (r.label) g += `<text x="${W - m.r}" y="${Y(r.y) - 3}" text-anchor="end" fill="${r.color || "var(--muted)"}">${esc2(r.label)}</text>`;
  }
  let avgVal = null;
  if (o.avg && series[0]) {
    const v = series[0].y.filter((x) => x != null);
    if (v.length) { avgVal = v.reduce((a, b) => a + b, 0) / v.length; g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(avgVal)}" y2="${Y(avgVal)}" stroke="var(--fg)" stroke-dasharray="2 4" opacity=".35"/>`; }
  }
  if (kind === "bar") {
    const bw = Math.max(1, (pw / n) * 0.72), s = series[0];
    s.y.forEach((v, i) => { if (v == null) return; const y = Y(v); g += `<rect class="bar" data-i="${i}" x="${X(i) - bw / 2}" y="${Math.min(y, base)}" width="${bw}" height="${Math.max(Math.abs(base - y), v ? 1 : 0)}" rx="${Math.min(3, bw / 3)}" fill="${s.color}"/>`; });
  } else if (kind === "stack") {
    const bw = Math.max(1, (pw / n) * 0.72);
    for (let i = 0; i < n; i++) { let acc = 0; for (const s of series) { const v = s.y[i] || 0; if (!v) continue; g += `<rect class="bar" data-i="${i}" x="${X(i) - bw / 2}" y="${Y(acc + v)}" width="${bw}" height="${Math.max(Y(acc) - Y(acc + v), 0.5)}" fill="${s.color}"/>`; acc += v; } }
  } else {
    for (const s of series) {
      let d = "", pen = false, first = null, last = null;
      s.y.forEach((v, i) => { if (v == null || !isFinite(v)) { pen = false; return; } const x = X(i), y = Y(v); d += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`; pen = true; if (!first) first = [x, y]; last = [x, y]; });
      if (!first) continue;
      if (s.area) g += `<path d="${d}L${last[0]} ${base}L${first[0]} ${base}Z" fill="${s.color}" opacity=".14"/>`;
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w || 2}" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ' stroke-dasharray="5 4"' : ""}/>`;
      if (n < 60) s.y.forEach((v, i) => { if (v != null) g += `<circle cx="${X(i)}" cy="${Y(v)}" r="2.2" fill="${s.color}"/>`; });
      else g += `<circle cx="${last[0]}" cy="${last[1]}" r="3.2" fill="${s.color}"/>`;
    }
  }
  if (o.xLabels !== false) {
    const k = Math.min(n, o.xTicks || 5);
    for (let t = 0; t < k; t++) {
      const i = k === 1 ? 0 : Math.round((t * (n - 1)) / (k - 1));
      g += `<text x="${X(i)}" y="${H - 5}" text-anchor="${t === 0 ? "start" : t === k - 1 ? "end" : "middle"}">${esc2((o.xlab || o.xfmt || String)(o.x[i], i))}</text>`;
    }
  }
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img"><g>${g}</g><line class="cross" y1="${m.t}" y2="${m.t + ph}" style="display:none"/><g class="dots"></g></svg><div class="tip" style="display:none"></div>`;
  const svg = host.querySelector("svg"), cross = svg.querySelector(".cross"), dots = svg.querySelector(".dots"), tip = host.querySelector(".tip");

  const api = {
    host,
    setIndex(i, silent) {
      i = Math.max(0, Math.min(n - 1, i));
      const x = X(i);
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.style.display = "";
      let dd = "", rows = "";
      let acc = 0;
      const compact = !!silent;  // charts moved by another chart show only their own value
      series.forEach((s) => {
        const v = s.y[i];
        if (v == null) return;
        const top = kind === "stack" ? (acc += v, acc) : v;
        if (kind === "line") dd += `<circle cx="${x}" cy="${Y(top)}" r="4.2" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
        if (s.noTip) return;
        const f = s.fmt || yfmt;
        let extra = "";
        if (!compact && o.delta && i > 0 && s.y[i - 1] != null && kind !== "stack") { const dv = v - s.y[i - 1]; extra = `<em class="${dv === 0 ? "" : (o.invert ? dv < 0 : dv > 0) ? "up" : "dn"}">${dv > 0 ? "+" : dv < 0 ? "−" : ""}${f(Math.abs(dv))}</em>`; }
        if (!compact && o.avg && s === series[0] && avgVal != null) { const dv = v - avgVal; extra += `<em class="avg">${dv >= 0 ? "+" : "−"}${f(Math.abs(dv))} vs prom.</em>`; }
        rows += `<div><i style="background:${s.color}"></i>${esc2(s.name)}<b>${esc2(f(v))}</b>${extra}</div>`;
      });
      dots.innerHTML = dd;
      tip.className = "tip" + (compact ? " sm" : "");
      tip.innerHTML = compact ? rows : `<div class="th">${esc2((o.xfmt || String)(o.x[i], i))}</div>${o.tipExtra ? o.tipExtra(i) : ""}${rows}`;
      tip.style.display = "";
      const pct = (x / W) * 100;
      tip.style.left = pct > 58 ? "auto" : `calc(${pct}% + 8px)`;
      tip.style.right = pct > 58 ? `calc(${100 - pct}% + 8px)` : "auto";
      api.index = i;
      if (!silent) { o.group && o.group.emit(i, api); o.onScrub && o.onScrub(i); }
    },
    clearIndex(silent) { cross.style.display = "none"; dots.innerHTML = ""; tip.style.display = "none"; api.index = null; if (!silent) { o.group && o.group.clear(api); o.onScrub && o.onScrub(null); } },
  };
  const idx = (e) => {
    const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    return kind === "bar" || kind === "stack" ? Math.floor(((px - m.l) / pw) * n) : Math.round(((px - m.l) / pw) * (n - 1));
  };
  svg.addEventListener("pointerdown", (e) => api.setIndex(idx(e)));
  svg.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" || e.buttons || e.pressure > 0) api.setIndex(idx(e)); });
  svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") api.clearIndex(); });
  o.group && o.group.add(api);
  return api;
}

// Row of chips that picks a range / metric. cb(value) runs on change.
function chips(host, options, current, cb) {
  host.classList.add("chips");
  host.innerHTML = options.map(([v, l]) => `<button data-v="${esc2(v)}" class="${v === current ? "on" : ""}">${esc2(l)}</button>`).join("");
  host.onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    host.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    cb(b.dataset.v);
  };
}

// Circular gauge 0-100 (recovery, effort...)
function ring(pct, color, big, small) {
  const r = 44, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct ?? 0));
  return `<svg viewBox="0 0 110 110" class="ring"><circle cx="55" cy="55" r="${r}" fill="none" stroke="var(--surface2)" stroke-width="10"/>${pct == null ? "" : `<circle cx="55" cy="55" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(c * p) / 100} ${c}" transform="rotate(-90 55 55)"/>`}<text x="55" y="${small ? 56 : 62}" text-anchor="middle" class="rb">${esc2(big)}</text>${small ? `<text x="55" y="73" text-anchor="middle" class="rs">${esc2(small)}</text>` : ""}</svg>`;
}
