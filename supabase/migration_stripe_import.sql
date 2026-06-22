-- ═══════════════════════════════════════════════════════════════
--  רב חסד — יבוא נתונים מ-Stripe
--  הרץ ב-Supabase: SQL Editor → New query → הדבק → Run
-- ═══════════════════════════════════════════════════════════════

-- קישור תורם ללקוח ב-Stripe (למניעת כפילויות ביבוא)
alter table donors add column if not exists stripe_customer_id text;
create index if not exists idx_donors_stripe_customer on donors(stripe_customer_id);

-- פונקציה לחישוב מחדש של סכומים מצטברים (נקרא בסוף היבוא)
create or replace function recompute_totals() returns void
language sql security definer as $$
  update donors d set total_donated = coalesce((select sum(amount) from donations where donor_id = d.id), 0);
  update campaigns c set raised = coalesce((select sum(amount) from donations where campaign_id = c.id), 0);
$$;
