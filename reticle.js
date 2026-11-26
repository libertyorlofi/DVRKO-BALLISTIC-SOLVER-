// Reticle + target drawing on an HTML canvas. Port of App.draw_reticle in app.py.
// Everything is in MIL; reticles drawn in MOA are converted by toMil().

const GREEN = "#1b8f5a";
const AMBER_DK = "#c98a00";
const BLUE_DK = "#1f7fc4";

export function toMil(ret) {
  const k = String(ret.unit ?? "mil").toLowerCase() === "moa" ? 0.2908882 : 1.0;
  if (k === 1.0) return ret;
  const out = { ...ret };
  out.elements = ret.elements.map((e0) => {
    const e = { ...e0 };
    for (const key of ["x", "y", "x1", "y1", "x2", "y2", "r", "cx", "cy", "wu"]) {
      if (key in e) e[key] *= k;
    }
    if (e.pts) e.pts = e.pts.map(([x, y]) => [x * k, y * k]);
    return e;
  });
  if (ret.bdc) out.bdc = ret.bdc.map((v) => v * k);
  return out;
}

// y (MIL, negative) of every horizontal hash crossing the vertical line below centre
export function stadiaHashes(ret) {
  const ys = new Set();
  for (const e of ret.elements) {
    if (e.t === "line" && e.y1 === e.y2 && e.y1 < 0 && e.x1 < 0 && e.x1 < 0 && e.x2 > 0 &&
        Math.abs(e.x2 - e.x1) < 1.5) {
      ys.add(Math.round(e.y1 * 1000) / 1000);
    }
  }
  return [...ys].sort((a, b) => b - a);
}

// Only hashes on whole MIL (MIL reticles) or every 4th MOA (MOA reticles) get a range label, so the labels stay
// legible. A reticle can set its own "label_step" in its own units (the generic MOA ladder has 5 MOA hashes).
export function labelFilter(ret, ys) {
  const moa = String(ret.unit ?? "mil").toLowerCase() === "moa";
  const k = moa ? 0.2908882 : 1.0;                       // MIL per reticle unit
  const step = ret.label_step ?? (moa ? 4 : 1);
  return ys.filter((y) => {
    const v = Math.abs(y) / k / step;
    return Math.abs(v - Math.round(v)) < 0.03;
  });
}

// o = { ret, sol, target, mag, rangeForDrop(mil), flash }
export function drawReticle(ctx, W, H, o) {
  ctx.clearRect(0, 0, W, H);
  const { ret, sol, target, mag, rangeForDrop, flash } = o;
  ctx.textBaseline = "middle";
  if (!ret) {
    ctx.fillStyle = "#8a8a8a";
    ctx.textAlign = "center";
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("No reticle loaded", W / 2, H / 2);
    return;
  }
  const redDot = ret.type === "reddot";
  const ink = ret.color === "red" ? "#e01818" : "black";
  const holdNeed = sol ? Math.max(Math.abs(sol.hold_y) + 2.0, Math.abs(sol.hold_x) + 2.0) : 0;
  let need;
  if (redDot) {
    const radii = ret.elements.filter((e) => e.t === "arc").map((e) => e.r);
    const ring = radii.length ? Math.max(...radii) : 5.0;
    const base = ring * 1.45;
    need = mag === "1x" ? Math.max(base, holdNeed) : base / 3.0;
  } else {
    need = Math.max(ret.view_mil ?? 10.4, holdNeed);   // view_mil: wider view for reticles with far-out marks
  }
  const D = Math.min(W, H);
  const ppm = D / (2 * need);
  const cx = W / 2;
  const cy = H / 2;
  const P = (x, y) => [cx + x * ppm, cy - y * ppm];
  const R = D / 2 - 2;
  const thin = Math.max(1, Math.round(0.03 * ppm));
  const thick = Math.max(2, Math.round(0.075 * ppm));
  const inside = (x, y) => (x * x + y * y) * ppm * ppm <= (R - 3) ** 2;

  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = "#e9ebe5";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#444";
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R - 1, 0, Math.PI * 2);
  ctx.clip();

  // target sits behind the reticle, so draw it first
  if (sol && target) {
    const k = 1000.0 / (36.0 * sol.range);               // inches -> MIL at this range
    const Q = (x, y) => P(sol.hold_x + x * k, sol.hold_y + y * k);
    for (const sh of target.shapes) {
      if (sh.t === "poly") {
        ctx.beginPath();
        sh.pts.forEach((p, i) => { const [px, py] = Q(p[0], p[1]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
        ctx.closePath();
        if (sh.fill) { ctx.fillStyle = sh.fill; ctx.fill(); }
        if (sh.outline) { ctx.strokeStyle = sh.outline; ctx.lineWidth = 1; ctx.stroke(); }
      } else if (sh.t === "line") {
        ctx.beginPath();
        sh.pts.forEach((p, i) => { const [px, py] = Q(p[0], p[1]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
        ctx.strokeStyle = sh.color ?? "black";
        ctx.lineWidth = Math.max(1, (sh.w ?? 1) * k * ppm);
        ctx.lineCap = "round";
        ctx.stroke();
      } else if (sh.t === "circle") {
        const [x, y] = Q(sh.cx, sh.cy);
        ctx.beginPath();
        ctx.arc(x, y, sh.r * k * ppm, 0, Math.PI * 2);
        ctx.strokeStyle = sh.outline ?? "white";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  ctx.lineCap = "butt";
  for (const e of ret.elements) {
    if (e.t === "line") {
      const wd = e.wu !== undefined ? Math.max(1, e.wu * ppm) : (e.w === "thick" ? thick : thin);
      ctx.beginPath();
      ctx.moveTo(...P(e.x1, e.y1));
      ctx.lineTo(...P(e.x2, e.y2));
      ctx.strokeStyle = e.color === "red" ? "#e01818" : ink;   // per-element red (illuminated centre)
      ctx.lineWidth = wd;
      ctx.stroke();
    } else if (e.t === "arc") {
      const [x, y] = P(e.cx, e.cy);
      ctx.beginPath();
      // Tk arcs run counter-clockwise from 3 o'clock; canvas y is flipped
      ctx.arc(x, y, e.r * ppm, (-e.start * Math.PI) / 180, (-(e.start + e.extent) * Math.PI) / 180, true);
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(1, (e.wu ?? 0.1) * ppm);
      ctx.stroke();
    } else if (e.t === "dot" && inside(e.x, e.y)) {
      const [x, y] = P(e.x, e.y);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.5, e.r * ppm), 0, Math.PI * 2);
      ctx.fillStyle = e.color === "red" ? "#e01818" : ink;
      ctx.fill();
    } else if (e.t === "poly") {
      ctx.beginPath();
      e.pts.forEach((p, i) => { const [px, py] = P(p[0], p[1]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.strokeStyle = e.color === "red" ? "red" : "black";
      ctx.lineWidth = Math.max(2, thick);
      ctx.stroke();
    } else if (e.t === "text" && inside(e.x, e.y)) {
      ctx.fillStyle = "#444";
      ctx.textAlign = "center";
      ctx.font = `bold ${Math.max(8, Math.round(0.32 * ppm))}px system-ui, sans-serif`;
      ctx.fillText(e.s, ...P(e.x, e.y));
    }
  }

  if (sol) {
    // BDC: red range next to every hash below the crosshair (zero wind, current weather/angle)
    const side = sol.hold_x <= 0 ? 1 : -1;
    ctx.fillStyle = "#d01010";
    if (redDot) {
      const fs = Math.max(9, Math.min(16, Math.round(0.5 * ppm)));
      ctx.font = `bold ${fs}px system-ui, sans-serif`;
      ctx.textAlign = side > 0 ? "left" : "right";
      const names = ret.bdc_names ?? [];
      (ret.bdc ?? []).forEach((v, i) => {
        if (!inside(0, -v)) return;
        const rng = rangeForDrop(v);
        if (rng) ctx.fillText(Math.round(rng) + (names[i] === "ring" ? " (ring)" : ""), ...P(side * 1.0, -v));
      });
    } else {
      const fs = Math.max(9, Math.round(0.21 * ppm));
      ctx.font = `bold ${fs}px system-ui, sans-serif`;
      ctx.textAlign = side > 0 ? "left" : "right";
      // reticles with a "bdc" list (e.g. dot trees) label those rows; others label hashes on the stadia
      const rows = ret.bdc && ret.bdc.length ? ret.bdc.map((v) => -v).sort((a, b) => b - a) : labelFilter(ret, stadiaHashes(ret));
      for (const y of ret.bdc_labels === false ? [] : rows) {
        if (!inside(0.45 * side, y)) continue;
        const rng = rangeForDrop(-y);
        if (rng) ctx.fillText(String(Math.round(rng)), ...P(0.42 * side, y + 0.25));
      }
    }

    // trajectory arc: where the target sits on the reticle at other ranges
    const arc = sol.arc.filter((p) => inside(p[1], p[2]));
    if (arc.length > 1) {
      ctx.beginPath();
      arc.forEach((p, i) => { const [px, py] = P(p[1], p[2]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = GREEN;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      let lastPy = null;
      ctx.font = `${Math.max(8, Math.round(0.26 * ppm))}px system-ui, sans-serif`;
      for (const [rng, x, y] of arc) {
        if (rng % 100 === 0 && rng !== sol.range) {
          const [px, py] = P(x, y);
          if (lastPy !== null && Math.abs(py - lastPy) < 13) continue;
          lastPy = py;
          ctx.beginPath();
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fillStyle = GREEN;
          ctx.fill();
          ctx.textAlign = "right";
          ctx.fillText(String(rng), px - 8, py);
        }
      }
    }

    // alternate wind speeds (2/5/10 mph) from the same direction as the input wind
    const labels = [];
    for (const [mph, pts0] of sol.alts) {
      const pts = pts0.filter((p) => inside(p[1], p[2]));
      if (pts.length < 2) continue;
      const atRange = pts.find((p) => p[0] === sol.range);
      const side2 = (atRange ? atRange[1] : pts[pts.length - 1][1]) - sol.arc_x0;
      const col = side2 < -0.02 ? AMBER_DK : side2 > 0.02 ? BLUE_DK : "#777";
      ctx.beginPath();
      pts.forEach((p, i) => { const [px, py] = P(p[1], p[2]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      const [ex, ey] = P(pts[pts.length - 1][1], pts[pts.length - 1][2]);
      labels.push([ex, ey + 10, String(mph), col]);
    }
    labels.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < labels.length; i++) {
      if (labels[i][0] - labels[i - 1][0] < 18) labels[i][0] = labels[i - 1][0] + 18;
    }
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (const [x, y, t, col] of labels) { ctx.fillStyle = col; ctx.fillText(t, x, y); }

    // aim point on the target
    const [px, py] = P(sol.hold_x, sol.hold_y);
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#00b050";
    ctx.fill();
    if (flash) {
      ctx.beginPath();
      ctx.arc(px, py, Math.max(14, ((15 * 27.78) / sol.range) * ppm), 0, Math.PI * 2);
      ctx.strokeStyle = "#39e58c";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
  ctx.restore();

  if (sol && redDot && !inside(sol.hold_x, sol.hold_y)) {
    ctx.fillStyle = "#ff5a5a";
    ctx.textAlign = "center";
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.fillText("Hold is outside the 3x view - switch to 1x", W / 2, 16);
  }
}
