// Shared helpers for all edge functions. Runs on Deno.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export const WINDOW_MS = 30 * 60 * 1000;
export const DEVICE_DAILY_LIMIT = 2;
export const IP_HOURLY_LIMIT = 20;

const enc = new TextEncoder();

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type, x-device-id",
      "access-control-allow-methods": "POST, OPTIONS",
    },
  });
}

export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? json({}, 204) : null;
}

export function db(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(Deno.env.get("QR_SIGNING_KEY")!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify", "sign"],
  );
}

export interface QrPayload {
  t: string;   // tenant id
  o: string;   // order id
  p: number;   // receipt print time, unix seconds
}

// QR format: <payload b64url>.<signature b64url>, payload is JSON {t,o,p}.
export async function verifyQr(token: string): Promise<QrPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(),
    b64urlToBytes(sigB64),
    enc.encode(payloadB64),
  );
  if (!ok) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64)));
    if (typeof data.t !== "string" || typeof data.o !== "string" || typeof data.p !== "number") return null;
    return data as QrPayload;
  } catch {
    return null;
  }
}

export async function hashWithSecret(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(Deno.env.get("HASH_SECRET")!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
}

export function windowState(printedAtSec: number): { open: boolean; expiresAt: string; remainingMs: number } {
  const expiresMs = printedAtSec * 1000 + WINDOW_MS;
  const remainingMs = Math.max(0, expiresMs - Date.now());
  return { open: remainingMs > 0, expiresAt: new Date(expiresMs).toISOString(), remainingMs };
}
