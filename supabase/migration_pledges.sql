-- ═══════════════════════════════════════════════════════════════
--  רב חסד — התחייבויות תורמים (הוראות קבע / הו"ק)
--  הרץ ב-Supabase: SQL Editor → New query → הדבק → Run
--  קובץ זה רק *מוסיף* — לא מוחק ולא משנה נתונים קיימים.
-- ═══════════════════════════════════════════════════════════════

create table if not exists pledges (
  id                      uuid primary key default gen_random_uuid(),
  donor_id                uuid references donors(id) on delete cascade,
  amount                  numeric default 0,           -- סכום לתקופה (לדוגמה 50€)
  frequency               text default 'monthly',      -- monthly בלבד בשלב זה
  billing_day             int default 1,               -- יום בחודש לחיוב הצפוי (1-28)
  start_date              date default current_date,   -- ממתי ההתחייבות בתוקף
  status                  text default 'active',       -- active | paused | cancelled
  campaign_id             uuid references campaigns(id) on delete set null,
  stripe_subscription_id  text,                        -- יתמלא כשנחבר את Stripe
  notes                   text,
  created_at              timestamptz default now()
);

-- קישור תרומה להתחייבות (תשלום של הו"ק רושם תרומה עם pledge_id)
alter table donations add column if not exists pledge_id uuid references pledges(id) on delete set null;

create index if not exists idx_pledges_donor    on pledges(donor_id);
create index if not exists idx_donations_pledge on donations(pledge_id);

-- אבטחה (RLS) — בהתאם לשאר הטבלאות בשלב זה
alter table pledges enable row level security;
drop policy if exists "allow_all_pledges" on pledges;
create policy "allow_all_pledges" on pledges for all using (true) with check (true);
