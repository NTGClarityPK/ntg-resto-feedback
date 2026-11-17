-- Structured receipt from a v2 QR code (restaurant, table, server, items with quantity and
-- price, totals). Null for feedback that came from an older order-only QR.
alter table public.feedback_submissions
  add column if not exists receipt jsonb;
