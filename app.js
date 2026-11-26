// Ballistic Solver web app: SINGLE / DOPE / RETICLE / RIFLES.
// Everything runs on the device. Rifles and settings live in this browser's localStorage only.

import { solve, densityAltitude } from "./solver/core.js";
import { drawReticle, toMil } from "./reticle.js";
import { LrfLink, bluetoothSupport } from "./lrf.js";

const $ = (id) => document.getElementById(id);
const RIFLE_FIELDS = ["sight_height_in", "zero_range_yd", "twist_in", "twist_direction", "zero_atmosphere", "conditions"];
const MOA_PER_MIL = 3.43775;
const APP_VERSION = "v10";   // keep equal to VERSION in sw.js

// ------------------------------------------------------------ storage
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* private mode: ignore */ } },
};

const DEFAULTS = {
  rifle: "", load: 0, unit: "mil", range: 500, angle: 0, wind: 0, clock: 3, temp: 59, press: 29.92, hum: 50,
  mover: 0, moverDir: "R", from: 100, to: 1200, step: 50, reticle: "", target: "", mag: "1x", view: "single",
  useAngle: false,
};
let S = { ...DEFAULTS, ...store.get("bs.state", {}) };
let rifles = store.get("bs.rifles", null);
let reticles = {};   // name -> reticle (converted to MIL)
let targets = {};    // name -> target
let flash = false;

const saveState = () => store.set("bs.state", S);
const saveRifles = () => store.set("bs.rifles", rifles);

// ------------------------------------------------------------ helpers
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const fmtElev = (v) => `${Math.abs(v).toFixed(1)} ${v >= 0 ? "U" : "D"}`;
const fmtWind = (v) => (Math.abs(v) < 0.05 ? "0.0" : `${v > 0 ? "R" : "L"}${Math.abs(v).toFixed(1)}`);
const windClass = (v) => (v > 0.05 ? "amber" : v < -0.05 ? "blue" : "");
const clockTxt = (c) => `${c % 12 === 0 ? 12 : c} o'clock`;
const unitKey = () => S.unit;               // "mil" | "moa"

function flatten(rifle, load) {
  const p = {};
  for (const k of RIFLE_FIELDS) if (k in rifle) p[k] = rifle[k];
  for (const [k, v] of Object.entries(load)) if (k !== "name") p[k] = v;
  p.name = `${rifle.name} - ${load.name}`;
  if (!p.zero_atmosphere) p.zero_atmosphere = { temp_f: 59, pressure_inhg: 29.92, humidity_pct: 0 };
  return p;
}

function currentRifle() { return rifles.find((r) => r.name === S.rifle) ?? rifles[0] ?? null; }
function currentLoad() {
  const r = currentRifle();
  if (!r || !r.loads?.length) return null;
  return r.loads[Math.min(S.load, r.loads.length - 1)];
}
function currentProfile() {
  const r = currentRifle(); const l = currentLoad();
  return r && l ? flatten(r, l) : null;
}
function atmo() { return { temp_f: S.temp, pressure_inhg: S.press, humidity_pct: S.hum }; }

// ------------------------------------------------------------ rifle / load selects
function fillSelect(sel, items, value) {
  sel.replaceChildren(...items.map(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; return o; }));
  if (value !== undefined) sel.value = value;
}

function renderRigSelects() {
  const r = currentRifle();
  if (r) S.rifle = r.name;
  fillSelect($("rifleSel"), rifles.map((x) => [x.name, x.name]), S.rifle);
  const loads = r?.loads ?? [];
  S.load = Math.min(S.load, Math.max(0, loads.length - 1));
  fillSelect($("loadSel"), loads.map((l, i) => [String(i), l.name]), String(S.load));
}

function applyRifleConditions() {
  const c = currentRifle()?.conditions;
  if (c && "pressure_inhg" in c) {
    S.temp = c.temp_f ?? S.temp; S.press = c.pressure_inhg; S.hum = c.humidity_pct ?? 0;
    syncInputs();
  }
}

// ------------------------------------------------------------ shared inputs
const INPUTS = { range: "range", angle: "angle", wind: "wind", temp: "temp", press: "press", hum: "hum", mover: "mover" };

function syncInputs() {
  for (const [id, key] of Object.entries(INPUTS)) $(id).value = S[key];
  $("clock").value = String(S.clock);
  $("dFrom").value = S.from; $("dTo").value = S.to; $("dStep").value = S.step;
  $("unitMil").classList.toggle("on", S.unit === "mil");
  $("unitMoa").classList.toggle("on", S.unit === "moa");
  $("movL").classList.toggle("on", S.moverDir === "L");
  $("movR").classList.toggle("on", S.moverDir === "R");
  $("mag1").classList.toggle("on", S.mag === "1x");
  $("mag3").classList.toggle("on", S.mag === "3x");
}

function wireInputs() {
  for (const [id, key] of Object.entries(INPUTS)) {
    $(id).addEventListener("input", () => { S[key] = num($(id).value, key === "range" ? 0 : DEFAULTS[key]); changed(); });
  }
  fillSelect($("clock"), [...Array(12).keys()].map((i) => {
    const c = i === 0 ? 12 : i;
    const note = c === 12 ? " (head)" : c === 3 ? " (from right)" : c === 6 ? " (tail)" : c === 9 ? " (from left)" : "";
    return [String(c), `${c}${note}`];
  }));
  $("clock").addEventListener("change", () => { S.clock = num($("clock").value, 3); changed(); });
  for (const [id, key] of [["dFrom", "from"], ["dTo", "to"], ["dStep", "step"]]) {
    $(id).addEventListener("input", () => { S[key] = num($(id).value, DEFAULTS[key]); changed(); });
  }
  document.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
    S.range = Math.max(25, Math.round(S.range) + num(b.dataset.step, 0)); $("range").value = S.range; changed();
  }));
  $("unitMil").onclick = () => { S.unit = "mil"; syncInputs(); changed(); };
  $("unitMoa").onclick = () => { S.unit = "moa"; syncInputs(); changed(); };
  $("movL").onclick = () => { S.moverDir = "L"; syncInputs(); changed(); };
  $("movR").onclick = () => { S.moverDir = "R"; syncInputs(); changed(); };
  $("mag1").onclick = () => { S.mag = "1x"; syncInputs(); changed(); };
  $("mag3").onclick = () => { S.mag = "3x"; syncInputs(); changed(); };

  $("rifleSel").addEventListener("change", () => {
    S.rifle = $("rifleSel").value; S.load = 0; renderRigSelects(); applyRifleConditions(); renderRifleEditor(); changed();
  });
  $("loadSel").addEventListener("change", () => { S.load = num($("loadSel").value, 0); renderRifleEditor(); changed(); });
  $("retSel").addEventListener("change", () => { S.reticle = $("retSel").value; changed(); });
  $("tgtSel").addEventListener("change", () => { S.target = $("tgtSel").value; changed(); });

  document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
}

function setView(v) {
  S.view = v;
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b.dataset.view === v));
  for (const id of ["single", "dope", "reticle", "rifles"]) $("v-" + id).hidden = id !== v;
  $("cond").closest(".panel").hidden = v === "rifles";
  changed();
}

let pending = false;
function changed() {
  saveState();
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; render(); });
}

// ------------------------------------------------------------ rendering
function warnText(prof, row) {
  return row.transonic ? "   TRANSONIC" : row.near_mach1 ? "   NEAR MACH 1 - check velocity" : "";
}

function render() {
  const prof = currentProfile();
  $("condSummary").textContent = `${Math.round(S.range)} yd · ${S.wind} mph @ ${S.clock % 12 || 12} · ${S.angle}°`;
  if (!prof) {
    $("elev").textContent = "--"; $("windHold").textContent = "--";
    $("info").textContent = "No rifle or load. Add one on the Rifles tab.";
    return;
  }
  try {
    if (S.view === "single") renderSingle(prof);
    else if (S.view === "dope") renderDope(prof);
    else if (S.view === "reticle") renderReticle(prof);
  } catch (e) {
    $("info").textContent = `Error: ${e.message}`;
  }
}

function leadFor(tof, rng, unit) {
  const sign = S.moverDir === "R" ? 1 : -1;
  const rad = (sign * S.mover * 1.46667 * tof) / (rng * 3.0);
  return rad * (unit === "mil" ? 1000.0 : (60 * 180) / Math.PI);
}

function renderSingle(prof) {
  const rng = Math.round(S.range);
  if (!(rng >= 25 && rng <= 2500)) {
    $("elev").textContent = "--"; $("windHold").textContent = "--"; $("lead").textContent = "";
    $("info").textContent = "Enter a range between 25 and 2500 yd"; $("near").replaceChildren();
    return;
  }
  const unit = unitKey();
  const wdir = (S.clock % 12) * 30;
  const base = Math.round(rng / 50) * 50;
  const cands = new Set([rng]);
  for (let k = -3; k <= 3; k++) if (base + k * 50 >= 25) cands.add(base + k * 50);
  const near = [...cands].sort((a, b) => Math.abs(a - rng) - Math.abs(b - rng) || a - b).slice(0, 5).sort((a, b) => a - b);
  const rows = solve(prof, near, S.wind, wdir, S.angle, atmo());
  const cur = rows.find((r) => r.range_yd === rng);

  $("elev").textContent = fmtElev(cur["elev_" + unit]);
  const wv = cur["wind_" + unit];
  const w = $("windHold");
  w.textContent = fmtWind(wv); w.className = "num " + windClass(wv);

  if (S.mover > 0) {
    const lead = leadFor(cur.tof_s, rng, unit);
    const hold = wv + lead;
    $("lead").innerHTML = `LEAD ${fmtWind(lead)} &nbsp; <span class="${windClass(hold)}">HOLD ${fmtWind(hold)}</span>`;
  } else {
    $("lead").textContent = "";
  }
  const da = densityAltitude(S.temp, S.press, S.hum);
  const info = $("info");
  info.textContent = `${unit.toUpperCase()} · ${cur.velocity_fps.toFixed(0)} fps · TOF ${cur.tof_s.toFixed(2)} s · ` +
    `${(cur.energy_ftlb || 0).toFixed(0)} ft-lb · DA ${Math.round(da).toLocaleString()} ft${warnText(prof, cur)}` +
    (lrfText ? `\n${lrfText}` : "");
  info.className = "info " + (cur.transonic || cur.near_mach1 ? "warn" : "dim");

  const tbl = $("near");
  tbl.replaceChildren();
  tbl.insertAdjacentHTML("beforeend", "<thead><tr><th>Yd</th><th>Elev</th><th>Wind</th></tr></thead>");
  const tb = document.createElement("tbody");
  for (const r of rows) {
    const tr = document.createElement("tr");
    if (r.range_yd === rng) tr.className = "hi";
    tr.innerHTML = `<td>${r.range_yd}</td><td>${fmtElev(r["elev_" + unit])}</td><td>${fmtWind(r["wind_" + unit])}</td>`;
    tb.appendChild(tr);
  }
  tbl.appendChild(tb);
}

function renderDope(prof) {
  const a = S.from, b = S.to, st = S.step;
  const t = $("dopeTable");
  if (!(st > 0) || a < 25 || b > 2500 || b < a) {
    t.replaceChildren(); $("dopeCond").textContent = "Set a range between 25 and 2500 yd"; return;
  }
  const ranges = [];
  for (let r = Math.round(a); r <= b && ranges.length < 250; r += Math.round(st)) ranges.push(r);
  const unit = unitKey();
  const rows = solve(prof, ranges, S.wind, (S.clock % 12) * 30, S.angle, atmo());
  $("dopeCond").textContent = `${prof.name} · ${unit.toUpperCase()} · wind ${S.wind} mph @ ${clockTxt(S.clock)} · ` +
    `angle ${S.angle >= 0 ? "+" : ""}${S.angle}° · ${S.temp}°F ${S.press} inHg`;
  const html = ["<thead><tr><th>Yd</th><th>Elev</th><th>Wind</th><th>Vel</th><th>TOF</th></tr></thead><tbody>"];
  for (const r of rows) {
    const wv = r["wind_" + unit];
    html.push(`<tr><td class="yd">${r.range_yd}</td><td class="el">${fmtElev(r["elev_" + unit])}</td>` +
      `<td class="wd ${windClass(wv)}">${fmtWind(wv)}</td><td class="sm ${r.transonic ? "tr" : ""}">${r.velocity_fps.toFixed(0)}</td>` +
      `<td class="sm">${r.tof_s.toFixed(2)}</td></tr>`);
  }
  html.push("</tbody>");
  t.innerHTML = html.join("");
}

// ------------------------------------------------------------ reticle
function reticleSolution(prof, rng, wdir, cur, leadMil) {
  const top = Math.max(rng + 200, 300);
  const set = new Set([rng]);
  for (let r = 100; r <= top; r += 25) set.add(r);
  const arcR = [...set].sort((a, b) => a - b);
  const leadAt = (row) => (S.mover > 0 ? leadFor(row.tof_s, row.range_yd, "mil") : 0.0);
  const mk = (rows) => rows.map((r) => [r.range_yd, -(r.wind_mil + leadAt(r)), -r.elev_mil]);
  const arc = mk(solve(prof, arcR, S.wind, wdir, S.angle, atmo()));
  const calm = solve(prof, [rng], 0, 90, S.angle, atmo())[0];
  const alts = [2, 5, 10].map((mph) => [mph, mk(solve(prof, arcR, mph, wdir, S.angle, atmo()))]);
  return {
    range: rng, hold_x: -(cur.wind_mil + leadMil), hold_y: -cur.elev_mil, arc, alts,
    arc_x0: -(calm.wind_mil + leadMil), elev: cur.elev_mil, wind: cur.wind_mil, lead: leadMil,
  };
}

let bdcCache = { key: "", table: [] };
function rangeForDrop(prof, mil) {
  const key = JSON.stringify([prof, S.temp, S.press, S.hum, S.angle]);
  if (bdcCache.key !== key) {
    const ranges = [];
    for (let r = Math.max(50, Math.floor(prof.zero_range_yd || 100)); r <= 2500; r += 5) ranges.push(r);
    let table = [];
    try { table = solve(prof, ranges, 0, 90, S.angle, atmo()).map((r) => [r.range_yd, r.elev_mil]); } catch { /* ignore */ }
    bdcCache = { key, table };
  }
  const t = bdcCache.table;
  for (let i = 0; i + 1 < t.length; i++) {
    const [r0, e0] = t[i]; const [r1, e1] = t[i + 1];
    if (e0 <= mil && mil <= e1 && e1 > e0) return r0 + ((mil - e0) / (e1 - e0)) * (r1 - r0);
  }
  return null;
}

function renderReticle(prof) {
  const rng = Math.round(S.range);
  const ret = reticles[S.reticle] ?? Object.values(reticles)[0] ?? null;
  const target = targets[S.target] ?? Object.values(targets)[0] ?? null;
  $("magBar").hidden = !(ret && ret.type === "reddot");
  if (!(rng >= 25 && rng <= 2500)) { $("retSol").textContent = "--"; $("retInfo").textContent = "Enter a range between 25 and 2500 yd"; return; }
  const wdir = (S.clock % 12) * 30;
  const cur = solve(prof, [rng], S.wind, wdir, S.angle, atmo())[0];
  const leadMil = S.mover > 0 ? leadFor(cur.tof_s, rng, "mil") : 0.0;
  const sol = reticleSolution(prof, rng, wdir, cur, leadMil);

  const moa = String(ret?.unit ?? "mil").toLowerCase() === "moa" || S.unit === "moa";
  const k = moa ? MOA_PER_MIL : 1.0;
  const hx = sol.wind + leadMil;
  const el = $("retSol");
  el.innerHTML = `<span class="green">${fmtElev(sol.elev * k)}</span> &nbsp; <span class="${windClass(hx)}">${fmtWind(hx * k)}</span>`;
  const parts = [`${moa ? "MOA" : "MIL"} holds · wind ${S.wind} mph @ ${clockTxt(S.clock)}`];
  if (S.mover > 0) parts.push(`incl. lead ${fmtWind(leadMil * k)}`);
  if (lrfText) parts.push(lrfText);
  $("retInfo").textContent = parts.join(" · ");

  const cv = $("ret");
  const box = cv.parentElement.getBoundingClientRect();
  const size = Math.max(200, Math.floor(Math.min(box.width, box.height || box.width)));
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(size * dpr)) { cv.width = Math.round(size * dpr); cv.height = Math.round(size * dpr); }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawReticle(ctx, size, size, { ret, sol, target, mag: S.mag, rangeForDrop: (m) => rangeForDrop(prof, m), flash });
}
let lrfText = "";

// ------------------------------------------------------------ rangefinder (WMLRF over Bluetooth)
const LOG_KEY = "bs.lrflog";
let lrf = null;

function setLrfStatus(text, kind) {
  const el = $("lrfStatus");
  el.textContent = text;
  el.className = kind || "dim";
  $("lrfBtn").textContent = lrf && (lrf.connected || lrf.wantConnected) ? "Disconnect" : "Connect rangefinder";
}

function onLrfReading(r) {
  const log = store.get(LOG_KEY, []);
  log.push({ t: new Date().toISOString(), range_m: +r.range_m.toFixed(2), range_yd: +r.range_yd.toFixed(1),
    angle_deg: r.angle_deg, raw: r.raw });
  store.set(LOG_KEY, log.slice(-500));
  S.range = Math.round(r.range_yd);
  if (S.useAngle && r.angle_deg !== null) S.angle = Math.round(r.angle_deg * 10) / 10;
  lrfText = `LRF ${r.range_yd.toFixed(1)} yd` + (r.angle_deg !== null ? ` @ ${r.angle_deg >= 0 ? "+" : ""}${r.angle_deg.toFixed(1)}°` : "");
  syncInputs();
  const box = $("range");
  box.classList.add("flash");
  flash = true;
  setTimeout(() => { box.classList.remove("flash"); flash = false; changed(); }, 900);
  changed();
}

function wireLrf() {
  $("ver").textContent = `App ${APP_VERSION}`;
  lrf = new LrfLink({ onStatus: setLrfStatus, onReading: onLrfReading });
  const why = bluetoothSupport();
  if (why) setLrfStatus(why, "warn");
  $("lrfBtn").onclick = () => { if (lrf.connected || lrf.wantConnected) lrf.disconnect(); else lrf.connect(); };
  $("useAngle").checked = !!S.useAngle;
  $("useAngle").onchange = () => { S.useAngle = $("useAngle").checked; saveState(); };
  $("lrfLog").onclick = () => {
    const log = store.get(LOG_KEY, []);
    if (!log.length) { alert("No readings yet."); return; }
    const csv = ["time,range_m,range_yd,angle_deg,raw",
      ...log.map((x) => `${x.t},${x.range_m},${x.range_yd},${x.angle_deg ?? ""},${x.raw}`)].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "lrf_readings.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
}

// ------------------------------------------------------------ rifle editor
const getPath = (o, p) => p.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
function setPath(o, p, v) {
  const ks = p.split(".");
  const last = ks.pop();
  const t = ks.reduce((a, k) => (a[k] ??= {}), o);
  if (v === undefined) delete t[last]; else t[last] = v;
}

const RIFLE_SPEC = [
  ["name", "Rifle name", "text", "wide"],
  ["sight_height_in", "Sight height in", "num"],
  ["zero_range_yd", "Zero range yd", "num"],
  ["twist_in", "Twist 1 in", "num"],
  ["twist_direction", "Twist direction", ["right", "left"]],
  ["zero_atmosphere.temp_f", "Zero temp °F", "num"],
  ["zero_atmosphere.pressure_inhg", "Zero station press inHg", "num"],
  ["zero_atmosphere.humidity_pct", "Zero humidity %", "num"],
  ["conditions.temp_f", "Default temp °F", "num"],
  ["conditions.pressure_inhg", "Default press inHg", "num"],
  ["conditions.humidity_pct", "Default humidity %", "num"],
];
const LOAD_SPEC = [
  ["name", "Load name", "text", "wide"],
  ["drag_model", "Drag model", ["G1", "G7"]],
  ["bc", "BC", "num"],
  ["muzzle_velocity_fps", "Muzzle velocity fps", "num"],
  ["bullet_weight_gr", "Bullet weight gr", "num"],
  ["bullet_diameter_in", "Diameter in", "num"],
  ["bullet_length_in", "Length in", "num"],
  ["zero_offset_in", "Zero offset in at zero range (+ = hits high)", "num"],
  ["spin_drift", "Spin drift on", "check"],
];

function buildForm(container, spec, obj, onName) {
  container.replaceChildren();
  for (const [path, label, type, cls] of spec) {
    const lab = document.createElement("label");
    if (cls) lab.className = cls;
    let el;
    if (Array.isArray(type)) {
      el = document.createElement("select");
      fillSelect(el, type.map((x) => [x, x]), getPath(obj, path) ?? type[0]);
      el.addEventListener("change", () => { setPath(obj, path, el.value); saveRifles(); changed(); });
    } else if (type === "check") {
      lab.classList.add("check");
      el = document.createElement("input"); el.type = "checkbox"; el.checked = getPath(obj, path) !== false;
      el.addEventListener("change", () => { setPath(obj, path, el.checked); saveRifles(); changed(); });
    } else {
      el = document.createElement("input");
      el.type = type === "num" ? "number" : "text";
      if (type === "num") { el.inputMode = "decimal"; el.step = "any"; }
      el.value = getPath(obj, path) ?? "";
      el.addEventListener("input", () => {
        if (type === "num") {
          const n = parseFloat(el.value);
          setPath(obj, path, Number.isFinite(n) ? n : undefined);
        } else setPath(obj, path, el.value);
        saveRifles(); changed();
      });
      if (path === "name") el.addEventListener("change", onName);
    }
    if (type === "check") lab.append(el, label); else lab.append(label, el);
    container.appendChild(lab);
  }
}

function renderRifleEditor() {
  const r = currentRifle(); const l = currentLoad();
  $("rifleForm").replaceChildren(); $("loadForm").replaceChildren();
  if (r) buildForm($("rifleForm"), RIFLE_SPEC, r, () => { S.rifle = r.name; renderRigSelects(); changed(); });
  if (l) {
    buildForm($("loadForm"), LOAD_SPEC, l, () => { renderRigSelects(); changed(); });
    if (l.bc_bands?.length) {
      const p = document.createElement("p");
      p.className = "dim small wide"; p.style.gridColumn = "1 / -1";
      p.textContent = "This load uses velocity-band BCs from an imported file; the single BC above is ignored while bands are present.";
      $("loadForm").appendChild(p);
    }
  }
}

function uniqueName(base, list) {
  let n = base; let i = 2;
  while (list.some((x) => x.name === n)) n = `${base} ${i++}`;
  return n;
}

function wireEditor() {
  $("newRifle").onclick = () => {
    const r = {
      name: uniqueName("New rifle", rifles), sight_height_in: 2.0, zero_range_yd: 100, twist_in: 8, twist_direction: "right",
      zero_atmosphere: { temp_f: 59, pressure_inhg: 29.92, humidity_pct: 50 },
      loads: [{ name: "New load", drag_model: "G7", bc: 0.25, muzzle_velocity_fps: 2700, bullet_weight_gr: 140,
        bullet_diameter_in: 0.264, bullet_length_in: 1.3 }],
    };
    rifles.push(r); saveRifles(); S.rifle = r.name; S.load = 0;
    renderRigSelects(); renderRifleEditor(); changed();
  };
  $("delRifle").onclick = () => {
    const r = currentRifle();
    if (!r || !confirm(`Delete rifle "${r.name}" and all its loads?`)) return;
    rifles = rifles.filter((x) => x !== r); saveRifles();
    S.rifle = rifles[0]?.name ?? ""; S.load = 0; renderRigSelects(); renderRifleEditor(); changed();
  };
  $("newLoad").onclick = () => {
    const r = currentRifle(); if (!r) return;
    r.loads ??= [];
    r.loads.push({ name: uniqueName("New load", r.loads), drag_model: "G7", bc: 0.25, muzzle_velocity_fps: 2700,
      bullet_weight_gr: 140, bullet_diameter_in: 0.264, bullet_length_in: 1.3 });
    S.load = r.loads.length - 1; saveRifles(); renderRigSelects(); renderRifleEditor(); changed();
  };
  $("delLoad").onclick = () => {
    const r = currentRifle(); const l = currentLoad();
    if (!r || !l || !confirm(`Delete load "${l.name}"?`)) return;
    r.loads.splice(S.load, 1); S.load = 0; saveRifles(); renderRigSelects(); renderRifleEditor(); changed();
  };
  $("importBtn").onclick = () => $("importFile").click();
  $("importFile").onchange = async (ev) => {
    let added = 0;
    for (const f of ev.target.files) {
      try {
        const data = JSON.parse(await f.text());
        for (const r of Array.isArray(data) ? data : [data]) {
          if (!r || !r.name || !Array.isArray(r.loads) || !r.loads.length) continue;
          const i = rifles.findIndex((x) => x.name === r.name);
          if (i >= 0) rifles[i] = r; else rifles.push(r);
          added++;
        }
      } catch { /* skip bad file */ }
    }
    ev.target.value = "";
    saveRifles();
    if (added) { S.rifle = rifles[rifles.length - 1].name; S.load = 0; applyRifleConditions(); }
    renderRigSelects(); renderRifleEditor(); changed();
    alert(added ? `Imported ${added} rifle(s).` : "No valid rifle files found. Use the JSON files from the rifles folder.");
  };
  $("exportBtn").onclick = () => {
    const blob = new Blob([JSON.stringify(rifles, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "ballistic_rifles.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
}

// ------------------------------------------------------------ startup
async function fetchJson(url) { const r = await fetch(url); if (!r.ok) throw new Error(url); return r.json(); }

async function loadData() {
  try {
    const idx = await fetchJson("data/index.json");
    for (const f of idx.reticles) { const r = toMil(await fetchJson("data/reticles/" + f)); reticles[r.name] = r; }
    const ts = [];
    for (const f of idx.targets) ts.push(await fetchJson("data/targets/" + f));
    ts.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    for (const t of ts) targets[t.name] = t;
  } catch { /* offline first run: reticle view just shows a message */ }
  if (rifles === null) {
    try { rifles = [await fetchJson("data/starter_rifle.json")]; } catch { rifles = []; }
    saveRifles();
  }
  fillSelect($("retSel"), Object.keys(reticles).map((n) => [n, n]), reticles[S.reticle] ? S.reticle : Object.keys(reticles)[0]);
  fillSelect($("tgtSel"), Object.keys(targets).map((n) => [n, n]), targets[S.target] ? S.target : Object.keys(targets)[0]);
  S.reticle = $("retSel").value; S.target = $("tgtSel").value;
}

async function init() {
  wireInputs(); wireEditor(); wireLrf();
  await loadData();
  if (!currentRifle() && rifles.length) S.rifle = rifles[0].name;
  if (!store.get("bs.state", null)) applyRifleConditions();
  renderRigSelects(); renderRifleEditor(); syncInputs();
  setView(S.view);
  window.addEventListener("resize", changed);
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
init();
