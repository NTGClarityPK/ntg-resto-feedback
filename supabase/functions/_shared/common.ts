// Shared helpers for all edge functions. Runs on Deno.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { verifyQrToken, type QrPayload } from "./qr.ts";

export const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours from print time
export const DEVICE_DAILY_LIMIT = 2;
export const IP_HOURLY_LIMIT = 20;

const enc = new TextEncoder();

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-device-id",
  "access-control-allow-methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

// A 204 response must not have a body, so the preflight is built without json().
export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response(null, { status: 204, headers: CORS }) : null;
}

export function db(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export { MAX_RECEIPT_ITEMS, receiptDishNames } from "./qr.ts";
export type { QrPayload, Receipt, ReceiptItem } from "./qr.ts";

// Verifies a receipt QR (v1 order-only, or v2 full receipt). Format details are in qr.ts.
export function verifyQr(token: string): Promise<QrPayload | null> {
  return verifyQrToken(token, Deno.env.get("QR_SIGNING_KEY") ?? "");
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
