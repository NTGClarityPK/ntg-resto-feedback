// POST { tenantId, orders: [{ orderId, dishes: string[] }] } with header x-resto-key.
// Returns only the feedback that matches Resto's own orders (tenant, order and dishes).
// Everything else stays in this database until cleanup-feedback clears it.
import { db, json, preflight } from "../_shared/common.ts";

interface OrderIn { orderId: string; dishes: string[] }

// Dish names come from OCR, so compare loosely: lowercase, letters and digits only.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const key = req.headers.get("x-resto-key") ?? "";
  if (!key || key !== Deno.env.get("RESTO_PULL_KEY")) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  if (!body || typeof body.tenantId !== "string" || !Array.isArray(body.orders)) {
    return json({ error: "bad_request" }, 400);
  }
  const orders: OrderIn[] = body.orders
    .filter((o: any) => typeof o?.orderId === "string" && Array.isArray(o?.dishes))
    .slice(0, 5000);

  const orderIds = orders.map((o) => o.orderId);
  const supabase = db();
  const cutoff = new Date().toISOString();

  const { data: rows, error } = await supabase
    .from("feedback_submissions")
    .select("order_id, dishes, dish_ratings, category_ratings, review, created_at")
    .eq("tenant_id", body.tenantId)
    .in("order_id", orderIds.length ? orderIds : ["__none__"])
    .lte("created_at", cutoff);
  if (error) return json({ error: "read_failed" }, 500);

  const byOrder = new Map(orders.map((o) => [o.orderId, new Set(o.dishes.map(norm))]));

  const matched = (rows ?? []).filter((row) => {
    const restoDishes = byOrder.get(row.order_id);
    if (!restoDishes) return false;
    // Every dish the guest confirmed must exist on Resto's order.
    return (row.dishes as { name: string }[]).every((d) => restoDishes.has(norm(d.name)));
  }).map((row) => ({
    orderId: row.order_id,
    dishRatings: row.dish_ratings,
    categoryRatings: row.category_ratings,
    review: row.review,
    createdAt: row.created_at,
  }));

  // Tell Resto the cutoff so cleanup removes only what was seen here.
  return json({ tenantId: body.tenantId, cutoff, feedback: matched });
});
