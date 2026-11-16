// Builds 3 test receipts for an 80mm thermal printer, each with a freshly signed QR code.
// Usage (PowerShell):
//   $env:QR_SIGNING_KEY = '<same value as the Supabase secret>'
//   npm run receipts                       -> uses this PC's Wi-Fi address on port 5173
//   npm run receipts -- http://192.168.1.20:5173
// Then open test-receipts.html in Chrome, press Ctrl+P and pick the thermal printer.
// Each QR works for 3 hours from the moment this script runs, and each one can be used once.
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import QRCode from "qrcode";

const TENANT_ID = "tenant-test";
const RESTAURANT = "Umair's Test Kitchen";
const TAX_RATE = 0.16;

// Seed menu, in PKR. Names are printed exactly like this, so OCR should return them as-is.
const ORDERS = [
  { table: "T-03", server: "Ali", items: [["Chicken Karahi (Half)", 1, 1450], ["Garlic Naan", 2, 120], ["Mint Raita", 1, 180], ["Mineral Water 1.5L", 1, 150]] },
  { table: "T-07", server: "Sara", items: [["Beef Biryani", 2, 850], ["Shami Kabab", 4, 140], ["Kheer", 2, 320], ["Pepsi 345ml", 2, 120]] },
  { table: "T-01", server: "Ahmed", items: [["Mutton Nihari", 1, 1250], ["Khamiri Roti", 3, 60], ["Chicken Tikka", 1, 780]] },
];

function lanUrl() {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal && /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a.address)) {
        return `http://${a.address}:5173`;
      }
    }
  }
  return "http://localhost:5173";
}

const key = process.env.QR_SIGNING_KEY;
if (!key) {
  console.error("QR_SIGNING_KEY is not set. In PowerShell run:  $env:QR_SIGNING_KEY = '<your key>'  then try again.");
  process.exit(1);
}
const appUrl = (process.argv[2] || lanUrl()).replace(/\/+$/, "");

const b64url = (buf) => Buffer.from(buf).toString("base64url");
function signedLink(orderId, printedAtSec) {
  const payload = b64url(JSON.stringify({ t: TENANT_ID, o: orderId, p: printedAtSec }));
  const sig = b64url(createHmac("sha256", key).update(payload).digest());
  return `${appUrl}/?qr=${payload}.${sig}`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const money = (n) => n.toLocaleString("en-PK");

const now = new Date();
const printedAtSec = Math.floor(now.getTime() / 1000);
const expires = new Date((printedAtSec + 3 * 60 * 60) * 1000);
const time = (d) => d.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" });
// Unique per run, so printing a new batch never hits "already submitted".
const stamp = now.toISOString().replace(/\D/g, "").slice(2, 12);

const receipts = [];
for (const [i, order] of ORDERS.entries()) {
  const orderId = `T${stamp}-${i + 1}`;
  const link = signedLink(orderId, printedAtSec);
  const qrSvg = await QRCode.toString(link, { type: "svg", margin: 3, errorCorrectionLevel: "L" });
  const subtotal = order.items.reduce((s, [, q, p]) => s + q * p, 0);
  const tax = Math.round(subtotal * TAX_RATE);
  receipts.push(`
  <section class="receipt">
    <div class="c big">${esc(RESTAURANT)}</div>
    <div class="c">Test receipt - not a real bill</div>
    <hr>
    <div class="row"><span>Order</span><span>${esc(orderId)}</span></div>
    <div class="row"><span>Table</span><span>${esc(order.table)}</span></div>
    <div class="row"><span>Server</span><span>${esc(order.server)}</span></div>
    <div class="row"><span>Date</span><span>${esc(now.toLocaleDateString("en-PK"))} ${esc(time(now))}</span></div>
    <hr>
    ${order.items.map(([name, qty, price]) => `
    <div class="item">${esc(name)}</div>
    <div class="row sub"><span>${qty} x ${money(price)}</span><span>${money(qty * price)}</span></div>`).join("")}
    <hr>
    <div class="row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
    <div class="row"><span>Sales tax 16%</span><span>${money(tax)}</span></div>
    <div class="row big"><span>TOTAL PKR</span><span>${money(subtotal + tax)}</span></div>
    <hr>
    <div class="c bold">Rate your meal</div>
    <div class="qr">${qrSvg}</div>
    <div class="c">Scan within 3 hours (until ${esc(time(expires))})</div>
    <div class="c">Thank you for dining with us</div>
  </section>`);
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Test receipts</title>
<style>
  /* Thermal printers turn grey into faint dots, so everything is pure black, bold and
     in a heavy sans-serif font. Thin fonts like Courier New print almost invisibly. */
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; background: #fff; font: 700 14px/1.4 Arial, Helvetica, sans-serif; }
  .receipt { width: 72mm; margin: 0 auto; padding: 4mm 1mm 10mm; page-break-after: always; break-after: page; }
  .receipt:last-child { page-break-after: auto; break-after: auto; }
  .c { text-align: center; }
  .big { font-size: 18px; font-weight: 900; }
  .bold { font-weight: 900; font-size: 16px; }
  .row { display: flex; justify-content: space-between; gap: 4mm; }
  .row.sub { padding-left: 3mm; }
  .item { font-weight: 900; font-size: 15px; margin-top: 2mm; }
  hr { border: 0; border-top: 2px dashed #000; margin: 3mm 0; }
  .qr { width: 58mm; margin: 2mm auto; }
  .qr svg { width: 100%; height: auto; display: block; shape-rendering: crispEdges; }
  @media screen { body { background: #eee; } .receipt { background: #fff; margin: 12px auto; padding: 4mm; width: calc(72mm + 8mm); } }
</style></head>
<body>${receipts.join("\n")}</body></html>`;

writeFileSync("test-receipts.html", html);
console.log(`Wrote test-receipts.html with ${ORDERS.length} receipts.`);
console.log(`QR links open ${appUrl} and work until ${time(expires)}.`);
