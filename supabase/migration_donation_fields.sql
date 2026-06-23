-- ═══════════════════════════════════════════════════════════════
--  רב חסד — שדות Stripe מורחבים לתרומות
--  הרץ ב-Supabase: SQL Editor → New query → הדבק → Run
-- ═══════════════════════════════════════════════════════════════

alter table donations add column if not exists stripe_payment_intent_id text;
alter table donations add column if not exists stripe_customer_id text;
alter table donations add column if not exists stripe_subscription_id text;
alter table donations add column if not exists currency text;
alter table donations add column if not exists donor_email text;
alter table donations add column if not exists donor_name text;
alter table donations add column if not exists paid_at timestamptz;
