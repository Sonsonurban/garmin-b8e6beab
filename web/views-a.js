"use strict";
const ZC = ["var(--z1)", "var(--z2)", "var(--z3)", "var(--z4)", "var(--z5)"];
const HRV_ST = { BALANCED: "Equilibrado", UNBALANCED: "Desequilibrado", LOW: "Bajo", POOR: "Deficiente", NONE: "Sin estado" };
const clock = (ms) => new Date(ms).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false });
const recColor = (s) => (s == null ? "var(--muted)" : s >= 67 ? "var(--good)" : s >= 34 ? "var(--warn)" : "var(--bad)");
const stageBar = (sl) => {
  const t = (sl.deep || 0) + (sl.rem || 0) + (sl.light || 0) + (sl.awake || 0) || 1;
  const seg = [["Profundo", sl.deep, "var(--z2)"], ["REM", sl.rem, "var(--z3)"], ["Ligero", sl.light, "var(--z1)"], ["Despierto", sl.awake, "var(--z4)"]];
  return `<div class="stagebar">${seg.map(([n, v, c]) => `<i style="flex:${v || 0.001};background:${c}" title="${n}"></i>`).join("")}</div>
  <div class="legend">${seg.map(([n, v, c]) => `<span><i style="background:${c}"></i>${n} <b class="num">${hm(v)}</b> <span class="muted">${N(((v || 0) / t) * 100)}%</span></span>`).join("")}</div>`;
};
const loadGauge = (pct) => {
  const p = clamp(pct ?? 0, 0, 200);
  return `<div class="gauge"><div class="gz"><i style="flex:80;background:var(--accent2)"></i><i style="flex:40;background:var(--good)"></i><i style="flex:30;background:var(--warn)"></i><i style="flex:50;background:var(--bad)"></i></div><div class="gm" style="left:${p / 2}%"></div><div class="gl"><span>0%</span><span>80</span><span>120</span><span>150</span><span>200%</span></div></div>`;
};

// ============================== HOY ==============================
VIEWS.home = () => {
  const today = todayIso();
  const lastRow = [...D.daily].reverse().find((r) => r.sleepScore != null || r.hrv != null);
  const rd = lastRow ? lastRow.date : today, row = D.dm.get(rd) || {};
  const rec = recovery(rd), eff = effortPct(today), effY = effortPct(addDays(today, -1)), lr = loadRatio(today), lz = ratioZone(lr && lr.pct);
  const sl = D.B.sleep[rd];
  const tr = D.dm.get(today) || {};
  const last = D.acts[D.acts.length - 1];
  const wkStart = weekStart(today);
  const wkMin = sum(D.daily.filter((r) => r.date >= wkStart), (r) => (r.mod || 0) + 2 * (r.vig || 0));
  const kcal14 = mean(D.daily.filter((r) => r.date < today && r.date >= addDays(today, -14)).map((r) => r.kT));

  let h = card("", `<div class="rings">
      <div>${ring(rec && rec.score, recColor(rec && rec.score), rec ? rec.score + "%" : "–", "")}<div class="rl">Recuperación</div></div>
      <div>${ring(eff == null ? null : Math.min(eff, 100), "var(--accent2)", eff == null ? "–" : eff + "%", "")}<div class="rl">Esfuerzo hoy</div></div>
      <div>${ring(row.sleepScore, "var(--z2)", row.sleepScore ?? "–", "")}<div class="rl">Sueño</div></div></div>
    ${rec ? `<div class="parts">${rec.parts.map((p) => `<div class="part"><span>${esc(p.n)}</span><div class="pbar"><i style="width:${p.v}%;background:${recColor(p.v)}"></i></div><b class="num">${p.v}</b></div>`).join("")}</div>
    <div class="muted note">Recuperación de ${dt(rd)}: compara cada señal con tus últimos 60 días. Esfuerzo: tu carga del día frente a tus días más exigentes${effY != null ? ` · ayer ${effY}%` : ""}.</div>` : ""}`, { sub: `Datos de ${dt(rd)}` });

  if (sl) h += card("Sueño", `<div class="row"><div class="stat hero"><div class="v num">${hm(sl.dur)}</div><div class="l">dormido · puntaje ${sl.score ?? "–"}</div></div>
      <div class="stat"><div class="v num">${sl.needAct ? hm(sl.needAct * 60) : "–"}</div><div class="l">necesidad de sueño</div></div></div>${stageBar(sl)}`, { right: `<button class="link" data-goto="health">Detalle ›</button>` });

  h += card("Variabilidad cardíaca (HRV)", `<div class="grid3">${stat(N(row.hrv), "ms", "anoche")}${stat(N(row.hrvW), "ms", "promedio 7 d")}${stat(N(row.rhr), "lpm", "FC reposo")}</div>
    ${row.hrvLo != null ? `<div class="bandbar"><div class="bz" style="left:${clamp(((row.hrvLo - 20) / 100) * 100, 0, 100)}%;width:${clamp(((row.hrvUp - row.hrvLo) / 100) * 100, 2, 100)}%"></div><div class="bm" style="left:${clamp(((row.hrv - 20) / 100) * 100, 0, 100)}%"></div></div><div class="muted note">Tu rango equilibrado es ${row.hrvLo}–${row.hrvUp} ms · estado: <b>${HRV_ST[row.hrvSt] || row.hrvSt || "–"}</b></div>` : ""}`);

  // today's curves (or the latest day that has them)
  const cd = [today, addDays(today, -1), addDays(today, -2)].find((d) => D.B.curves[d] && D.B.curves[d].bb && D.B.curves[d].bb.length > 3);
  if (cd) {
    const c = D.B.curves[cd], grp = new ChartGroup();
    h += card("Tu día", `<div class="mt">Body Battery</div><div id="c-bb"></div><div class="mt">Estrés</div><div id="c-st"></div><div class="mt">Frecuencia cardíaca</div><div id="c-hr"></div>`, { sub: dt(cd), cls: "curves" });
    setTimeout(() => {
      const mk = (id, arr, color, name, o = {}) => chart($(id), { x: arr.map((p) => p[0]), xfmt: (x) => clock(x), series: [{ name, y: arr.map((p) => p[1]), color, area: true }], height: 110, group: grp, xTicks: 5, ...o });
      mk("#c-bb", c.bb, "var(--accent)", "Body Battery", { yMin: 0, yMax: 100 });
      mk("#c-st", c.stress, "var(--warn)", "Estrés", { yMin: 0, yMax: 100 });
      mk("#c-hr", c.hr, "var(--bad)", "FC", { yfmt: (v) => Math.round(v) });
    });
  }

  const ec = (tr.kT != null ? tr : row);
  h += card("Calorías", `<div class="grid3">${stat(N(ec.kT), "kcal", "totales")}${stat(N(ec.kA), "kcal", "activas")}${stat(N(ec.kB), "kcal", "en reposo")}</div>
    ${ec.kT ? `<div class="stagebar thin"><i style="flex:${ec.kB || 1};background:var(--z1)"></i><i style="flex:${ec.kA || 0.001};background:var(--accent)"></i></div>` : ""}
    <div class="muted note">${kcal14 ? `Tu promedio de 14 días es ${N(kcal14)} kcal ${ec.kT && ec.date !== today ? delta(ec.kT, kcal14) : ""}` : ""}${ec.date === today ? " · el día de hoy sigue en curso" : ""}</div>`, { sub: dt(ec.date || today) });

  h += card("Actividad del día", `<div class="grid3" style="row-gap:14px">${stat(N(tr.steps ?? row.steps), "", "pasos")}${stat(N(tr.fl ?? row.fl), "", "pisos")}${stat(N(((tr.dist ?? row.dist) || 0) / 1000, 1), "km", "distancia")}</div>
    <div class="mt">Minutos de intensidad de la semana</div><div class="pbar big"><i style="width:${clamp((wkMin / 150) * 100, 0, 100)}%;background:var(--accent)"></i></div>
    <div class="row muted note"><span>${N(wkMin)} min</span><span>meta 150 min</span></div>`);

  h += card("Carga de entrenamiento", `<div class="row"><div class="stat hero"><div class="v num">${lr ? lr.pct + "%" : "–"}</div><div class="l">tu semana vs tu promedio</div></div><span class="pill ${lz[0]}">${lz[1]}</span></div>
    ${lr ? loadGauge(lr.pct) : ""}
    <div class="grid3" style="margin-top:12px">${stat(lr ? lr.acute : "–", "", "carga 7 días")}${stat(lr ? lr.chronic : "–", "", "promedio semanal 4 sem")}${stat(eff == null ? "–" : eff + "%", "", "esfuerzo de hoy")}</div>
    <div class="muted note">Carga estimada con duración e intensidad cardíaca (tu reloj no la entrega). 100% = tu semana habitual.</div>`, { right: `<button class="link" data-goto="prog">Ver evolución ›</button>` });

  if (last) h += card("Última actividad", actRow(last, true), { cls: "list" });
  $("#view").innerHTML = h;
  $$("[data-goto]").forEach((b) => (b.onclick = () => show(b.dataset.goto)));
};

// ============================== ENTRENOS ==============================
const F = { type: "all", range: "all" };
const actRow = (a, solo) => `<button class="act" data-act="${a.id}"><div class="t"><span class="ico">${iconOf(a)}</span>${esc(a.nm || tname(a.ty))}</div><div class="km num">${a.d > 800 ? km(a.d, 2) + " km" : dur(a.t)}</div>
  <div class="m">${dt(a.s)} · ${esc(tname(a.ty))}${a.hr ? ` · ${Math.round(a.hr)} lpm` : ""}${a.cal ? ` · ${N(a.cal)} kcal` : ""}</div><div class="m num r">${a.d > 800 && a.pace ? pace(a.pace) + " /km · " : ""}${dur(a.t)}</div></button>`;
VIEWS.acts = () => {
  const types = [["all", "Todo"], ["run", "Correr"], ["strength", "Fuerza"], ["cycling", "Bici"], ["other", "Otros"]];
  const match = (a) => (F.type === "all" ? true : F.type === "run" ? a.run : F.type === "strength" ? /strength|fitness/.test(a.ty) : F.type === "cycling" ? /cycl/.test(a.ty) : !a.run && !/strength|fitness|cycl/.test(a.ty));
  const since = sinceFor(F.range);
  const L = D.acts.filter((a) => match(a) && a.date >= since).slice().reverse();
  const totalCal = sum(L, (a) => a.cal), runs = L.filter((a) => a.run);
  let h = `<div id="f-type"></div><div id="f-range"></div>
  <section class="card"><div class="grid3" style="row-gap:14px">${stat(L.length, "", "actividades")}${stat(km(sum(runs, (a) => a.d), 0), "km", "corridos")}${stat(hm(sum(L, (a) => a.t)), "", "tiempo total")}${stat(N(totalCal), "", "kcal")}${stat(N(sum(L, (a) => a.gain)), "m", "desnivel +")}${stat(runs.length ? pace(sum(runs, (a) => a.t) / (sum(runs, (a) => a.d) / 1000)) : "–", "/km", "ritmo medio")}</div></section>`;
  const weeks = new Map();
  for (const a of L) { const k = weekStart(a.date); (weeks.get(k) || weeks.set(k, []).get(k)).push(a); }
  for (const [wk, items] of weeks) {
    const r = items.filter((a) => a.run);
    h += `<div class="wkh"><span>Semana del ${dshort(wk)}</span><span class="num muted">${N(sum(r, (a) => a.d) / 1000, 1)} km · ${hm(sum(items, (a) => a.t))} · ${items.length} act.</span></div><section class="card list">${items.map((a) => actRow(a)).join("")}</section>`;
  }
  if (!L.length) h += `<div class="empty">No hay actividades con estos filtros.</div>`;
  $("#view").innerHTML = h;
  chips($("#f-type"), types, F.type, (v) => { F.type = v; VIEWS.acts(); });
  chips($("#f-range"), [["all", "Todo"], ["1y", "1 año"], ["6m", "6 meses"], ["90d", "90 días"], ["30d", "30 días"]], F.range, (v) => { F.range = v; VIEWS.acts(); });
};

// ============================== DETALLE ==============================
function routeMap(poly) {
  const lat0 = poly.reduce((a, p) => a + p[0], 0) / poly.length, k = Math.cos((lat0 * Math.PI) / 180);
  const pts = poly.map((p) => [p[1] * k, -p[0]]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const hh = 240, s = Math.min((360 - 30) / (x1 - x0 || 1), (hh - 30) / (y1 - y0 || 1)), ox = (360 - (x1 - x0) * s) / 2, oy = (hh - (y1 - y0) * s) / 2;
  const P = pts.map((p) => [ox + (p[0] - x0) * s, oy + (p[1] - y0) * s]);
  return { P, html: `<svg viewBox="0 0 360 ${hh}" id="routesvg"><path d="M${P.map((p) => p.map((v) => v.toFixed(1)).join(" ")).join("L")}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${P[0][0]}" cy="${P[0][1]}" r="5" fill="var(--bg)" stroke="var(--accent2)" stroke-width="3"/><circle cx="${P.at(-1)[0]}" cy="${P.at(-1)[1]}" r="5" fill="var(--bad)"/><circle id="routedot" r="7" fill="var(--warn)" stroke="var(--bg)" stroke-width="3" style="display:none"/></svg>` };
}

function openActivity(id) {
  const a = D.byId.get(id); if (!a) return;
  const det = D.B.detail[id] || {}, ser = det.ser, laps = (det.laps || []).filter((l) => !l.dist || l.dist >= 200);
  $("#detail").hidden = false; $("#detail").scrollTop = 0;
  $("#d-title").textContent = a.nm || tname(a.ty);
  const rel = D.runs.filter((r) => r.id !== a.id && r.date >= addDays(a.date, -60) && r.date < a.date);
  const cmp = (v, avg, inv) => (v != null && avg ? delta(v, avg, inv) : "");
  const rav = (k) => mean(rel.map((r) => r[k]));
  const ldp = (() => { const l = D.lm.get(a.date); return null; })();
  const stats1 = a.d > 800 ? `${stat(km(a.d, 2), "km", "distancia")}${stat(dur(a.t), "", "tiempo")}${stat(pace(a.pace), "/km", "ritmo medio")}${stat(a.hr ? Math.round(a.hr) : "–", "lpm", `FC media · máx ${a.mhr ? Math.round(a.mhr) : "–"}`)}`
    : `${stat(dur(a.t), "", "duración")}${stat(a.hr ? Math.round(a.hr) : "–", "lpm", "FC media")}${stat(a.mhr ? Math.round(a.mhr) : "–", "lpm", "FC máxima")}${stat(N(a.cal), "kcal", "calorías")}`;
  const more = [
    a.d > 800 ? stat(N(a.cal), "kcal", `calorías · ${N(a.act)} activas`) : "", a.gain != null && (a.gain > 0 || a.d > 800) ? stat(N(a.gain), "m", `desnivel + · −${N(a.loss)} m`) : "",
    a.cad ? stat(Math.round(a.cad), "ppm", "cadencia") : "", a.st ? stat(N(a.st), "", "pasos") : "",
    a.ate != null ? stat(N(a.ate, 1), "", `efecto aeróbico${a.lab ? " · " + esc(a.lab.toLowerCase().replace(/_/g, " ")) : ""}`) : "",
    a.ane ? stat(N(a.ane, 1), "", "efecto anaeróbico") : "", stat(N(a.ld), "", "carga (estimada)"),
    a.bb != null ? stat(a.bb > 0 ? "+" + a.bb : a.bb, "", "Body Battery") : "", a.mod || a.vig ? stat(N((a.mod || 0) + 2 * (a.vig || 0)), "min", "intensidad") : "",
    a.v2 ? stat(N(a.v2, 1), "", "VO₂ máx") : "",
  ].join("");
  const dyn = a.gct || a.sl || a.vo ? `${a.gct ? stat(Math.round(a.gct), "ms", "contacto con el suelo") : ""}${a.sl ? stat(N(a.sl / (a.sl > 10 ? 100 : 1), 2), "m", "largo de zancada") : ""}${a.vo ? stat(N(a.vo, 1), "cm", "oscilación vertical") : ""}${a.vr ? stat(N(a.vr, 1), "%", "ratio vertical") : ""}${a.gap ? stat(pace(1000 / a.gap), "/km", "ritmo ajustado por desnivel") : ""}` : "";
  const pwr = a.pw ? `${stat(Math.round(a.pw), "W", "potencia media")}${stat(Math.round(a.npw || 0), "W", "potencia normalizada")}${stat(Math.round(a.mpw || 0), "W", "potencia máxima")}` : "";
  const w = a.w ? `<div class="wx"><b>${N(a.w.temp, 0)}°C</b> (sensación ${N(a.w.feels, 0)}°) · humedad ${N(a.w.hum)}% · viento ${N(a.w.wind)} km/h ${esc((a.w.dir || "").toUpperCase())}<span class="muted"> · ${esc(a.w.desc || "")}</span></div>` : "";
  const vs = a.run && rel.length >= 5 ? `<div class="vs">${[["Ritmo", pace(a.pace) + " /km", cmp(a.pace, rav("pace"), true)], ["FC media", N(a.hr) + " lpm", cmp(a.hr, rav("hr"), true)], ["Cadencia", N(a.cad) + " ppm", cmp(a.cad, rav("cad"))], ["Eficiencia", N(a.ef, 2), cmp(a.ef, rav("ef"))], a.dec != null ? ["Deriva cardíaca", N(a.dec, 1) + "%", ""] : null].filter(Boolean).map(([n, v, d]) => `<div class="row"><span>${n}</span><span class="num"><b>${v}</b> ${d}</span></div>`).join("")}</div><div class="muted note">Comparado con tus ${rel.length} salidas de los 60 días anteriores.</div>` : "";

  let h = `<div class="muted">${dt(a.s, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${a.s.slice(11, 16)}${a.loc ? " · " + esc(a.loc) : ""}</div>
  ${card("", `<div class="grid2" style="row-gap:16px">${stats1}</div>${w}`)}
  ${card("Más datos", `<div class="grid2" style="row-gap:16px">${more}</div>`)}
  ${vs ? card("Frente a tu promedio", vs) : ""}
  ${dyn ? card("Dinámica de carrera", `<div class="grid2" style="row-gap:16px">${dyn}</div>`) : ""}
  ${pwr ? card("Potencia de carrera", `<div class="grid3">${pwr}</div><div class="muted note">Estimada desde la muñeca: úsala para comparar entre salidas, no como valor absoluto.</div>`) : ""}`;

  let map = null;
  if (det.poly && det.poly.length > 3) { map = routeMap(det.poly); h += card("Ruta", map.html + `<div class="legend"><span><i style="background:var(--accent2)"></i>Inicio</span><span><i style="background:var(--bad)"></i>Fin</span><span><i style="background:var(--warn)"></i>Tu dedo en los gráficos</span></div>`, { cls: "map" }); }
  if (ser && ser.d) h += card("Gráficos de la salida", `<div id="readout" class="readout">Desliza el dedo sobre un gráfico</div><div class="mt">Ritmo (/km)</div><div id="s-pace"></div><div class="mt">Frecuencia cardíaca</div><div id="s-hr"></div>${ser.el ? `<div class="mt">Altitud</div><div id="s-el"></div>` : ""}${ser.cad ? `<div class="mt">Cadencia</div><div id="s-cad"></div>` : ""}${ser.pw ? `<div class="mt">Potencia</div><div id="s-pw"></div>` : ""}${ser.gct ? `<div class="mt">Contacto con el suelo</div><div id="s-gct"></div>` : ""}${ser.sl ? `<div class="mt">Largo de zancada</div><div id="s-sl"></div>` : ""}${ser.vo ? `<div class="mt">Oscilación vertical</div><div id="s-vo"></div>` : ""}`, { cls: "curves" });
  const hz = a.hz || [], hzt = sum(hz) || 1;
  if (sum(hz) > 0) h += card("Zonas de frecuencia cardíaca", `<div class="stagebar">${hz.map((s, i) => `<i style="flex:${Math.max(s, 0.001)};background:${ZC[i]}"></i>`).join("")}</div><div class="zl">${hz.map((s, i) => `<div class="row"><span><i class="dot" style="background:${ZC[i]}"></i>Zona ${i + 1}</span><span class="num muted">${dur(s)} · ${N((s / hzt) * 100)}%</span></div>`).join("")}</div>`);
  const pz = a.pz || [], pzt = sum(pz) || 1;
  if (sum(pz) > 0) h += card("Zonas de potencia", `<div class="stagebar">${pz.map((s, i) => `<i style="flex:${Math.max(s, 0.001)};background:${ZC[i]}"></i>`).join("")}</div><div class="zl">${pz.map((s, i) => `<div class="row"><span><i class="dot" style="background:${ZC[i]}"></i>Zona ${i + 1}</span><span class="num muted">${dur(s)} · ${N((s / pzt) * 100)}%</span></div>`).join("")}</div>`);
  if (laps.length > 1) {
    const sp = laps.map((l) => (l.dur && l.dist ? l.dur / (l.dist / 1000) : null)), best = Math.min(...sp.filter(Boolean));
    h += card("Parciales", `<div id="c-laps"></div><div class="laps">${laps.map((l, i) => `<div class="lap"><span class="muted num">${i + 1}</span><div class="lb"><i style="width:${sp[i] ? clamp((best / sp[i]) * 100, 8, 100) : 0}%;background:${sp[i] === best ? "var(--accent)" : "var(--accent2)"}"></i></div><span class="num">${pace(sp[i])}</span><span class="num muted">${l.hr ? Math.round(l.hr) : ""}</span><span class="num muted">${l.gain != null ? "+" + Math.round(l.gain) : ""}</span></div>`).join("")}</div><div class="legend"><span>km · ritmo · FC · desnivel</span></div>`);
  }
  if (a.bs && Object.keys(a.bs).length) h += card("Mejores tramos de esta salida", `<div class="grid2">${[["1000", "1 km"], ["1609", "1 milla"], ["5000", "5 km"], ["10000", "10 km"]].filter(([k]) => a.bs[k]).map(([k, l]) => stat(dur(a.bs[k]), "", `${l} · ${pace(a.bs[k] / (k / 1000))} /km`)).join("")}</div>`);
  $("#d-body").innerHTML = h;

  if (ser && ser.d) {
    const grp = new ChartGroup(), n = ser.d.length;
    const sm = (arr, k = 3) => rolling(arr, k);
    const pr = rolling(ser.sp.map((v) => (v && v > 0.8 ? 1000 / v : null)), 4), rg = robust(pr) || [150, 720];
    const pc = pr.map((v) => (v == null ? null : clamp(v, rg[0], rg[1])));
    const xf = (x, i) => `${N(ser.d[i] / 1000, 2)} km`;
    const readout = (i) => {
      const dot = $("#routedot");
      if (i == null) { $("#readout").textContent = "Desliza el dedo sobre un gráfico"; if (dot) dot.style.display = "none"; return; }
      const parts = [`<b>${N(ser.d[i] / 1000, 2)} km</b>`, dur(ser.t[i]), pc[i] ? pace(pc[i]) + "/km" : null, ser.hr[i] ? Math.round(ser.hr[i]) + " lpm" : null, ser.el && ser.el[i] != null ? Math.round(ser.el[i]) + " m" : null, ser.cad && ser.cad[i] ? Math.round(ser.cad[i]) + " ppm" : null].filter(Boolean);
      $("#readout").innerHTML = parts.join(" · ");
      if (map && dot) { const p = map.P[Math.round((i / (n - 1)) * (map.P.length - 1))]; dot.setAttribute("cx", p[0]); dot.setAttribute("cy", p[1]); dot.style.display = ""; }
    };
    const mk = (id, y, color, name, o = {}) => { if (!$(id)) return; chart($(id), { x: ser.d, xfmt: xf, series: [{ name, y, color, area: o.area !== false }], height: 105, group: grp, onScrub: readout, xTicks: 5, tipExtra: (i) => `<div class="muted">${dur(ser.t[i])}</div>`, ...o }); };
    mk("#s-pace", pc, "var(--accent)", "Ritmo", { invert: true, yfmt: (v) => pace(v), area: false, yMin: rg[0], yMax: rg[1], step: 30 });
    mk("#s-hr", ser.hr, "var(--bad)", "FC", { yfmt: (v) => Math.round(v) });
    mk("#s-el", ser.el, "var(--z1)", "Altitud", { yfmt: (v) => Math.round(v) + " m" });
    mk("#s-cad", sm(ser.cad || [], 3), "var(--accent2)", "Cadencia", { yfmt: (v) => Math.round(v), area: false });
    mk("#s-pw", sm(ser.pw || [], 3), "var(--warn)", "Potencia", { yfmt: (v) => Math.round(v) + " W", area: false });
    mk("#s-gct", sm(ser.gct || [], 3), "var(--z3)", "Contacto", { yfmt: (v) => Math.round(v) + " ms", area: false });
    mk("#s-sl", sm(ser.sl || [], 3), "var(--z4)", "Zancada", { yfmt: (v) => N(v / 100, 2) + " m", area: false });
    mk("#s-vo", sm(ser.vo || [], 3), "var(--z2)", "Oscilación", { yfmt: (v) => N(v, 1) + " cm", area: false });
  }
  if (laps.length > 1 && $("#c-laps")) {
    const sp = laps.map((l) => (l.dur && l.dist ? l.dur / (l.dist / 1000) : null));
    chart($("#c-laps"), { x: laps.map((_, i) => i), xfmt: (x) => `km ${x + 1}`, kind: "bar", series: [{ name: "Ritmo", y: sp, color: "var(--accent2)", fmt: pace }], yfmt: (v) => pace(v), step: 30, height: 120, yMin: Math.max(0, Math.min(...sp.filter(Boolean)) * 0.8), delta: true, avg: true, tipExtra: (i) => `<div class="muted">FC ${laps[i].hr ? Math.round(laps[i].hr) : "–"} · desnivel ${laps[i].gain != null ? Math.round(laps[i].gain) : "–"} m</div>` });
  }
}
