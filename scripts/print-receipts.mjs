// Builds test receipts for an 80mm thermal printer in the layout of Resto's own receipt: a sample
// SRB QR in its usual place, and below it, in its own section, a freshly signed v2 feedback QR code
// that carries the whole receipt (see supabase/functions/_shared/qr.ts for the format).
// Usage (PowerShell):
//   $env:QR_SIGNING_KEY = '<same value as the Supabase secret>'
//   npm run receipts -- https://resto-feedback.netlify.app       -> 3 receipts for the live site
//   npm run receipts                                             -> this PC's Wi-Fi address, port 5173
//   npm run receipts -- https://resto-feedback.netlify.app --long -> adds a 15-item bill, whose QR
//                                                                    leaves the items out (photo step)
// Then open test-receipts.html in Chrome, press Ctrl+P and pick the thermal printer.
// Each QR works for 3 hours from the moment this script runs, and each one can be used once.
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { deflateRawSync } from "node:zlib";
import QRCode from "qrcode";

const TENANT_ID = "tenant-test";
const RESTAURANT = "Restoooooo";   // same test restaurant name as Resto's sample receipt
const CURRENCY = "PKR";
const TAX_RATE = 0.08;             // FBR @ 8% on card payments, as on Resto's receipt
const MAX_QR_ITEMS = 10;           // must match MAX_RECEIPT_ITEMS on the server

// Seed orders, in PKR. Item names are printed exactly like this and are what guests rate.
const ORDERS = [
  { table: "1", people: 2, taker: "ASIF", items: [["Chicken Karahi (Half)", 1, 1450], ["Garlic Naan", 2, 120], ["Mint Raita", 1, 180], ["Mineral Water 1.5L", 1, 150]] },
  { table: "4", people: 4, taker: "SARA", items: [["Beef Biryani", 2, 850], ["Shami Kabab", 4, 140], ["Kheer", 2, 320], ["Pepsi 345ml", 2, 120]] },
  { table: "7", people: 3, taker: "AHMED", items: [["Mutton Nihari", 1, 1250], ["Khamiri Roti", 3, 60], ["Chicken Tikka", 1, 780]] },
];
const LONG_MENU = ["Chicken Karahi (Full)", "Mutton Karahi (Full)", "Beef Biryani", "Chicken Biryani", "Mutton Pulao", "Seekh Kabab", "Chapli Kabab", "Shami Kabab", "Chicken Tikka", "Malai Boti", "Fish Tikka", "Prawn Masala", "Daal Makhni", "Palak Paneer", "Chana Masala", "Aloo Gobi", "Haleem", "Nihari", "Garlic Naan", "Butter Naan", "Roghni Naan", "Tandoori Roti", "Mint Raita", "Russian Salad", "Green Salad", "Kheer", "Firni", "Gulab Jamun", "Shahi Tukray", "Kashmiri Chai", "Doodh Patti", "Fresh Lime", "Mango Shake", "Pepsi 1.5L", "Mineral Water 1.5L"];
if (process.argv.includes("--long")) {
  ORDERS.push({ table: "12", people: 8, taker: "USMAN", items: LONG_MENU.slice(0, 15).map((name, i) => [name, (i % 3) + 1, 150 + i * 40]) });
}

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
const urlArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const appUrl = (urlArg || lanUrl()).replace(/\/+$/, "");

const b64url = (buf) => Buffer.from(buf).toString("base64url");

// v2 QR: the whole receipt, compressed and signed. Resto builds the same thing at print time.
// Bills longer than MAX_QR_ITEMS keep everything except the item lines ("n" gives the count),
// so the QR stays easy to scan and the guest photographs the bill instead.
function signedLink(receipt) {
  const payload = b64url(deflateRawSync(JSON.stringify(receipt), { level: 9 }));
  const sig = b64url(createHmac("sha256", key).update(`2.${payload}`).digest());
  return `${appUrl}/#qr=2.${payload}.${sig}`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const money = (n) => n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (n) => String(n).padStart(2, "0");

const now = new Date();
const printedAtSec = Math.floor(now.getTime() / 1000);
const expires = new Date((printedAtSec + 3 * 60 * 60) * 1000);
const time = (d) => d.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" });
// Resto's own formats: 22/10/2026, 10:29:22 and MAIN-20261022-0004.
const stampDate = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const ymd = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
// Order numbers include the time of day, so printing a new batch never hits "already submitted".
const runNo = `${pad(now.getHours())}${pad(now.getMinutes())}`;

const receipts = [];
const qrInfo = [];
for (const [i, order] of ORDERS.entries()) {
  const orderId = `MAIN-${ymd}-${runNo}${i + 1}`;
  const subtotal = order.items.reduce((s, [, q, p]) => s + q * p, 0);
  const tax = Math.round(subtotal * TAX_RATE);
  const totalQty = order.items.reduce((s, [, q]) => s + q, 0);
  const fits = order.items.length <= MAX_QR_ITEMS;
  const link = signedLink({
    v: 2, t: TENANT_ID, o: orderId, p: printedAtSec,
    r: RESTAURANT, tb: order.table, sv: order.taker, cur: CURRENCY,
    ...(fits ? { it: order.items } : { n: order.items.length }),
    st: subtotal, tx: tax, sc: 0, dc: 0, tot: subtotal + tax,
  });
  const feedbackQr = await QRCode.toString(link, { type: "svg", margin: 3, errorCorrectionLevel: "L" });
  // Stand-in for the SRB tax QR, so test prints have both codes in their real positions.
  // It holds only plain text, so scanning it by mistake shows a note instead of opening anything.
  const srbInvoice = `TEST${ymd.slice(2)}${runNo}${i + 1}`;
  const srbQr = await QRCode.toString(`SAMPLE SRB QR - test receipt, not a tax invoice (${srbInvoice})`, { type: "svg", margin: 3, errorCorrectionLevel: "M" });
  qrInfo.push(`${orderId}: ${order.items.length} items${fits ? "" : " (too many for the QR, photo step)"}, ${link.length} chars`);
  receipts.push(`
  <section class="receipt">
    <div class="c bigger">${esc(RESTAURANT)}</div>
    <div class="c">Header Text</div>
    <div class="c big">SALES RECEIPT</div>
    <div class="c small">TEST RECEIPT - NOT A REAL BILL</div>
    <hr>
    <div>Order #: ${esc(orderId)}</div>
    <div>Date: ${esc(stampDate(now))}</div>
    <div>Order type: dine_in</div>
    <div class="bold">Table: ${esc(order.table)}</div>
    <div>Number of People: ${order.people}</div>
    <div>Order Taker: ${esc(order.taker)}</div>
    <div>Counter: 1</div>
    <hr>
    ${order.items.map(([name, qty, price]) => `
    <div class="row item"><span>${qty}x ${esc(name)}</span><span>${money(qty * price)}</span></div>`).join("")}
    <div class="row small"><span>Total Items: ${order.items.length}</span><span>Total Qty: ${totalQty}</span></div>
    <hr>
    <div class="row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
    <div class="row"><span>Taxable sum</span><span>${money(subtotal)}</span></div>
    <div class="row"><span>FBR @ 8% card</span><span>${money(tax)}</span></div>
    <div class="row big"><span>NET AMOUNT</span><span>${money(subtotal + tax)}</span></div>
    <div class="big">Paid by CARD</div>
    <hr>
    <div class="c">SRB Invoice #</div>
    <div class="c">${esc(srbInvoice)}</div>
    <div class="qr srb">${srbQr}</div>
    <div>Print: ${esc(stampDate(now))}</div>

    <!-- Feedback QR: its own section below the SRB QR, never beside it, with a clear heading
         and a gap, so the camera frames one code at a time. -->
    <hr class="gap">
    <div class="c feedback-title">RATE YOUR MEAL</div>
    <div class="c">Scan within 3 hours (till ${esc(time(expires))})</div>
    <div class="qr feedback">${feedbackQr}</div>
    <div class="c small">Hold your phone close to this code</div>
    <hr>

    <div class="c">Footer Text</div>
    <div class="c">Terms and Conditions</div>
    <div class="c small">Resto by NTG Clarity</div>
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
  .small { font-size: 12px; }
  .big { font-size: 17px; font-weight: 900; }
  .bigger { font-size: 20px; font-weight: 900; }
  .bold { font-weight: 900; }
  .row { display: flex; justify-content: space-between; gap: 3mm; }
  .item { font-weight: 900; font-size: 15px; margin: 1.5mm 0; }
  hr { border: 0; border-top: 2px dashed #000; margin: 3mm 0; }
  /* The gap keeps the SRB QR and the feedback QR at least ~2.5cm apart, so a phone held
     over one code doesn't pick up the other. */
  hr.gap { margin-top: 10mm; }
  .feedback-title { font-size: 20px; font-weight: 900; letter-spacing: 1px; }
  .qr { margin: 2mm auto; }
  .qr svg { width: 100%; height: auto; display: block; shape-rendering: crispEdges; }
  /* SRB stand-in at about the size on Resto's receipt. The feedback QR is a little larger,
     so cameras tend to prefer it, and up to 10 items that is about 0.45mm per square. */
  .qr.srb { width: 28mm; }
  .qr.feedback { width: 36mm; }
  @media screen { body { background: #eee; } .receipt { background: #fff; margin: 12px auto; padding: 4mm; width: calc(72mm + 8mm); } }
</style></head>
<body>${receipts.join("\n")}</body></html>`;

writeFileSync("test-receipts.html", html);
console.log(`Wrote test-receipts.html with ${ORDERS.length} receipts.`);
console.log(`QR links open ${appUrl} and work until ${time(expires)}.`);
for (const line of qrInfo) console.log(`  ${line}`);
