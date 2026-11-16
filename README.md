# Table Feedback

Guest feedback app for restaurants. Guests scan the QR code on their bill, rate their dishes and visit, and submit once per bill.

It runs on its own Supabase project with one table. It has no connection to Resto's database. Resto pulls matching rows once a day through an API, and a cleanup job then empties the table.

## Architecture

```
Guest phone ──QR──▶ Static app (Vite + React)
                       │
                       ▼
            Supabase Edge Functions (only writers/readers)
              ├─ session         verify QR signature, 30-min window, limits
              ├─ read-bill       photo → dish names (OCR via Claude)
              ├─ submit-feedback validate, enforce one-per-bill, device + IP limits, insert
              ├─ export-feedback Resto pulls rows that match its own orders
              └─ cleanup-feedback deletes rows up to the pull cutoff
                       │
                       ▼
            feedback_submissions  (the only table, RLS on, no public access)
```

## Rules enforced server-side

| Rule | Where |
|---|---|
| QR is signed (HMAC-SHA256). Tenant and order cannot be forged | `_shared/common.ts` `verifyQr` |
| 30 minutes from print time, read from the signed payload | `windowState` |
| One feedback per tenant + order | unique constraint + pre-check |
| Two submissions per device per day | `DEVICE_DAILY_LIMIT`, device id is hashed |
| 20 submissions per network per hour (generous for shared Wi-Fi) | `IP_HOURLY_LIMIT`, IP is hashed |
| Resto receives only rows whose tenant, order and every confirmed dish match its order | `export-feedback` |
| Daily cleanup removes only rows the pull has already seen | `cleanup-feedback` with cutoff |

Raw device ids and IPs are never stored, only keyed hashes.

## QR format

`https://<app-domain>/?qr=<payload>.<signature>`

- `payload` = base64url of `{"t": tenantId, "o": orderId, "p": printUnixSeconds}`
- `signature` = base64url of HMAC-SHA256(`QR_SIGNING_KEY`, payload)

Resto prints this on the receipt. For testing:

```bash
QR_SIGNING_KEY=... npm run sign-qr -- tenant-1 order-100 2026-11-01T10:00:00Z https://localhost:5173
```

## Setup

1. **Create the Supabase project** (a new project, separate from Resto).
2. **Run the migration** `supabase/migrations/0001_feedback_submissions.sql`.
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
4. **Deploy functions:** `supabase functions deploy session read-bill submit-feedback export-feedback cleanup-feedback --no-verify-jwt`
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
