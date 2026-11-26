// Point-mass ballistic solver. Line-for-line port of solver/core.py.
// Units inside the solver: feet, seconds, ft/s, degrees F, inHg.
// Profiles use shooter-friendly units (yards, inches, grains, mph).

import { TABLES } from "./drag_tables.js";

export const GRAVITY = 32.17405;
export const STD_DENSITY = 0.076474;
export const DRAG_K = (STD_DENSITY * Math.PI) / (8 * 144);
export const DT = 0.0005;
export const MIL_PER_RAD = 1000.0;
export const MOA_PER_RAD = (60 * 180) / Math.PI;

// ---------------------------------------------------------------- atmosphere
export function air(tempF, pressureInhg, humidityPct) {
  const tC = ((tempF - 32) * 5) / 9;
  const tK = tC + 273.15;
  const pPa = pressureInhg * 3386.389;
  const pSat = 610.78 * 10 ** ((7.5 * tC) / (tC + 237.3));
  const pV = (pSat * humidityPct) / 100.0;
  const pD = pPa - pV;
  const rhoKg = pD / (287.058 * tK) + pV / (461.495 * tK);
  const rhoLb = rhoKg * 0.062428;
  const speedOfSound = 49.0223 * Math.sqrt(tempF + 459.67);
  return [rhoLb / STD_DENSITY, speedOfSound];
}

export function stationPressure(baroInhg, altitudeFt) {
  return baroInhg * (1 - 6.8756e-6 * altitudeFt) ** 5.2559;
}

export function normalizeAtmo(a) {
  if (a == null) return null;
  const out = { ...a };
  if ("baro_inhg" in out) {
    out.pressure_inhg = stationPressure(out.baro_inhg, out.altitude_ft ?? 0);
  }
  if (out.humidity_pct === undefined) out.humidity_pct = 0;
  return out;
}

export function densityAltitude(tempF, stationInhg, humidityPct) {
  const [rhoRatio] = air(tempF, stationInhg, humidityPct);
  return (1 - rhoRatio ** (1 / 4.2559)) / 6.8756e-6;
}

// ---------------------------------------------------------------- drag
export function dragCd(table, mach) {
  if (mach <= table[0][0]) return table[0][1];
  if (mach >= table[table.length - 1][0]) return table[table.length - 1][1];
  let lo = 0;
  let hi = table.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table[mid][0] <= mach) lo = mid;
    else hi = mid;
  }
  const [m0, c0] = table[lo];
  const [m1, c1] = table[hi];
  return c0 + ((c1 - c0) * (mach - m0)) / (m1 - m0);
}

export function bcAt(bc, v) {
  if (!Array.isArray(bc)) return bc;
  for (const [minV, value] of bc) {
    if (v >= minV) return value;
  }
  return bc[bc.length - 1][1];
}

// ---------------------------------------------------------------- spin drift
export function millerStability(weightGr, diameterIn, lengthIn, twistIn, mvFps, tempF, pressureInhg) {
  const t = twistIn / diameterIn;
  const l = lengthIn / diameterIn;
  let sg = (30 * weightGr) / (t ** 2 * diameterIn ** 3 * l * (1 + l ** 2));
  sg *= (mvFps / 2800) ** (1 / 3);
  sg *= ((tempF + 459.67) / 518.67) * (29.92 / pressureInhg);
  return sg;
}

// ---------------------------------------------------------------- core flight
// x = along line of sight, y = up (perpendicular to LOS), z = right.
// Returns [rangeFt, yFt, zFt, velocityFps, timeS, mach] at each requested LOS range.
export function fly(bc, table, mv, boreAngle, sightHeightFt, lookAngle,
                    rhoRatio, sos, windX, windZ, rangesFt, windY = 0.0, tempF = null) {
  const gx = -GRAVITY * Math.sin(lookAngle);
  const gy = -GRAVITY * Math.cos(lookAngle);
  const sinL = Math.sin(lookAngle);
  const cosL = Math.cos(lookAngle);
  const tempR = tempF === null ? 518.67 : tempF + 459.67;
  let rhoNow = rhoRatio;
  let sosNow = sos;

  const accel = (vx, vy, vz) => {
    const rx = vx - windX;
    const ry = vy - windY;
    const rz = vz - windZ;
    const v = Math.sqrt(rx * rx + ry * ry + rz * rz);
    const k = (rhoNow * DRAG_K * dragCd(table, v / sosNow) * v) / bcAt(bc, v);
    return [-k * rx + gx, -k * ry + gy, -k * rz];
  };

  let x = 0.0;
  let y = -sightHeightFt;
  let z = 0.0;
  let t = 0.0;
  let vx = mv * Math.cos(boreAngle);
  let vy = mv * Math.sin(boreAngle);
  let vz = 0.0;
  const out = [];
  let i = 0;
  const targets = [...rangesFt].sort((a, b) => a - b);

  while (i < targets.length) {
    if (lookAngle !== 0.0) {
      const dh = x * sinL + y * cosL;
      const tRatio = (tempR - 0.0035662 * dh) / tempR;
      rhoNow = rhoRatio * tRatio ** 4.2559;
      sosNow = sos * Math.sqrt(tRatio);
    }

    const a1 = accel(vx, vy, vz);
    const v2 = [vx + (a1[0] * DT) / 2, vy + (a1[1] * DT) / 2, vz + (a1[2] * DT) / 2];
    const a2 = accel(...v2);
    const v3 = [vx + (a2[0] * DT) / 2, vy + (a2[1] * DT) / 2, vz + (a2[2] * DT) / 2];
    const a3 = accel(...v3);
    const v4 = [vx + a3[0] * DT, vy + a3[1] * DT, vz + a3[2] * DT];
    const a4 = accel(...v4);
    const nx = x + (DT / 6) * (vx + 2 * v2[0] + 2 * v3[0] + v4[0]);
    const ny = y + (DT / 6) * (vy + 2 * v2[1] + 2 * v3[1] + v4[1]);
    const nz = z + (DT / 6) * (vz + 2 * v2[2] + 2 * v3[2] + v4[2]);
    const nvx = vx + (DT / 6) * (a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0]);
    const nvy = vy + (DT / 6) * (a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1]);
    const nvz = vz + (DT / 6) * (a1[2] + 2 * a2[2] + 2 * a3[2] + a4[2]);

    while (i < targets.length && nx >= targets[i]) {
      const f = nx !== x ? (targets[i] - x) / (nx - x) : 0.0;
      const vel = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const nvel = Math.sqrt(nvx * nvx + nvy * nvy + nvz * nvz);
      const vAt = vel + f * (nvel - vel);
      out.push([targets[i], y + f * (ny - y), z + f * (nz - z), vAt, t + f * DT, vAt / sos]);
      i += 1;
    }

    x = nx; y = ny; z = nz; vx = nvx; vy = nvy; vz = nvz; t += DT;
    if (t > 10 || vx <= 0) break;
  }
  return out;
}

export function zeroAngle(bc, table, mv, sightHeightFt, zeroFt, rhoRatio, sos, targetFt = 0.0) {
  let lo = -0.02;
  let hi = 0.05;
  for (let n = 0; n < 60; n++) {
    const mid = (lo + hi) / 2;
    const y = fly(bc, table, mv, mid, sightHeightFt, 0.0, rhoRatio, sos, 0.0, 0.0, [zeroFt])[0][1];
    if (y > targetFt) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------- public API
// Elevation: positive = dial UP. Windage: positive = dial/hold RIGHT.
// windDirDeg is where the wind comes FROM (0 = headwind, 90 = from the right).
export function solve(profile, rangesYd, windMph = 0.0, windDirDeg = 90.0, lookAngleDeg = 0.0, atmoIn = null) {
  const table = TABLES[profile.drag_model.toUpperCase()];
  const bc = profile.bc_bands && profile.bc_bands.length ? profile.bc_bands : profile.bc;
  const mv = profile.muzzle_velocity_fps;
  const sh = profile.sight_height_in / 12.0;
  const zeroFt = profile.zero_range_yd * 3.0;

  const zAtmo = normalizeAtmo(profile.zero_atmosphere ?? { temp_f: 59, pressure_inhg: 29.92, humidity_pct: 0 });
  const atmo = normalizeAtmo(atmoIn) || zAtmo;

  const [zr, zsos] = air(zAtmo.temp_f, zAtmo.pressure_inhg, zAtmo.humidity_pct);
  // Per-load zero offset: inches this load lands above (+) or below (-) the point of aim at the zero range.
  const bore = zeroAngle(bc, table, mv, sh, zeroFt, zr, zsos, (profile.zero_offset_in ?? 0) / 12.0);

  const [rho, sos] = air(atmo.temp_f, atmo.pressure_inhg, atmo.humidity_pct);
  const w = windMph * 1.46667;
  const wd = (windDirDeg * Math.PI) / 180;
  const look = (lookAngleDeg * Math.PI) / 180;
  const wHead = -w * Math.cos(wd);
  const windZ = -w * Math.sin(wd);
  const windX = wHead * Math.cos(look);
  const windY = -wHead * Math.sin(look);
  const pts = fly(bc, table, mv, bore, sh, look, rho, sos, windX, windZ,
                  rangesYd.map((r) => r * 3.0), windY, atmo.temp_f);

  let sg = null;
  if ((profile.spin_drift ?? true) && profile.bullet_length_in && profile.twist_in) {
    sg = millerStability(profile.bullet_weight_gr, profile.bullet_diameter_in,
                         profile.bullet_length_in, profile.twist_in, mv,
                         atmo.temp_f, atmo.pressure_inhg);
  }
  const twistSign = (profile.twist_direction ?? "right") === "left" ? -1 : 1;

  const weight = profile.bullet_weight_gr || 0;
  const muzzleMach = mv / sos;
  return pts.map(([x, yIn, zIn, v, t, mach]) => {
    let y = yIn;
    let z = zIn;
    if (sg !== null) z += (twistSign * 1.25 * (sg + 1.2) * t ** 1.83) / 12.0;
    const angY = x > 0 ? Math.atan2(y, x) : 0.0;
    const angZ = x > 0 ? Math.atan2(z, x) : 0.0;
    return {
      range_yd: Math.round(x / 3.0),
      drop_in: y * 12,
      elev_mil: -angY * MIL_PER_RAD,
      elev_moa: -angY * MOA_PER_RAD,
      wind_in: z * 12,
      wind_mil: -angZ * MIL_PER_RAD,
      wind_moa: -angZ * MOA_PER_RAD,
      velocity_fps: v,
      energy_ftlb: weight ? (weight * v * v) / 450240.0 : null,
      tof_s: t,
      mach,
      muzzle_mach: muzzleMach,
      transonic: muzzleMach > 1.0 && mach < 1.2,
      near_mach1: muzzleMach >= 0.95 && muzzleMach <= 1.0,
    };
  });
}
