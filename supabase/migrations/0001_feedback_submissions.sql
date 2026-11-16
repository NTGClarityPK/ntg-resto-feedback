-- Isolated feedback database. Nothing here references Resto's tables.
-- One table only. Rows are pulled daily by Resto and then cleared by cleanup-feedback.

create table if not exists public.feedback_submissions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        text        not null,
  order_id         text        not null,
  printed_at       timestamptz not null,           -- from the signed QR payload
  ocr_text         text,                           -- raw OCR output, kept to help fuzzy matching at pull time
  dishes           jsonb       not null default '[]'::jsonb,   -- [{ "name": "Chicken Karahi" }]
  dish_ratings     jsonb       not null default '[]'::jsonb,   -- [{ "name", "rating": "good|okay|bad", "tags": [] }]
  category_ratings jsonb       not null default '{}'::jsonb,   -- { "service": "good", ... }
  review           text,
  device_hash      text        not null,           -- sha256(device id + server secret), never the raw id
  ip_hash          text        not null,           -- sha256(ip + server secret), never the raw ip
  created_at       timestamptz not null default now(),
  constraint feedback_one_per_order unique (tenant_id, order_id)
);

create index if not exists feedback_device_day_idx on public.feedback_submissions (device_hash, created_at);
create index if not exists feedback_ip_hour_idx    on public.feedback_submissions (ip_hash, created_at);

-- Lock the table down. Only edge functions (service role) can read or write it.
alter table public.feedback_submissions enable row level security;
revoke all on public.feedback_submissions from anon, authenticated;
