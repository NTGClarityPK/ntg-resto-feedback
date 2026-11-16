// POST { qr } -> validates the signed QR and reports whether this bill can still be rated.
import { db, json, preflight, verifyQr, windowState, hashWithSecret, DEVICE_DAILY_LIMIT } from "../_shared/common.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const { qr } = await req.json().catch(() => ({}));
  const payload = typeof qr === "string" ? await verifyQr(qr) : null;
  if (!payload) return json({ status: "invalid" }, 400);

  const win = windowState(payload.p);
  if (!win.open) return json({ status: "expired" });

  const supabase = db();
  const { data: existing } = await supabase
    .from("feedback_submissions")
    .select("id")
    .eq("tenant_id", payload.t)
    .eq("order_id", payload.o)
    .maybeSingle();
  if (existing) return json({ status: "already_submitted" });

  const deviceId = req.headers.get("x-device-id") ?? "";
  if (deviceId) {
    const deviceHash = await hashWithSecret(deviceId);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("feedback_submissions")
      .select("id", { count: "exact", head: true })
      .eq("device_hash", deviceHash)
      .gte("created_at", since);
    if ((count ?? 0) >= DEVICE_DAILY_LIMIT) return json({ status: "limit_reached" });
  }

  return json({
    status: "open",
    tenantId: payload.t,
    orderId: payload.o,
    expiresAt: win.expiresAt,
    remainingMs: win.remainingMs,
  });
});
