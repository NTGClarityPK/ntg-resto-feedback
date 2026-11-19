// POST { qr, dishRatings, categoryRatings, review } -> stores the guest's feedback for a bill.
import {
  db, json, preflight, verifyQr, windowState, hashWithSecret, clientIp, receiptDishNames,
  DEVICE_DAILY_LIMIT, IP_HOURLY_LIMIT, ONE_FEEDBACK_PER_BILL,
} from "../_shared/common.ts";

const RATINGS = ["good", "okay", "bad"];
const CATEGORIES = ["service", "food", "speed", "clean", "ambience", "value"];
const FACES = ["happy", "neutral", "sad"];

function str(v: unknown, max: number): string | null {
  return typeof v === "string" ? v.trim().slice(0, max) : null;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "bad_request" }, 400);

  const payload = typeof body.qr === "string" ? await verifyQr(body.qr) : null;
  if (!payload) return json({ status: "invalid" }, 400);
  if (!windowState(payload.p).open) return json({ status: "expired" });

  // Validate and clamp every field. Nothing from the client is stored unchecked.
  // The signed receipt QR is the only source of dishes (Resto sends up to 10, the top ones by
  // price), so a guest can only rate dishes on their receipt. No dishes in the QR: no dish ratings.
  const signedDishes = receiptDishNames(payload.receipt);
  const dishes = signedDishes.map((name) => ({ name }));
  const allowed = new Set(signedDishes.map((n) => n.toLowerCase()));

  const dishRatings = Array.isArray(body.dishRatings)
    ? body.dishRatings.slice(0, 60).flatMap((r: any) => {
        const name = str(r?.name, 80);
        if (!name || !RATINGS.includes(r?.rating)) return [];
        if (!allowed.has(name.toLowerCase())) return [];
        const tags = Array.isArray(r.tags)
          ? r.tags.filter((t: unknown) => typeof t === "string").slice(0, 10).map((t: string) => t.slice(0, 40))
          : [];
        return [{ name, rating: r.rating, tags }];
      })
    : [];

  const categoryRatings: Record<string, string> = {};
  if (body.categoryRatings && typeof body.categoryRatings === "object") {
    for (const c of CATEGORIES) {
      const v = (body.categoryRatings as Record<string, unknown>)[c];
      if (typeof v === "string" && FACES.includes(v)) categoryRatings[c] = v;
    }
  }

  const review = str(body.review, 500) || null;

  const deviceId = req.headers.get("x-device-id") ?? "";
  if (!deviceId || deviceId.length > 100) return json({ status: "invalid" }, 400);
  const deviceHash = await hashWithSecret(deviceId);
  const ipHash = await hashWithSecret(clientIp(req));

  const supabase = db();

  // One feedback per bill (switched off while testing, see common.ts).
  if (ONE_FEEDBACK_PER_BILL) {
  const { data: existing } = await supabase
    .from("feedback_submissions")
    .select("id")
    .eq("tenant_id", payload.t)
    .eq("order_id", payload.o)
    .maybeSingle();
  if (existing) return json({ status: "already_submitted" });
  }

  // Per-device daily limit.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: deviceCount } = await supabase
    .from("feedback_submissions")
    .select("id", { count: "exact", head: true })
    .eq("device_hash", deviceHash)
    .gte("created_at", dayAgo);
  if ((deviceCount ?? 0) >= DEVICE_DAILY_LIMIT) return json({ status: "limit_reached" });

  // Per-network hourly limit, generous so shared Wi-Fi does not block real guests.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: ipCount } = await supabase
    .from("feedback_submissions")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", hourAgo);
  if ((ipCount ?? 0) >= IP_HOURLY_LIMIT) return json({ status: "limit_reached" });

  const { error } = await supabase.from("feedback_submissions").insert({
    tenant_id: payload.t,
    order_id: payload.o,
    printed_at: new Date(payload.p * 1000).toISOString(),
    ocr_text: null,             // the bill-photo step is gone; column kept for older rows
    receipt: payload.receipt,   // structured receipt from a v2 QR, null for older QRs
    dishes,
    dish_ratings: dishRatings,
    category_ratings: categoryRatings,
    review,
    device_hash: deviceHash,
    ip_hash: ipHash,
  });

  // A race between two submits for the same bill hits the unique constraint.
  if (error?.code === "23505") return json({ status: "already_submitted" });
  if (error) return json({ error: "store_failed" }, 500);

  return json({ status: "saved" }, 201);
});
