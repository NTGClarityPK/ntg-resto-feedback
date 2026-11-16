// POST { cutoff } with header x-cleanup-key. Scheduled once a day, after Resto's pull.
// Deletes rows created up to the cutoff. Rows that arrive after the pull survive to the next run.
import { db, json, preflight } from "../_shared/common.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const key = req.headers.get("x-cleanup-key") ?? "";
  if (!key || key !== Deno.env.get("CLEANUP_KEY")) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  const cutoff = typeof body?.cutoff === "string" ? body.cutoff : null;
  if (!cutoff || Number.isNaN(Date.parse(cutoff))) return json({ error: "bad_cutoff" }, 400);

  const { error, count } = await db()
    .from("feedback_submissions")
    .delete({ count: "exact" })
    .lte("created_at", cutoff);
  if (error) return json({ error: "delete_failed" }, 500);

  return json({ deleted: count ?? 0 });
});
