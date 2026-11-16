// POST { qr, imageBase64, mediaType } -> reads the dish lines off a receipt photo.
// OCR runs here, not in Resto, so the guest app has no connection to Resto's data.
import { json, preflight, verifyQr, windowState } from "../_shared/common.ts";

const MAX_BASE64_CHARS = 6_000_000; // about 4.5 MB of image
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

const PROMPT = `This is a photo of a restaurant bill. Return ONLY a JSON object, no prose:
{"rawText": "<all readable text, line by line>", "dishes": ["<each food or drink item name exactly as printed, without prices or quantities>"]}
Exclude taxes, service charges, totals, table or server names, and payment lines.
If the photo is not a bill, return {"rawText": "", "dishes": []}.`;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "bad_request" }, 400);

  const payload = typeof body.qr === "string" ? await verifyQr(body.qr) : null;
  if (!payload) return json({ status: "invalid" }, 400);
  if (!windowState(payload.p).open) return json({ status: "expired" }, 410);

  const { imageBase64, mediaType } = body;
  if (typeof imageBase64 !== "string" || imageBase64.length > MAX_BASE64_CHARS) {
    return json({ error: "image_too_large" }, 413);
  }
  if (!ALLOWED_TYPES.includes(mediaType)) return json({ error: "unsupported_type" }, 415);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ocr_not_configured" }, 500);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      // Cheapest current model. Reading a receipt needs no reasoning, so thinking is off:
      // it would add cost and use up max_tokens before the JSON is written.
      model: "claude-haiku-5-5",
      max_tokens: 1200,
      thinking: { type: "disabled" },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: PROMPT },
        ],
      }],
    }),
  });
  if (!res.ok) return json({ error: "ocr_failed" }, 502);

  const out = await res.json();
  // Take the text block wherever it is; the reply can also contain other block types.
  const textBlock = Array.isArray(out?.content)
    ? out.content.find((b: { type?: string }) => b?.type === "text")
    : null;
  const text: string = typeof textBlock?.text === "string" ? textBlock.text : "";
  const match = text.match(/\{[\s\S]*\}/);
  let parsed: { rawText?: unknown; dishes?: unknown } = {};
  try { parsed = match ? JSON.parse(match[0]) : {}; } catch { parsed = {}; }

  const dishes = Array.isArray(parsed.dishes)
    ? parsed.dishes
        .filter((d): d is string => typeof d === "string")
        .map((d) => d.trim())
        .filter((d) => d.length > 0 && d.length <= 80)
        .slice(0, 60)
    : [];

  return json({
    status: "ok",
    dishes,
    rawText: typeof parsed.rawText === "string" ? parsed.rawText.slice(0, 4000) : "",
  });
});
