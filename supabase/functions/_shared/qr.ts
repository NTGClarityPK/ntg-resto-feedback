// Signed QR tokens printed on receipts. No Supabase imports, so this file also runs in tests.
//
// v1  <payload>.<sig>
//     payload = base64url(JSON {t, o, p})
//     sig     = base64url(HMAC-SHA256(QR_SIGNING_KEY, payload))
//
// v2  2.<payload>.<sig>
//     payload = base64url(deflate-raw(JSON receipt)), see RawReceiptV2 below
//     sig     = base64url(HMAC-SHA256(QR_SIGNING_KEY, "2." + payload))
//     Carries the whole receipt, so the guest never photographs the bill.
//     Bills with more than MAX_RECEIPT_ITEMS lines leave out "it"; the app then asks for a photo.

export const MAX_RECEIPT_ITEMS = 10;
const MAX_TOKEN_CHARS = 4000;      // a 10-item receipt is about 450 characters
const MAX_RECEIPT_BYTES = 16_000;  // limit after decompression, so a crafted token can't balloon

const enc = new TextEncoder();

export interface ReceiptItem { name: string; qty: number; price: number | null }

export interface Receipt {
  restaurant: string | null;
  table: string | null;
  server: string | null;
  currency: string | null;
  items: ReceiptItem[] | null;  // null when the bill was too long to fit in the QR
  itemCount: number | null;     // number of lines on the bill, also when items is null
  subtotal: number | null;
  tax: number | null;
  serviceCharge: number | null;
  discount: number | null;
  total: number | null;
}

export interface QrPayload {
  t: string;                 // tenant id
  o: string;                 // order id
  p: number;                 // receipt print time, unix seconds
  receipt: Receipt | null;   // v2 only
}

// What Resto puts in a v2 QR, before compression. Short keys keep the QR small.
interface RawReceiptV2 {
  t: string; o: string; p: number;
  r?: string; tb?: string; sv?: string; cur?: string;
  it?: [string, number, number?][]; // [name, quantity, unit price]
  n?: number;                       // line count, required when "it" is left out
  st?: number; tx?: number; sc?: number; dc?: number; tot?: number;
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacVerify(key: string, data: string, sig: Uint8Array): Promise<boolean> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", k, sig, enc.encode(data));
}

async function inflateRaw(bytes: Uint8Array, limit: number): Promise<string | null> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } catch {
    return null; // not valid deflate data
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return new TextDecoder().decode(out);
}

const text = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const money = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e9 ? v : null;

function toReceipt(raw: RawReceiptV2): Receipt | null {
  let items: ReceiptItem[] | null = null;
  if (raw.it !== undefined) {
    if (!Array.isArray(raw.it) || raw.it.length === 0 || raw.it.length > MAX_RECEIPT_ITEMS) return null;
    items = [];
    for (const line of raw.it) {
      if (!Array.isArray(line)) return null;
      const name = text(line[0], 80);
      const qty = line[1];
      if (!name || typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 999) return null;
      items.push({ name, qty, price: money(line[2]) });
    }
  }
  const n = typeof raw.n === "number" && Number.isInteger(raw.n) && raw.n >= 0 && raw.n < 10_000 ? raw.n : null;
  return {
    restaurant: text(raw.r, 80),
    table: text(raw.tb, 20),
    server: text(raw.sv, 40),
    currency: text(raw.cur, 8),
    items,
    itemCount: items ? items.length : n,
    subtotal: money(raw.st),
    tax: money(raw.tx),
    serviceCharge: money(raw.sc),
    discount: money(raw.dc),
    total: money(raw.tot),
  };
}

const validHeader = (d: { t?: unknown; o?: unknown; p?: unknown }) =>
  typeof d.t === "string" && d.t.length > 0 && d.t.length <= 100 &&
  typeof d.o === "string" && d.o.length > 0 && d.o.length <= 100 &&
  typeof d.p === "number" && Number.isFinite(d.p);

// Returns the verified contents of a QR token, or null if it is malformed or not signed with key.
export async function verifyQrToken(token: string, key: string): Promise<QrPayload | null> {
  if (!key || typeof token !== "string" || token.length > MAX_TOKEN_CHARS) return null;
  const parts = token.split(".");
  try {
    if (parts.length === 2) {
      const [payloadB64, sigB64] = parts;
      if (!(await hmacVerify(key, payloadB64, b64urlToBytes(sigB64)))) return null;
      const d = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
      return validHeader(d) ? { t: d.t, o: d.o, p: d.p, receipt: null } : null;
    }
    if (parts.length === 3 && parts[0] === "2") {
      const [, payloadB64, sigB64] = parts;
      if (!(await hmacVerify(key, `2.${payloadB64}`, b64urlToBytes(sigB64)))) return null;
      const json = await inflateRaw(b64urlToBytes(payloadB64), MAX_RECEIPT_BYTES);
      if (!json) return null;
      const raw = JSON.parse(json) as RawReceiptV2;
      if (!validHeader(raw)) return null;
      const receipt = toReceipt(raw);
      return receipt ? { t: raw.t, o: raw.o, p: raw.p, receipt } : null;
    }
  } catch {
    return null;
  }
  return null;
}

// Dish names for rating: each distinct item name once, in bill order.
export function receiptDishNames(receipt: Receipt | null): string[] {
  if (!receipt?.items) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const it of receipt.items) {
    const key = it.name.toLowerCase();
    if (!seen.has(key)) { seen.add(key); names.push(it.name); }
  }
  return names;
}
