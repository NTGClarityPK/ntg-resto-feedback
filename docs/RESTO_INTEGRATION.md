# Table Feedback: integration note for Resto developers

Guests scan a QR code on their receipt, rate their dishes and visit in about a minute, and can optionally post a Google review. Everything the feedback app needs is inside that signed QR code, so Resto doesn't need to run any service for guests. Resto has five jobs:

1. A setting to turn the feature on or off.
2. A Google lookup that saves each branch's Place ID.
3. A signed QR code on every receipt.
4. The feedback section printed on the receipt.
5. A daily job that pulls feedback into Resto.

---

## 1. Settings: turn the feature on or off

- Add **"Guest feedback QR" (on/off)** per branch. The default is **off**.
- **Off:** print the receipt exactly as today, with no feedback section.
- **On:** show the Google fields from section 2 and print the feedback section from section 4.

## 2. Google Place ID (one-time setup per branch)

The Place ID tells the app which Google listing to open when a guest chooses "Post review on Google".

**Fields in settings:**

| Field | Required | Example |
|---|---|---|
| Restaurant name | Yes | Khansaab |
| Area / street | Recommended | DHA Phase 6 |
| City | Yes | Karachi |
| Country | Yes | Pakistan |

Restaurants with several branches need the area, or the search can return the wrong branch.

**On Save**, call Google Places API (New) **from the Resto server**. Never call it from POS terminals, because the key must not leave the server.

```http
POST https://places.googleapis.com/v1/places:searchText
X-Goog-Api-Key: <GOOGLE_MAPS_API_KEY>
X-Goog-FieldMask: places.id,places.displayName,places.formattedAddress
Content-Type: application/json

{ "textQuery": "Khansaab, DHA Phase 6, Karachi, Pakistan" }
```

- **One result:** show *"Khansaab, Khayaban-e-Ittehad, DHA Phase 6, Karachi. Is this your restaurant? [Yes] [No]"*.
- **Several results:** list them with their addresses and let the user pick one.
- **No result:** show *"We couldn't find your restaurant on Google. Please contact support."*
- **On confirm:** save `places[].id` (it looks like `ChIJ...`) on the branch. Show "Linked to Google: <name, address>" and offer a **Change** button.

**Notes:**
- **Manual entry for support:** add a field where support can paste a Place ID or a Google review link (`https://g.page/r/.../review`). The app accepts both.
- **Cost:** this is one search per branch. Asking for the address puts it in Google's paid tier, but at this volume it stays inside the free monthly allowance. Check Google's current pricing before launch.
- **No Place ID:** the feature still works without one. Leave out `g` and the app simply doesn't offer the Google review button.

## 3. The signed QR code

Print this link as a QR code on every receipt while the feature is on:

```
https://resto-feedback.netlify.app/#qr=2.<payload>.<signature>
```

### 3a. Build the receipt JSON

```jsonc
{
  "v": 2,
  "t": "khansaab-dha6",          // branch ID (required): stable and unique per BRANCH
  "o": "MAIN-20261118-0004",     // order ID (required): the same value Resto uses in the daily pull
  "p": 1794824872,               // print time, Unix seconds (required)
  "r": "Khansaab",               // restaurant name shown in the app (required), max 80 chars
  "tb": "4",                     // table, max 20 chars
  "sv": "SARA",                  // order taker, max 40 chars
  "cur": "PKR",
  "it": [["Beef Biryani", 2, 850], ["Shami Kabab", 4, 140]],  // [name, qty, unit price], max 10
  "st": 3140, "tx": 251, "sc": 0, "dc": 0, "tot": 3391,       // subtotal, tax, service, discount, total
  "g": "ChIJxxxxxxxxxxxxxxxxxxxxxxx"                          // Google Place ID (omit if none)
}
```

**Rules:**
- **At most 10 items in `it`.** If the bill has more, include only the **10 with the highest unit price** and leave the rest out. Guests don't rate the dishes that are left out.
- **Item names must match Resto's names exactly.** The daily pull matches feedback to orders by these names.
- **`t` must be unique per branch, not per company**, because each branch has its own Google listing and its own feedback.
- **Leave out empty optional fields** rather than sending `""` or `null`, to keep the QR small.

### 3b. Encode and sign it

```
json      = UTF-8 JSON of the object above (no extra whitespace)
payload   = base64url_no_padding( raw_deflate(json, level 9) )
signature = base64url_no_padding( HMAC_SHA256(key = QR_SIGNING_KEY, data = "2." + payload) )
token     = "2." + payload + "." + signature
```

- **Raw deflate** means no zlib or gzip header. In .NET, `DeflateStream` with `CompressionLevel.SmallestSize` is already raw. In Java, use `new Deflater(9, true)`. In Node, use `zlib.deflateRawSync(json, { level: 9 })`.
- **base64url** means `+`→`-`, `/`→`_`, with the `=` padding removed.
- **Speed:** signing takes a few milliseconds, so receipt printing isn't slowed down.
- **Reference implementation:** `signedLink()` in [`scripts/print-receipts.mjs`](../scripts/print-receipts.mjs).

### 3c. QR settings

| Setting | Value |
|---|---|
| Error correction | L |
| Quiet zone (margin) | 3 modules |
| Printed size | The QR inside the frame is about **53 mm** wide. Don't go below about 45 mm: codes of 32–36 mm didn't scan reliably on thermal paper. |

## 4. Receipt layout

Use the layout of the sample receipts: run `npm run receipts`, which writes `test-receipts.html` (source in [`scripts/print-receipts.mjs`](../scripts/print-receipts.mjs)), or see the receipt images we shared. From top to bottom:

1. **Existing receipt and SRB tax QR:** unchanged.
2. **Dashed line**, with at least **10 mm of space** below the SRB section, so a phone doesn't pick up both codes.
3. **`RATE YOUR MEAL`**: bold, about 20 px.
4. **`It just takes a minute!`**
5. **Feedback QR inside the "handi" (cooking pot) frame**, about 72 mm wide. The SVG is `FRAMES.handi` in `scripts/print-receipts.mjs`.
6. **Dashed line**, then the existing footer.

Print it in solid black (no grey or dithering) so the QR stays sharp.

## 5. Daily job: pull feedback into Resto

The functions URL is `https://dajcwgcmcvkgkuqjrrgj.supabase.co/functions/v1`.

1. **Pull.** For each branch, once a day, from the Resto server:
   ```http
   POST {functions}/export-feedback
   x-resto-key: <RESTO_PULL_KEY>
   Content-Type: application/json

   { "tenantId": "khansaab-dha6", "orders": [ { "orderId": "MAIN-20261118-0004", "dishes": ["Beef Biryani", "Shami Kabab"] } ] }
   ```
   The response is `{ tenantId, cutoff, feedback: [{ orderId, dishRatings, categoryRatings, review, createdAt }] }`. Feedback is returned only when the branch, the order and every rated dish match.
2. **Save.** Write the feedback into Resto's database.
3. **Clean up.** Only after step 2 succeeds:
   ```http
   POST {functions}/cleanup-feedback
   x-cleanup-key: <CLEANUP_KEY>

   { "cutoff": "<cutoff from step 1>" }
   ```
   This deletes the feedback that was just pulled, so it isn't kept on our side.

## 6. Before going live: test checklist

- [ ] Feature off → receipt is unchanged. Feature on → feedback section prints as in section 4.
- [ ] The QR opens with the iPhone camera, the Android camera and Google Lens, and shows the right restaurant name and dishes.
- [ ] A bill with more than 10 dishes shows only the 10 highest-priced dishes.
- [ ] A branch with a Place ID shows "Post review on Google", and it opens that branch's Google page. A branch without one doesn't show the button.
- [ ] The daily pull returns that day's feedback, and cleanup succeeds afterwards.
- [ ] The QR scans on a real printed receipt from every printer model in use. Check thermal printers with low ink too.

---

## Secrets

Share these privately, outside the codebase and out of chat. Keep them on the **Resto server** only.

| Secret | Used for | Where Resto uses it |
|---|---|---|
| `QR_SIGNING_KEY` | Signing the receipt QR | Wherever receipts are built. Signing on the Resto server is safest; if terminals sign offline, store it encrypted. |
| `RESTO_PULL_KEY` | Daily feedback pull | Server job (`x-resto-key` header) |
| `CLEANUP_KEY` | Daily cleanup | Server job (`x-cleanup-key` header) |
| `GOOGLE_MAPS_API_KEY` | Place ID lookup in settings | Resto server only. Limit it to "Places API (New)". |

**Never share:** `HASH_SECRET`, `ANTHROPIC_API_KEY` or the Supabase service-role key. They stay in Supabase.

If `QR_SIGNING_KEY` leaks, change it in Supabase and in Resto at the same time. Receipts already printed then stop working.
