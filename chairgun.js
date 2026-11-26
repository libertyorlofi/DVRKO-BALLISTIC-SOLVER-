// Import a ChairGun Elite export (emailed .eml, or its text saved as .txt/.html).
// Port of solver/chairgun_import.py: same fields, same regular expressions, same results (tested against Python).
//
// Reads the rifle, cartridge, zero weather and current weather, plus the DOPE table.

// ---------------------------------------------------------------- text extraction
const NAMED = { nbsp: "\u00a0", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", deg: "\u00b0", middot: "\u00b7" };

function unescapeHtml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

function htmlToText(h) {
  h = h.replace(/<br\s*\/?>|<\/p>|<\/tr>/gi, "\n");
  h = h.replace(/<\/td>/gi, " ");
  return unescapeHtml(h.replace(/<[^>]+>/g, ""));
}

const latin1 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; };
const toBytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

function splitMessage(raw) {
  const m = /\r?\n\r?\n/.exec(raw);
  const headText = m ? raw.slice(0, m.index) : raw;
  const body = m ? raw.slice(m.index + m[0].length) : "";
  const headers = {};
  for (const line of headText.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return { headers, body };
}

function decodeBody(body, cte, charset) {
  let bytes;
  cte = (cte || "").toLowerCase();
  if (cte === "base64") {
    bytes = toBytes(atob(body.replace(/\s+/g, "")));
  } else if (cte === "quoted-printable") {
    const s = body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
    bytes = toBytes(s);
  } else {
    bytes = toBytes(body);
  }
  try { return new TextDecoder(charset || "utf-8").decode(bytes); } catch { return new TextDecoder("utf-8").decode(bytes); }
}

// Returns { type: "text/plain" | "text/html", text } or null. Prefers plain text, like the Python version.
function findBody(raw) {
  const { headers, body } = splitMessage(raw);
  const ctype = headers["content-type"] || "text/plain";
  const bm = /boundary="?([^";]+)"?/i.exec(ctype);
  if (/^multipart\//i.test(ctype) && bm) {
    const parts = body.split("--" + bm[1]).slice(1).filter((p) => !p.startsWith("--")).map((p) => p.replace(/^\r?\n/, ""));
    const found = parts.map(findBody).filter(Boolean);
    return found.find((f) => f.type === "text/plain") || found.find((f) => f.type === "text/html") || null;
  }
  const type = ctype.split(";")[0].trim().toLowerCase();
  if (type !== "text/plain" && type !== "text/html") return null;
  const cs = /charset="?([^";]+)"?/i.exec(ctype);
  return { type, text: decodeBody(body, headers["content-transfer-encoding"], cs ? cs[1] : "utf-8") };
}

// bytes: Uint8Array of the file; name: file name
export function readText(name, bytes) {
  const raw = latin1(bytes);
  if (name.toLowerCase().endsWith(".eml") || raw.slice(0, 200).toLowerCase().includes("mime-version")) {
    const part = findBody(raw);
    if (!part) return "";
    return part.type === "text/html" ? htmlToText(part.text) : part.text;
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  return text.toLowerCase().includes("<td") ? htmlToText(text) : text;
}

// ---------------------------------------------------------------- parsing
function num(re, text, dflt = null) {
  const m = re.exec(text);
  return m ? parseFloat(m[1]) : dflt;
}

export function parse(text) {
  const t = text.replace(/\u00a0/g, " ");
  const rifleName = ((/Rifle:\s*(.+)/.exec(t) || [null, "Imported rifle"])[1]).trim();
  const cart = ((/Cartridge:\s*(.+)/.exec(t) || [null, "Imported ammo"])[1]).trim();

  const twist = num(/Twist rate, inches:\s*([\d.]+)/i, t);
  const twistDir = /Twist rate[^\n]*left/i.test(t) ? "left" : "right";
  const rifle = {
    name: rifleName,
    sight_height_in: num(/Scope height, inches:\s*([\d.]+)/i, t, 1.5),
    zero_range_yd: num(/Zero Distance, yards:\s*([\d.]+)/i, t, 100),
    twist_direction: twistDir,
  };
  if (twist) rifle.twist_in = twist;

  // zero weather (only if ChairGun has it enabled)
  const zw = /Zeroing weather\.\s*Enabled([\s\S]*?)(?:\n\s*\n|Weather)/i.exec(t);
  if (zw) {
    const z = zw[1];
    rifle.zero_atmosphere = {
      temp_f: num(/Temperature, \S*F:\s*([-\d.]+)/i, z, 59),
      pressure_inhg: num(/Station pressure, inHg:\s*([\d.]+)/i, z, 29.92),
      humidity_pct: num(/humidity, %:\s*([\d.]+)/i, z, 0),
    };
  }

  // current weather = the "Weather" block (after the rifle block)
  const wpos = t.lastIndexOf("\nWeather");
  const wb = wpos >= 0 ? t.slice(wpos) : "";
  const info = {};
  if (wb) {
    info.weather = {
      temp_f: num(/Temperature, \S*F:\s*([-\d.]+)/i, wb),
      humidity_pct: num(/Humidity, %:\s*([\d.]+)/i, wb),
      pressure_inhg: num(/Station pressure, inHg:\s*([\d.]+)/i, wb),
    };
    info.wind_mph = num(/Wind speed, mph:\s*([\d.]+)/i, wb, 0);
    info.wind_dir_deg = num(/Wind direction, degrees:\s*([-\d.]+)/i, wb, 90);
    if (Object.values(info.weather).every((v) => v !== null)) rifle.conditions = info.weather;
  }
  info.slope_deg = num(/Slope angle, degrees:\s*([-\d.]+)/i, t, 0);

  const bc = /Ballistic coefficient:\s*([\d.]+)\s*\((G\d)\)/.exec(t);
  const load = {
    name: cart,
    drag_model: bc ? bc[2].toUpperCase() : "G7",
    bc: bc ? parseFloat(bc[1]) : 0.25,
    muzzle_velocity_fps: num(/Velocity[^\n:]*f\/s:\s*([\d.]+)/i, t, 2700),
    bullet_weight_gr: num(/Bullet weight, grains:\s*([\d.]+)/i, t, 140),
    bullet_diameter_in: num(/Bullet diameter, inches:\s*([\d.]+)/i, t, 0.264),
  };
  const blen = num(/Bullet length, inches:\s*([\d.]+)/i, t);
  if (blen) load.bullet_length_in = blen;
  const sd = /Adding spin drift to results:\s*(On|Off)/i.exec(t);
  if (sd) load.spin_drift = sd[1].toLowerCase() === "on";
  load.notes = "Imported from ChairGun Elite";

  // DOPE table: "100.0 2813.5 1915.8 0.10 D0.00 R0.14 R6.97"
  const unit = /Vertical\s+Correction,\s*MRAD/i.test(t) ? "mil" : "moa";
  const rows = [];
  const re = /^\s*(\d+\.\d)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([UD])([\d.]+)\s+([LR])([\d.]+)/gm;
  let m;
  while ((m = re.exec(t)) !== null) {
    rows.push({
      range_yd: parseFloat(m[1]), velocity_fps: parseFloat(m[2]), tof_s: parseFloat(m[4]),
      elev: parseFloat(m[6]) * (m[5] === "U" ? 1 : -1), wind: parseFloat(m[8]) * (m[7] === "R" ? 1 : -1),
    });
  }
  info.dope = rows;
  info.dope_unit = unit;
  return { rifle, load, info };
}

// Adds the imported load to an existing rifle with the same name (replacing a load of the same name), or returns
// the new rifle. `rifles` is the app's array. Returns the rifle object to keep.
export function mergeInto(rifles, rifle, load) {
  const existing = rifles.find((r) => r.name === rifle.name);
  if (!existing) {
    rifle.loads = [load];
    rifles.push(rifle);
    return rifle;
  }
  for (const [k, v] of Object.entries(rifle)) if (k !== "name") existing[k] = v;
  existing.loads = [...(existing.loads || []).filter((l) => l.name !== load.name), load];
  return existing;
}
