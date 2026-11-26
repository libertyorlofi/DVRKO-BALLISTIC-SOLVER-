// WMLRF rangefinder link. Port of solver/rangefinder.py using Web Bluetooth.
//
// Packet (notify on FFF1):  EE 16 0D | 34 03 | 00 00 00 | RR RR | FF FF | AA AA AA AA | CS
//   range    = bytes 6..9 big-endian / 256  -> meters
//   angle    = bytes 12..15 float32 little-endian (degrees, probable, not yet confirmed)
//   checksum = sum(bytes 3..15) & 0xFF
// parsePacket() has no browser dependencies so it can be tested in Node.

export const FFF0 = 0xfff0;
export const FFF1 = 0xfff1;
const M_TO_YD = 1 / 0.9144;

const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0").toUpperCase()).join(" ");

export function parsePacket(data) {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength);
  if (b.length < 17 || b[0] !== 0xee || b[1] !== 0x16) return null;
  const n = b[2];
  if (b.length < 3 + n + 1) return null;
  let sum = 0;
  for (let i = 3; i < 3 + n; i++) sum += b[i];
  if ((sum & 0xff) !== b[3 + n]) return null;            // bad checksum
  if (b[3] !== 0x34 || b[4] !== 0x03) return null;       // not a range message
  const raw = ((b[6] << 24) >>> 0) + (b[7] << 16) + (b[8] << 8) + b[9];
  const rangeM = raw / 256.0;
  let angle = new DataView(b.buffer, b.byteOffset + 12, 4).getFloat32(0, true);
  if (!(angle >= -90.0 && angle <= 90.0)) angle = null;   // also rejects NaN
  return { range_m: rangeM, range_yd: rangeM * M_TO_YD, angle_deg: angle, raw: hex(b) };
}

export function bluetoothSupport() {
  if (!("bluetooth" in navigator)) {
    return "This browser has no Bluetooth. On iPhone use the Bluefy app; on Android use Chrome; on a PC use Chrome or Edge.";
  }
  if (!window.isSecureContext) {
    return "Bluetooth needs a secure page (https:// or localhost). This address is plain http, so the browser blocks it.";
  }
  return "";
}

export class LrfLink {
  // handlers: onStatus(text, kind) with kind "ok" | "warn" | "err" | "info";  onReading(reading)
  constructor({ onStatus, onReading }) {
    this.onStatus = onStatus;
    this.onReading = onReading;
    this.device = null;
    this.char = null;
    this.wantConnected = false;
    this._handler = (ev) => {
      const r = parsePacket(new Uint8Array(ev.target.value.buffer.slice(ev.target.value.byteOffset,
        ev.target.value.byteOffset + ev.target.value.byteLength)));
      if (r) this.onReading(r);
    };
    this._onDisconnect = () => {
      if (!this.wantConnected) return;
      this.onStatus("Connection lost, reconnecting...", "warn");
      this._reconnect(3);
    };
  }

  get connected() { return !!(this.device && this.device.gatt && this.device.gatt.connected); }

  async connect() {
    const why = bluetoothSupport();
    if (why) { this.onStatus(why, "err"); return; }
    try {
      this.onStatus("Choose your rangefinder in the list...", "info");
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [FFF0] }, { namePrefix: "EE09" }],
        optionalServices: [FFF0],
      });
      this.wantConnected = true;
      this.device.addEventListener("gattserverdisconnected", this._onDisconnect);
      await this._open();
    } catch (ex) {
      this.wantConnected = false;
      if (ex && ex.name === "NotFoundError") this.onStatus("No rangefinder chosen.", "warn");
      else this.onStatus(`Error: ${ex && ex.message ? ex.message : ex}`, "err");
    }
  }

  async _open() {
    this.onStatus("Connecting...", "info");
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(FFF0);
    this.char = await service.getCharacteristic(FFF1);
    this.char.addEventListener("characteristicvaluechanged", this._handler);
    await this.char.startNotifications();
    this.onStatus(`Connected: ${this.device.name || "rangefinder"}`, "ok");
  }

  async _reconnect(tries) {
    for (let i = 0; i < tries && this.wantConnected; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try { await this._open(); return; } catch { /* try again */ }
    }
    if (this.wantConnected) { this.wantConnected = false; this.onStatus("Disconnected", "warn"); }
  }

  disconnect() {
    this.wantConnected = false;
    try { if (this.char) this.char.removeEventListener("characteristicvaluechanged", this._handler); } catch { /* ignore */ }
    try { if (this.device && this.device.gatt.connected) this.device.gatt.disconnect(); } catch { /* ignore */ }
    this.onStatus("Disconnected", "warn");
  }
}
