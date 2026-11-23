"use strict";
const RANGES = [["4w", "4 sem"], ["12w", "12 sem"], ["6m", "6 meses"], ["1y", "1 año"], ["all", "Todo"]];
const mk = (id, o) => { const el = $(id); if (el) return chart(el, o); };
const dlab = (d) => dshort(d);

// ============================== PROGRESO ==============================
const P = { range: "12w", vol: "km", hr: "140", dyn: "cad" };
function periodStats(from, to) {
  const A = D.acts.filter((a) => a.date >= from && a.date <= to), R = A.filter((a) => a.run && a.d > 800);
  const d = sum(R, (a) => a.d), t = sum(R, (a) => a.t);
  return { n: A.length, runs: R.length, km: d / 1000, time: sum(A, (a) => a.t), gain: sum(R, (a) => a.gain), pace: d ? t / (d / 1000) : null, hr: mean(R.map((a) => a.hr)), cal: sum(A, (a) => a.cal), load: sum(A, (a) => a.ld) };
}
function compareTable(title, a, b, la, lb) {
  const rows = [["Salidas de carrera", "runs", 0, false], ["Kilómetros", "km", 1, false], ["Tiempo total", "time", 0, false, hm], ["Desnivel +", "gain", 0, false], ["Ritmo medio", "pace", 0, true, pace], ["FC media", "hr", 0, true], ["Calorías", "cal", 0, false], ["Carga", "load", 0, false]];
  return card(title, `<div class="cmp"><div class="ch"><span></span><span>${la}</span><span>${lb}</span><span>Δ</span></div>${rows.map(([n, k, dec, inv, f]) => `<div class="cr"><span>${n}</span><b class="num">${f ? f(a[k]) : N(a[k], dec)}</b><span class="num muted">${f ? f(b[k]) : N(b[k], dec)}</span>${delta(a[k], b[k], inv)}</div>`).join("")}</div>`);
}
function trendNote(y, invert, unit, fmtv) {
  const v = y.filter((x) => x != null); if (v.length < 6) return "";
  const k = Math.max(2, Math.floor(v.length / 4)), a = mean(v.slice(0, k)), b = mean(v.slice(-k)), dv = b - a, good = invert ? dv < 0 : dv > 0;
  return `<div class="trend"><span>Primeros ${k} vs últimos ${k}</span><b class="${Math.abs(dv) < 1e-9 ? "d0" : good ? "dup" : "ddn"}">${dv > 0 ? "+" : dv < 0 ? "−" : ""}${fmtv(Math.abs(dv))}${unit}</b></div>`;
}
VIEWS.prog = () => {
  const today = todayIso(), since = sinceFor(P.range);
  const runs = D.runs.filter((a) => a.date >= since);
  let h = `<div id="p-range"></div>`;
  h += compareTable("Últimos 28 días vs 28 anteriores", periodStats(addDays(today, -27), today), periodStats(addDays(today, -55), addDays(today, -28)), "28 d", "previos");
  h += compareTable("Últimos 7 días vs 7 anteriores", periodStats(addDays(today, -6), today), periodStats(addDays(today, -13), addDays(today, -7)), "7 d", "previos");

  h += card("Volumen por semana", `<div id="p-volc"></div><div id="c-vol"></div>`);
  h += card("Ritmo a pulso fijo", `<div id="p-hrc"></div><div id="c-ph"></div><div id="n-ph"></div><div class="muted note">A qué ritmo corres cuando tu pulso está en esa banda (±5 lpm). Si el ritmo baja con el mismo pulso, tu base mejora.</div>`);
  h += card("Eficiencia aeróbica", `<div id="c-ef"></div><div id="n-ef"></div><div class="muted note">Velocidad por cada latido (m/min por lpm). Más alto = más eficiente. Línea gruesa: promedio móvil de 5 salidas.</div>`);
  h += card("Deriva cardíaca", `<div id="c-dec"></div><div class="muted note">Cuánto cae tu eficiencia en la 2ª mitad de una salida larga. Bajo 5% indica buena base aeróbica.</div>`);
  h += card("Forma, fatiga y balance", `<div class="mt">Forma (42 d) y fatiga (7 d)</div><div id="c-ctl"></div><div class="mt">Balance (forma − fatiga)</div><div id="c-tsb"></div><div class="mt">Carga semanal vs tu promedio</div><div id="c-ratio"></div><div class="legend"><span><i style="background:var(--accent2)"></i>menos de 80%: baja</span><span><i style="background:var(--good)"></i>80–120%: óptima</span><span><i style="background:var(--warn)"></i>120–150%: alta</span></div>`);
  const hzs = [0, 1, 2, 3, 4].map((i) => sum(runs, (a) => (a.hz || [])[i])), hzt = sum(hzs) || 1;
  h += card("Tiempo por zona de pulso", `<div id="c-zones"></div><div class="grid3" style="margin-top:10px">${stat(N(((hzs[0] + hzs[1]) / hzt) * 100), "%", "Zonas 1–2 (fácil)")}${stat(N((hzs[2] / hzt) * 100), "%", "Zona 3 (moderado)")}${stat(N(((hzs[3] + hzs[4]) / hzt) * 100), "%", "Zonas 4–5 (duro)")}</div><div class="muted note">Minutos por semana en cada zona. Muchos entrenadores buscan cerca de 80% fácil y 20% duro.</div>`);
  h += card("VO₂ máx", `<div id="c-vo2"></div>`);
  h += card("Dinámica de carrera", `<div id="p-dync"></div><div id="c-dyn"></div><div id="n-dyn"></div>`);
  const wx = D.runs.filter((a) => a.w && a.w.temp != null && a.d >= 3000);
  if (wx.length >= 8) h += card("Ritmo según temperatura", `<div id="c-wx"></div><div class="muted note">Promedio de tus salidas de 3 km o más por rango de temperatura (${wx.length} salidas con clima).</div>`);
  $("#view").innerHTML = h;

  chips($("#p-range"), RANGES, P.range, (v) => { P.range = v; VIEWS.prog(); });

  // weekly volume
  const wk = new Map();
  for (let d = weekStart(since < D.first ? D.first : since); d <= today; d = addDays(d, 7)) wk.set(d, { km: 0, h: 0, gain: 0, cal: 0, n: 0 });
  for (const a of D.acts.filter((a) => a.date >= since)) {
    const w = wk.get(weekStart(a.date)); if (!w) continue;
    if (a.run) { w.km += (a.d || 0) / 1000; w.gain += a.gain || 0; w.n++; }
    w.h += (a.t || 0) / 3600; w.cal += a.cal || 0;
  }
  const VOLS = { km: ["Km", "var(--accent)", (v) => N(v, 1) + " km", "km"], h: ["Horas", "var(--accent2)", (v) => N(v, 1) + " h", "h"], gain: ["Desnivel", "var(--z4)", (v) => N(v) + " m", "gain"], cal: ["Kcal", "var(--bad)", (v) => N(v) + " kcal", "cal"], n: ["Salidas", "var(--z3)", (v) => N(v), "n"] };
  const drawVol = () => { const v = VOLS[P.vol], ks = [...wk.keys()]; mk("#c-vol", { kind: "bar", x: ks, xfmt: (x) => "Sem. " + dlab(x), xlab: dlab, series: [{ name: v[0], y: ks.map((k) => wk.get(k)[v[3]]), color: v[1], fmt: v[2] }], height: 160, avg: true, delta: true, yfmt: (x) => N(x, x < 10 ? 1 : 0) }); };
  chips($("#p-volc"), Object.entries(VOLS).map(([k, v]) => [k, v[0]]), P.vol, (v) => { P.vol = v; drawVol(); });
  drawVol();

  // pace at fixed HR
  const drawPh = () => {
    const pts = runs.filter((a) => a.ph && a.ph[P.hr]);
    const y = pts.map((a) => a.ph[P.hr]);
    mk("#c-ph", { x: pts.map((a) => a.s), xfmt: (x) => dlab(x.slice(0, 10)), series: [{ name: `Ritmo a ${P.hr} lpm`, y, color: "var(--accent2)", fmt: (v) => pace(v) + " /km", w: 1.2 }, { name: "Promedio móvil", y: rolling(y, 5), color: "var(--accent)", fmt: (v) => pace(v) + " /km", w: 3 }], height: 160, invert: true, yfmt: (v) => pace(v), step: 30, delta: false });
    $("#n-ph").innerHTML = trendNote(y, true, " /km", (v) => Math.round(v) + " s");
  };
  chips($("#p-hrc"), [["130", "130 lpm"], ["140", "140 lpm"], ["150", "150 lpm"], ["160", "160 lpm"]], P.hr, (v) => { P.hr = v; drawPh(); });
  drawPh();

  const efp = runs.filter((a) => a.ef && a.d >= 3000), efy = efp.map((a) => a.ef);
  mk("#c-ef", { x: efp.map((a) => a.s), xfmt: (x) => dlab(x.slice(0, 10)), series: [{ name: "Eficiencia", y: efy, color: "var(--accent2)", fmt: (v) => N(v, 2), w: 1.2 }, { name: "Promedio móvil", y: rolling(efy, 5), color: "var(--accent)", fmt: (v) => N(v, 2), w: 3 }], height: 150, yfmt: (v) => N(v, 2) });
  $("#n-ef").innerHTML = trendNote(efy, false, "", (v) => N(v, 2));
  const dp = runs.filter((a) => a.dec != null);
  mk("#c-dec", { kind: "bar", x: dp.map((a) => a.s), xfmt: (x) => dlab(x.slice(0, 10)), series: [{ name: "Deriva", y: dp.map((a) => a.dec), color: "var(--warn)", fmt: (v) => N(v, 1) + "%" }], height: 130, refs: [{ y: 5, label: "5%", color: "var(--good)" }], yfmt: (v) => N(v) + "%", avg: true });

  // load model over the range
  const li = D.load.dates.map((d, i) => i).filter((i) => D.load.dates[i] >= since);
  const L = (k) => li.map((i) => D.load[k][i]), LD = li.map((i) => D.load.dates[i]);
  mk("#c-ctl", { x: LD, xfmt: dlab, series: [{ name: "Forma", y: L("ctl"), color: "var(--accent2)", area: true, fmt: (v) => N(v, 1) }, { name: "Fatiga", y: L("atl"), color: "var(--warn)", fmt: (v) => N(v, 1) }], height: 150, delta: true });
  mk("#c-tsb", { x: LD, xfmt: dlab, kind: "line", series: [{ name: "Balance", y: li.map((i) => +(D.load.ctl[i] - D.load.atl[i]).toFixed(1)), color: "var(--accent)", area: true, fmt: (v) => (v > 0 ? "+" : "") + N(v, 1) }], height: 110, zero: true, refs: [{ y: 0, color: "var(--muted)" }] });
  const rx = LD.filter((d, i) => i % 3 === 0 || i === LD.length - 1), rv = rx.map((d) => { const r = loadRatio(d); return r ? r.pct : null; });
  mk("#c-ratio", { x: rx, xfmt: dlab, series: [{ name: "Carga vs promedio", y: rv, color: "var(--fg)", fmt: (v) => N(v) + "%", area: false }], height: 130, yMin: 0, yfmt: (v) => N(v) + "%", refs: [{ y: 80, color: "var(--accent2)" }, { y: 120, color: "var(--warn)" }, { y: 150, color: "var(--bad)" }], band: { lo: rx.map(() => 80), hi: rx.map(() => 120), color: "var(--good)" } });

  // zones per week
  const zw = new Map([...wk.keys()].map((k) => [k, [0, 0, 0, 0, 0]]));
  for (const a of runs) { const z = zw.get(weekStart(a.date)); if (z) (a.hz || []).forEach((s, i) => (z[i] += s / 60)); }
  const zk = [...zw.keys()];
  mk("#c-zones", { kind: "stack", x: zk, xfmt: (x) => "Sem. " + dlab(x), xlab: dlab, series: [0, 1, 2, 3, 4].map((i) => ({ name: "Zona " + (i + 1), y: zk.map((k) => Math.round(zw.get(k)[i])), color: ZC[i], fmt: (v) => v + " min" })), height: 150, yfmt: (v) => N(v) + " min" });

  // vo2
  const vp = D.acts.filter((a) => a.v2 && a.date >= since);
  mk("#c-vo2", { x: vp.map((a) => a.s), xfmt: (x) => dlab(x.slice(0, 10)), series: [{ name: "VO₂ máx", y: vp.map((a) => a.v2), color: "var(--accent)", area: true, fmt: (v) => N(v, 1) }], height: 130, delta: true, yfmt: (v) => N(v, 1) });

  // running dynamics
  const DYN = { cad: ["Cadencia", "cad", "ppm", 1, (v) => Math.round(v)], sl: ["Zancada", "sl", "m", 0, (v) => N((v > 10 ? v / 100 : v), 2)], gct: ["Contacto", "gct", "ms", 1, (v) => Math.round(v)], vo: ["Oscilación", "vo", "cm", 1, (v) => N(v, 1)], vr: ["Ratio vert.", "vr", "%", 1, (v) => N(v, 1)], pw: ["Potencia", "pw", "W", 1, (v) => Math.round(v)] };
  const drawDyn = () => {
    const [name, key, unit, , f] = DYN[P.dyn], pts = runs.filter((a) => a[key]), y = pts.map((a) => a[key]);
    mk("#c-dyn", { x: pts.map((a) => a.s), xfmt: (x) => dlab(x.slice(0, 10)), series: [{ name, y, color: "var(--accent2)", fmt: (v) => f(v) + " " + unit, w: 1.2 }, { name: "Promedio móvil", y: rolling(y, 5), color: "var(--accent)", fmt: (v) => f(v) + " " + unit, w: 3 }], height: 150, yfmt: f });
    $("#n-dyn").innerHTML = trendNote(y, false, " " + unit, f);
  };
  chips($("#p-dync"), Object.entries(DYN).map(([k, v]) => [k, v[0]]), P.dyn, (v) => { P.dyn = v; drawDyn(); });
  drawDyn();

  if (wx.length >= 8) {
    const B = [["< 5°", -99, 5], ["5–10°", 5, 10], ["10–15°", 10, 15], ["15–20°", 15, 20], ["≥ 20°", 20, 99]].map(([l, a, b]) => { const s = wx.filter((r) => r.w.temp >= a && r.w.temp < b); return { l, n: s.length, p: s.length ? mean(s.map((r) => r.pace)) : null }; });
    mk("#c-wx", { kind: "bar", x: B.map((b) => b.l), xfmt: (x) => x, series: [{ name: "Ritmo medio", y: B.map((b) => b.p), color: "var(--z3)", fmt: (v) => pace(v) + " /km" }], height: 130, yfmt: pace, yMin: Math.max(0, Math.min(...B.filter((b) => b.p).map((b) => b.p)) * 0.8), tipExtra: (i) => `<div class="muted">${B[i].n} salidas</div>` });
  }
};

// ============================== SALUD ==============================
const S = { range: "30d", night: null, day: null };
const QUAL = { EXCELLENT: "Excelente", GOOD: "Bueno", FAIR: "Regular", POOR: "Deficiente" };
const SUBN = { totalDuration: "Duración", stress: "Estrés", awakeCount: "Despertares", restlessness: "Inquietud", remPercentage: "REM", lightPercentage: "Ligero", deepPercentage: "Profundo" };
const QC = { EXCELLENT: "var(--good)", GOOD: "var(--good)", FAIR: "var(--warn)", POOR: "var(--bad)" };
function hypnogram(sl) {
  const lv = sl.levels || []; if (!lv.length) return "";
  const t0 = lv[0][0], t1 = lv[lv.length - 1][1], span = t1 - t0 || 1, rowOf = { 3: 0, 2: 1, 1: 2, 0: 3 }, col = { 3: "var(--z4)", 2: "var(--z3)", 1: "var(--z1)", 0: "var(--z2)" }, names = { 3: "Despierto", 2: "REM", 1: "Ligero", 0: "Profundo" };
  const L = 52, Wd = 360 - L - 6, rh = 22;
  let g = [3, 2, 1, 0].map((k, r) => `<text x="${L - 6}" y="${r * rh + 15}" text-anchor="end">${names[k]}</text><line x1="${L}" x2="354" y1="${r * rh + rh}" y2="${r * rh + rh}" class="grid"/>`).join("");
  g += lv.map((s, i) => `<rect data-i="${i}" x="${L + ((s[0] - t0) / span) * Wd}" y="${rowOf[s[2]] * rh + 3}" width="${Math.max(1.5, ((s[1] - s[0]) / span) * Wd)}" height="${rh - 6}" rx="3" fill="${col[s[2]]}"/>`).join("");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<text x="${L + f * Wd}" y="${4 * rh + 12}" text-anchor="${f === 0 ? "start" : f === 1 ? "end" : "middle"}">${clock(t0 + f * span)}</text>`).join("");
  return `<div class="chart hyp"><svg viewBox="0 0 360 ${4 * rh + 16}" id="hypsvg">${g}${ticks}</svg><div class="tip" id="hyptip" style="display:none"></div></div>`;
}
function hypBind(sl) {
  const svg = $("#hypsvg"); if (!svg) return;
  const names = { 3: "Despierto", 2: "REM", 1: "Ligero", 0: "Profundo" }, tip = $("#hyptip");
  const on = (e) => { const r = e.target.closest("rect"); if (!r) return; const s = sl.levels[+r.dataset.i]; tip.innerHTML = `<div class="th">${names[s[2]]}</div><div>${clock(s[0])} – ${clock(s[1])}</div><div class="muted">${Math.round((s[1] - s[0]) / 60000)} min</div>`; tip.style.display = ""; };
  svg.addEventListener("pointerdown", on); svg.addEventListener("pointermove", (e) => { if (e.buttons || e.pointerType === "mouse") on(e); });
}
VIEWS.health = () => {
  const today = todayIso(), since = sinceFor(S.range);
  const rows = D.daily.filter((r) => r.date >= since);
  const x = rows.map((r) => r.date), xf = (d) => dlab(d);
  const nights = D.daily.filter((r) => D.B.sleep[r.date]).slice(-7).map((r) => r.date);
  if (!S.night || !D.B.sleep[S.night]) S.night = nights[nights.length - 1];
  const sl = D.B.sleep[S.night];
  const cDays = Object.keys(D.B.curves).filter((d) => D.B.curves[d].bb && D.B.curves[d].bb.length > 3).sort().slice(-7);
  if (!S.day || !D.B.curves[S.day]) S.day = cDays[cDays.length - 1];
  let h = `<div id="h-range"></div>`;
  if (sl) {
    h += card("Sueño de una noche", `<div id="h-night"></div><div class="row" style="margin:12px 0"><div class="stat hero"><div class="v num">${hm(sl.dur)}</div><div class="l">dormido · puntaje ${sl.score ?? "–"}</div></div><div class="stat"><div class="v num">${sl.needAct ? hm(sl.needAct * 60) : "–"}</div><div class="l">necesidad (base ${sl.needBase ? hm(sl.needBase * 60) : "–"})</div></div></div>${stageBar(sl)}
      ${hypnogram(sl)}
      <div class="subs">${Object.entries(sl.sub || {}).filter(([, v]) => v && v[1]).map(([k, v]) => `<div class="row"><span>${SUBN[k] || k}</span><span><i class="dot" style="background:${QC[v[1]] || "var(--muted)"}"></i>${QUAL[v[1]] || v[1]}</span></div>`).join("")}</div>
      <div class="grid3" style="margin-top:12px;row-gap:12px">${stat(N(sl.hr), "lpm", "FC durmiendo")}${stat(N(sl.hrv), "ms", "HRV nocturna")}${stat(N(sl.resp, 1), "rpm", "respiración")}${stat(N(sl.stress), "", "estrés nocturno")}${stat(sl.bbChg != null ? (sl.bbChg > 0 ? "+" : "") + sl.bbChg : "–", "", "Body Battery")}${stat(N(sl.awakeN), "", "despertares")}</div>
      ${sl.hrc && sl.hrc.length > 3 ? `<div class="mt">Pulso durante la noche</div><div id="c-sleephr"></div>` : ""}`, { sub: S.night ? dt(S.night, { weekday: "long", day: "numeric", month: "long" }) : "" });
  }
  h += card("Sueño: tendencia", `<div class="mt">Horas por fase</div><div id="c-sleep"></div><div class="legend"><span><i style="background:var(--z2)"></i>Profundo</span><span><i style="background:var(--z3)"></i>REM</span><span><i style="background:var(--z1)"></i>Ligero</span></div><div class="mt">Puntaje</div><div id="c-sscore"></div>`);
  h += card("HRV nocturna", `<div id="c-hrv"></div><div class="legend"><span><i style="background:var(--accent2)"></i>Anoche</span><span><i style="background:var(--warn)"></i>Promedio 7 d</span><span><i style="background:var(--good);opacity:.4"></i>Tu rango equilibrado</span></div>`);
  h += card("FC en reposo", `<div id="c-rhr"></div>`);
  h += card("Estrés", `<div class="mt">Promedio del día</div><div id="c-stress"></div><div class="mt">Distribución del día (%)</div><div id="c-sdist"></div><div class="legend"><span><i style="background:var(--z2)"></i>Reposo</span><span><i style="background:var(--z3)"></i>Bajo</span><span><i style="background:var(--z4)"></i>Medio</span><span><i style="background:var(--z5)"></i>Alto</span></div>`);
  h += card("Body Battery", `<div id="c-bb"></div><div class="legend"><span><i style="background:var(--accent)"></i>Máximo</span><span><i style="background:var(--warn)"></i>Mínimo</span></div><div class="mt">Recargado y gastado</div><div id="c-bbcd"></div><div class="legend"><span><i style="background:var(--good)"></i>Recargado</span><span><i style="background:var(--bad)"></i>Gastado</span></div>`);
  h += card("Calorías por día", `<div id="c-kcal"></div><div class="legend"><span><i style="background:var(--z1)"></i>En reposo</span><span><i style="background:var(--accent)"></i>Activas</span></div>`);
  h += card("Pasos", `<div id="c-steps"></div>`);
  h += card("Pisos subidos", `<div id="c-floors"></div>`);
  h += card("Minutos de intensidad por semana", `<div id="c-int"></div><div class="legend"><span><i style="background:var(--z3)"></i>Moderados</span><span><i style="background:var(--z5)"></i>Intensos (cuentan doble)</span><span>meta 150</span></div>`);
  h += card("Respiración en vigilia", `<div id="c-resp"></div>`);
  if (D.B.weights && D.B.weights.length) h += card("Peso", `<div id="c-weight"></div>`);
  if (S.day) h += card("Un día en detalle", `<div id="h-day"></div><div class="mt">Body Battery</div><div id="d-bb"></div><div class="mt">Estrés</div><div id="d-st"></div><div class="mt">Frecuencia cardíaca</div><div id="d-hr"></div>`, { cls: "curves" });
  $("#view").innerHTML = h;

  chips($("#h-range"), [["7d", "7 días"], ["30d", "30 días"], ["90d", "90 días"], ["1y", "1 año"], ["all", "Todo"]], S.range, (v) => { S.range = v; VIEWS.health(); });
  if (sl) {
    chips($("#h-night"), nights.map((d) => [d, dt(d, { weekday: "short", day: "numeric" })]), S.night, (v) => { S.night = v; VIEWS.health(); });
    hypBind(sl);
    if (sl.hrc && sl.hrc.length > 3) mk("#c-sleephr", { x: sl.hrc.map((p) => p[0]), xfmt: clock, series: [{ name: "FC", y: sl.hrc.map((p) => p[1]), color: "var(--bad)", area: true }], height: 100, yfmt: (v) => Math.round(v) });
  }
  const sr = rows.filter((r) => r.sleepS), srx = sr.map((r) => r.date);
  mk("#c-sleep", { kind: "stack", x: srx, xfmt: xf, series: [["Profundo", "deep", "var(--z2)"], ["REM", "rem", "var(--z3)"], ["Ligero", "light", "var(--z1)"]].map(([n, k, c]) => ({ name: n, y: sr.map((r) => +((r[k] || 0) / 3600).toFixed(2)), color: c, fmt: (v) => N(v, 1) + " h" })), height: 150, yfmt: (v) => N(v) + " h", tipExtra: (i) => `<div class="muted">Total ${hm(sr[i].sleepS)} · puntaje ${sr[i].sleepScore ?? "–"}</div>` });
  mk("#c-sscore", { x: srx, xfmt: xf, series: [{ name: "Puntaje", y: sr.map((r) => r.sleepScore), color: "var(--z2)", area: true, fmt: (v) => N(v) }], height: 110, yMin: 40, yMax: 100, delta: true, avg: true });
  mk("#c-hrv", { x, xfmt: xf, series: [{ name: "HRV", y: rows.map((r) => r.hrv), color: "var(--accent2)", fmt: (v) => N(v) + " ms" }, { name: "Prom. 7 d", y: rows.map((r) => r.hrvW), color: "var(--warn)", fmt: (v) => N(v) + " ms", dash: true }], height: 150, band: { lo: rows.map((r) => r.hrvLo), hi: rows.map((r) => r.hrvUp), color: "var(--good)" }, delta: true });
  mk("#c-rhr", { x, xfmt: xf, series: [{ name: "FC reposo", y: rows.map((r) => r.rhr), color: "var(--bad)", area: true, fmt: (v) => N(v) + " lpm" }], height: 120, delta: true, avg: true });
  mk("#c-stress", { x, xfmt: xf, series: [{ name: "Estrés", y: rows.map((r) => r.stress), color: "var(--warn)", area: true, fmt: (v) => N(v) }], height: 110, delta: true, avg: true });
  const sp = rows.filter((r) => r.sp);
  mk("#c-sdist", { kind: "stack", x: sp.map((r) => r.date), xfmt: xf, series: [["Reposo", 0, "var(--z2)"], ["Bajo", 1, "var(--z3)"], ["Medio", 2, "var(--z4)"], ["Alto", 3, "var(--z5)"]].map(([n, i, c]) => ({ name: n, y: sp.map((r) => r.sp[i] || 0), color: c, fmt: (v) => N(v) + "%" })), height: 120, yMax: 100, yfmt: (v) => v + "%" });
  mk("#c-bb", { x, xfmt: xf, series: [{ name: "Máximo", y: rows.map((r) => r.bbH), color: "var(--accent)", area: true }, { name: "Mínimo", y: rows.map((r) => r.bbL), color: "var(--warn)" }], height: 130, yMin: 0, yMax: 100, delta: true });
  mk("#c-bbcd", { x, xfmt: xf, series: [{ name: "Recargado", y: rows.map((r) => r.bbC), color: "var(--good)" }, { name: "Gastado", y: rows.map((r) => r.bbD), color: "var(--bad)" }], height: 110 });
  const kc = rows.filter((r) => r.kT);
  mk("#c-kcal", { kind: "stack", x: kc.map((r) => r.date), xfmt: xf, series: [{ name: "En reposo", y: kc.map((r) => r.kB), color: "var(--z1)", fmt: (v) => N(v) + " kcal" }, { name: "Activas", y: kc.map((r) => r.kA), color: "var(--accent)", fmt: (v) => N(v) + " kcal" }], height: 150, yfmt: (v) => N(v), tipExtra: (i) => `<div class="muted">Total ${N(kc[i].kT)} kcal</div>` });
  const goal = [...rows].reverse().find((r) => r.sg)?.sg;
  mk("#c-steps", { kind: "bar", x, xfmt: xf, series: [{ name: "Pasos", y: rows.map((r) => r.steps), color: "var(--accent2)", fmt: (v) => N(v) }], height: 140, refs: goal ? [{ y: goal, label: "meta " + N(goal), color: "var(--good)" }] : [], avg: true, delta: true, yfmt: (v) => N(v) });
  mk("#c-floors", { kind: "bar", x, xfmt: xf, series: [{ name: "Pisos", y: rows.map((r) => r.fl), color: "var(--z4)", fmt: (v) => N(v) }], height: 110, avg: true });
  const iw = new Map();
  for (const r of D.daily.filter((r) => r.date >= since)) { const k = weekStart(r.date), w = iw.get(k) || iw.set(k, [0, 0]).get(k); w[0] += r.mod || 0; w[1] += 2 * (r.vig || 0); }
  const ik = [...iw.keys()];
  mk("#c-int", { kind: "stack", x: ik, xfmt: (v) => "Sem. " + dlab(v), xlab: dlab, series: [{ name: "Moderados", y: ik.map((k) => iw.get(k)[0]), color: "var(--z3)", fmt: (v) => v + " min" }, { name: "Intensos ×2", y: ik.map((k) => iw.get(k)[1]), color: "var(--z5)", fmt: (v) => v + " min" }], height: 130, refs: [{ y: 150, label: "meta 150", color: "var(--good)" }], yfmt: (v) => N(v) });
  mk("#c-resp", { x, xfmt: xf, series: [{ name: "Respiración", y: rows.map((r) => r.rW), color: "var(--z2)", area: true, fmt: (v) => N(v, 1) + " rpm" }], height: 110, delta: true, avg: true });
  if (D.B.weights && D.B.weights.length) mk("#c-weight", { x: D.B.weights.map((w) => w.date), xfmt: xf, series: [{ name: "Peso", y: D.B.weights.map((w) => w.kg), color: "var(--accent)", fmt: (v) => N(v, 1) + " kg" }], height: 110, delta: true });
  if (S.day) {
    chips($("#h-day"), cDays.map((d) => [d, dt(d, { weekday: "short", day: "numeric" })]), S.day, (v) => { S.day = v; VIEWS.health(); });
    const c = D.B.curves[S.day], grp = new ChartGroup();
    const mc = (id, arr, color, name, o = {}) => mk(id, { x: arr.map((p) => p[0]), xfmt: clock, series: [{ name, y: arr.map((p) => p[1]), color, area: true }], height: 105, group: grp, ...o });
    mc("#d-bb", c.bb, "var(--accent)", "Body Battery", { yMin: 0, yMax: 100 }); mc("#d-st", c.stress, "var(--warn)", "Estrés", { yMin: 0, yMax: 100 }); mc("#d-hr", c.hr, "var(--bad)", "FC", { yfmt: (v) => Math.round(v) });
  }
};

// ============================== RÉCORDS ==============================
const R = { best: "1000", rec: null, day: null };
const PRN = { 1: ["1 km", "t"], 2: ["1 milla", "t"], 3: ["5 km", "t"], 4: ["10 km", "t"], 5: ["Media maratón", "t"], 6: ["Maratón", "t"], 7: ["Salida más larga", "m"], 8: ["Bici más larga", "m"], 12: ["Más pasos en un día", "n"], 13: ["Más pasos en una semana", "n"], 14: ["Más pasos en un mes", "n"] };
VIEWS.recs = () => {
  const today = todayIso();
  const recs = (D.B.records || []).filter((r) => PRN[r.type] && r.value).sort((a, b) => a.type - b.type);
  let h = "";
  if (recs.length) h += card("Récords personales (Garmin)", recs.map((r) => { const [n, k] = PRN[r.type]; return `<button class="rec" ${r.act ? `data-act="${r.act}"` : ""}><div>${n}<div class="muted">${r.date ? dmy(r.date) : ""}</div></div><b class="num">${k === "t" ? dur(r.value) : k === "n" ? N(r.value) : km(r.value, 2) + " km"}${k === "t" && r.type !== 7 ? `<small class="muted"> · ${pace(r.value / ({ 1: 1, 2: 1.609, 3: 5, 4: 10, 5: 21.0975, 6: 42.195 }[r.type]))}/km</small>` : ""}</b></button>`; }).join(""));
  const pred = D.B.predictions || {}, pk = Object.keys(pred).sort();
  if (pk.length) {
    const cur = pred[pk[pk.length - 1]], dist = [5, 10, 21.0975, 42.195];
    h += card("Predicciones de carrera", `<div class="grid2" style="row-gap:14px">${["5 km", "10 km", "Media maratón", "Maratón"].map((n, i) => stat(cur[i] ? dur(cur[i]) : "–", "", `${n} · ${cur[i] ? pace(cur[i] / dist[i]) : "–"} /km`)).join("")}</div>${pk.length > 1 ? `<div class="mt">Evolución</div><div id="c-pred"></div>` : `<div class="muted note">Garmin no guarda el historial de predicciones: desde hoy la app guarda una por día para que veas cómo cambian.</div>`}`, { sub: "al " + dmy(pk[pk.length - 1]) });
  }
  h += card("Mejores tramos en el tiempo", `<div id="r-bestc"></div><div id="c-best"></div><div class="muted note">Tu mejor tramo de esa distancia dentro de cada salida. Línea verde: tu mejor marca acumulada.</div>`);
  if ((D.B.gear || []).length) h += card("Zapatillas", D.B.gear.map((g) => { const dk = (g.dist || 0) / 1000, mx = (g.max || 0) / 1000, p = mx ? clamp((dk / mx) * 100, 0, 100) : 0; return `<div class="gear"><div class="row"><b>${esc(g.name || g.model || "Zapatillas")}</b><span class="num muted">${N(dk)}${mx ? " / " + N(mx) : ""} km</span></div>${mx ? `<div class="pbar big"><i style="width:${p}%;background:${p > 90 ? "var(--bad)" : p > 75 ? "var(--warn)" : "var(--good)"}"></i></div><div class="muted note">${N(p)}% de vida útil · ${g.acts ?? "–"} actividades${g.since ? " · desde " + dmy(g.since) : ""}</div>` : ""}</div>`; }).join(""));
  h += card("Kilómetros por mes", `<div id="c-month"></div>`);
  h += card("Calendario", `<div id="c-cal"></div><div class="legend"><span>Cada cuadro es un día; más intenso = más km. Toca uno para ver sus actividades.</span></div><div id="cal-day"></div>`);
  const top = (arr, key, fmtv, n = 5) => arr.slice().sort((a, b) => b[key] - a[key]).slice(0, n).map((a) => `<button class="rec" data-act="${a.id}"><div>${dt(a.s, { day: "numeric", month: "short", year: "numeric" })}<div class="muted">${km(a.d, 1)} km · ${pace(a.pace)} /km</div></div><b class="num">${fmtv(a)}</b></button>`).join("");
  h += card("Salidas más largas", top(D.runs, "d", (a) => km(a.d, 2) + " km"));
  h += card("Más desnivel", top(D.runs, "gain", (a) => N(a.gain) + " m"));
  h += card("Más calorías", top(D.acts.filter((a) => a.cal), "cal", (a) => N(a.cal) + " kcal"));
  $("#view").innerHTML = h;

  if (pk.length > 1) mk("#c-pred", { x: pk, xfmt: dlab, series: [{ name: "5 km", y: pk.map((k) => pred[k][0]), color: "var(--accent)", fmt: dur }, { name: "10 km", y: pk.map((k) => pred[k][1]), color: "var(--accent2)", fmt: dur }], height: 130, invert: true, yfmt: dur });
  const B = { 1000: ["1 km"], 1609: ["1 milla"], 5000: ["5 km"], 10000: ["10 km"] };
  const drawBest = () => {
    const pts = D.acts.filter((a) => a.bs && a.bs[R.best]), y = pts.map((a) => a.bs[R.best]); let m = Infinity; const cum = y.map((v) => (m = Math.min(m, v)));
    mk("#c-best", { x: pts.map((a) => a.s), xfmt: (x) => dlab(x.slice(0, 10)), series: [{ name: "Ese tramo", y, color: "var(--accent2)", fmt: dur, w: 1.2 }, { name: "Mejor marca", y: cum, color: "var(--good)", fmt: dur, w: 2.5 }], height: 160, invert: true, yfmt: dur });
  };
  chips($("#r-bestc"), Object.entries(B).map(([k, v]) => [k, v[0]]), R.best, (v) => { R.best = v; drawBest(); });
  drawBest();
  const mo = new Map(); for (const a of D.runs) mo.set(monthKey(a.date), (mo.get(monthKey(a.date)) || 0) + a.d / 1000);
  const mk2 = [...mo.keys()].sort();
  mk("#c-month", { kind: "bar", x: mk2, xfmt: (x) => dt(x + "-15", { month: "short", year: "2-digit" }), series: [{ name: "Km", y: mk2.map((k) => +mo.get(k).toFixed(1)), color: "var(--accent)", fmt: (v) => N(v, 1) + " km" }], height: 150, delta: true, avg: true, yfmt: (v) => N(v) });

  // calendar heat map: 53 weeks
  const heat = new Map(); for (const a of D.acts) heat.set(a.date, (heat.get(a.date) || 0) + (a.run ? a.d / 1000 : 2));
  const mxv = Math.max(...heat.values(), 10), c = 5.6, g = 1.2, start = addDays(weekStart(today), -52 * 7);
  let cells = "";
  for (let w = 0; w < 53; w++) for (let d = 0; d < 7; d++) { const iso = addDays(start, w * 7 + d); if (iso > today) continue; const v = heat.get(iso) || 0; cells += `<rect data-d="${iso}" x="${w * (c + g)}" y="${d * (c + g)}" width="${c}" height="${c}" rx="1.6" fill="${v ? "var(--accent)" : "var(--surface2)"}" opacity="${v ? 0.3 + 0.7 * Math.min(v / mxv, 1) : 1}"/>`; }
  $("#c-cal").innerHTML = `<svg viewBox="0 0 ${53 * (c + g)} ${7 * (c + g)}" id="calsvg" class="cal">${cells}</svg>`;
  $("#calsvg").onclick = (e) => { const r = e.target.closest("rect"); if (!r) return; const d = r.dataset.d, L = D.acts.filter((a) => a.date === d); $("#cal-day").innerHTML = `<div class="wkh"><span>${dt(d, { weekday: "long", day: "numeric", month: "long" })}</span></div>` + (L.length ? `<div class="list">${L.map((a) => actRow(a)).join("")}</div>` : `<div class="muted note">Sin actividades.</div>`); };
};
