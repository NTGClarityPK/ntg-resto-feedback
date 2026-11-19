# Table Feedback

Guest feedback app for restaurants. Guests scan the QR code on their bill, rate their dishes and visit, and submit once per bill. The QR carries the whole receipt, signed by Resto, so guests never photograph the bill.

It runs on its own Supabase project with one table. It has no connection to Resto's database. Resto pulls matching rows once a day through an API, and a cleanup job then empties the table.

## Architecture

```
Guest phone ──QR──▶ Static app (Vite + React)
                       │
                       ▼
            Supabase Edge Functions (only writers/readers)
              ├─ session         verify QR signature, 24-hour window, limits; returns the receipt
              ├─ submit-feedback validate, enforce one-per-bill, device + IP limits, insert
              ├─ draft-review    optional Google review draft from the guest's answers (Claude Haiku)
              ├─ export-feedback Resto pulls rows that match its own orders
              └─ cleanup-feedback deletes rows up to the pull cutoff
                       │
                       ▼
            feedback_submissions  (the only table, RLS on, no public access)
```

## Rules enforced server-side

| Rule | Where |
|---|---|
| QR is signed (HMAC-SHA256). Tenant, order and receipt contents cannot be forged or edited | `_shared/qr.ts` `verifyQrToken` |
| At most 10 items in a QR; longer bills carry the 10 most expensive dishes (by unit price) and the rest aren't rated | `MAX_RECEIPT_ITEMS` |
| With a full-receipt QR, guests can only rate dishes that are on that receipt | `submit-feedback` |
| 24 hours from print time, read from the signed payload | `windowState` |
| One feedback per tenant + order | unique constraint + pre-check |
| Two submissions per device per day | `DEVICE_DAILY_LIMIT`, device id is hashed |
| 20 submissions per network per hour (generous for shared Wi-Fi) | `IP_HOURLY_LIMIT`, IP is hashed |
| Resto receives only rows whose tenant, order and every confirmed dish match its order | `export-feedback` |
| Daily cleanup removes only rows the pull has already seen | `cleanup-feedback` with cutoff |

Raw device ids and IPs are never stored, only keyed hashes.

## QR format

Resto prints this QR on every receipt. The link puts the token after `#`, so browsers never send it (or the receipt contents) to the web host.

`https://<app-domain>/#qr=2.<payload>.<signature>`

1. Build the receipt as compact JSON:

   ```jsonc
   {
     "v": 2,
     "t": "tenant-1",              // tenant id (required)
     "o": "ORD-2026-000123",       // order id (required)
     "p": 1794824872,              // receipt print time, unix seconds (required; starts the 24-hour window)
     "r": "Karachi Grill",         // restaurant name (required): shown at the top of the feedback app
     "tb": "T-03",                 // table
     "sv": "Ali",                  // server
     "cur": "PKR",
     "it": [["Chicken Karahi (Half)", 1, 1450], ["Garlic Naan", 2, 120]],  // [name, quantity, unit price]
     "st": 1690, "tx": 270, "sc": 0, "dc": 0, "tot": 1960, // subtotal, tax, service charge, discount, total
     "g": "ChIJN1t_tDeuEmsRUsoyG83frY4"  // optional: the restaurant's Google Place ID or Google review link
   }
   ```

   Bills with **more than 10 items**: put only the **10 most expensive dishes** (highest unit price; ties broken by quantity × price) in `it`. The other dishes are left out and aren't rated; there is no photo step. The QR stays easy to scan.
2. `payload` = base64url (no padding) of the **raw DEFLATE** compression of that JSON (zlib `deflateRaw`, level 9).
3. `signature` = base64url of HMAC-SHA256(`QR_SIGNING_KEY`, `"2." + payload`).

Item names are what guests rate and what `export-feedback` matches against Resto's orders, so use the names exactly as Resto stores them. A 10-item receipt makes a QR of about 77×77 squares. Print it about 58mm wide, in its own section below the SRB tax QR with a clear heading and at least 25mm of space between the two codes: smaller sizes (32–36mm) were hard to scan on real thermal prints. Building and signing it takes a few milliseconds.

**Share it on Google (optional).** When the QR has `g`, the thank-you screen ends with an optional card: a review drafted from the guest's answers (`draft-review` function, Claude Haiku), which the guest can edit, then **Copy & open Google**. Google doesn't let any site post or pre-fill a review, so the guest pastes it and taps Post from their own account. `g` can be a Place ID (shortest, keeps the QR small) or an https link on a Google host (`search.google.com`, `g.page`, `maps.app.goo.gl`, ...); anything else is ignored. Without `g` the card is not shown. Offer it to every guest, whatever their rating: Google's rules forbid asking only happy guests for reviews.

The older order-only format (`?qr=<payload>.<signature>`, payload = base64url of `{"t","o","p"}`, signed over the payload) is still accepted; the guest then rates only the visit, with no dishes.

For testing, `npm run receipts` prints test receipts with full-receipt QRs (see `scripts/print-receipts.mjs`):

```bash
QR_SIGNING_KEY=... npm run receipts -- https://resto-feedback.netlify.app
```

## Setup

1. **Create the Supabase project** (a new project, separate from Resto).
2. **Run the migrations** in `supabase/migrations/`, in order (`0001_feedback_submissions.sql`, then `0002_receipt_column.sql`).
3. **Set function secrets:**
   ```bash
   supabase secrets set \
     SUPABASE_URL=... \
     SUPABASE_SERVICE_ROLE_KEY=... \
     QR_SIGNING_KEY=... \
     HASH_SECRET=$(openssl rand -hex 32) \
     ANTHROPIC_API_KEY=... \
     RESTO_PULL_KEY=$(openssl rand -hex 32) \
     CLEANUP_KEY=$(openssl rand -hex 32)
   ```
   The SUPABASE_* values are provided automatically to deployed functions, so only set them if your CLI requires it.
4. **Deploy functions:** `supabase functions deploy session submit-feedback draft-review export-feedback cleanup-feedback --no-verify-jwt`
   (The functions check their own keys. `--no-verify-jwt` is needed so the guest app can call them anonymously.)
5. **Frontend:** copy `.env.example` to `.env`, set `VITE_FUNCTIONS_URL` and `VITE_SUPABASE_ANON_KEY`, then `npm install && npm run build`. Host the `dist/` folder on Netlify or Cloudflare Pages.

## Daily job (Resto side)

1. Resto calls `POST {functions}/export-feedback` with header `x-resto-key` and body `{ tenantId, orders: [{ orderId, dishes: [...] }] }` for the day's orders. It gets back matched feedback and a `cutoff`.
2. Resto writes the matched rows into its own database.
3. Resto (or a scheduler) calls `POST {functions}/cleanup-feedback` with header `x-cleanup-key` and body `{ cutoff }`.

Run step 3 only after step 2 succeeds.

## Decisions to confirm

- **Dish matching rule:** every guest-confirmed dish must appear on Resto's order (names compared case-insensitively, ignoring punctuation). Tell me if you want "at least one dish matches" instead.
- **Daily limit window:** rolling 24 hours, not midnight. Tell me if you want a calendar day.
- **Cleanup timing:** rows created after the pull are kept until the next run.
