-- TESTING: allow more than one feedback per bill.
-- Before going live, delete duplicate rows and restore the rule:
--   alter table public.feedback_submissions
--     add constraint feedback_one_per_order unique (tenant_id, order_id);
--   drop index if exists feedback_submissions_order_idx;
alter table public.feedback_submissions drop constraint if exists feedback_one_per_order;
create index if not exists feedback_submissions_order_idx
  on public.feedback_submissions (tenant_id, order_id);
