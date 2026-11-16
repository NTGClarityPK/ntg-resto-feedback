// Builds the QR payload printed on receipts.
// Usage: QR_SIGNING_KEY=... node scripts/sign-qr.mjs <tenantId> <orderId> [printedAtISO] [appUrl]
// Resto runs the same logic on its side when printing receipts.
import { createHmac } from "node:crypto";

const [tenantId, orderId, printedAt = new Date().toISOString(), appUrl = "https://feedback.example.com"] = process.argv.slice(2);
const key = process.env.QR_SIGNING_KEY;

if (!tenantId || !orderId || !key) {
  console.error("Need tenantId, orderId and QR_SIGNING_KEY in the environment.");
  process.exit(1);
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const payload = b64url(JSON.stringify({
  t: tenantId,
  o: orderId,
  p: Math.floor(new Date(printedAt).getTime() / 1000),
}));
const sig = b64url(createHmac("sha256", key).update(payload).digest());

console.log(`${appUrl}/?qr=${payload}.${sig}`);
