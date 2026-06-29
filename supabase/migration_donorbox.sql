-- ═══════════════════════════════════════════════════════════════
--  רב חסד — תמיכה בתרומות חוזרות מ-Donorbox (דרך Stripe)
--  הרץ ב-Supabase: SQL Editor → New query → הדבק → Run
--  (רק ADD COLUMN / CREATE INDEX — אין DROP/DELETE)
-- ═══════════════════════════════════════════════════════════════

-- מפתח ההו"ק של Donorbox (donorbox_form_id) — מזהה תוכנית תרומה חוזרת
alter table pledges add column if not exists donorbox_form_id text;

-- מונע יצירת הו"ק כפולה לאותו תורם+טופס Donorbox
create unique index if not exists uniq_pledges_donor_donorbox_form
  on pledges(donor_id, donorbox_form_id)
  where donorbox_form_id is not null;

-- אינדקס ייחודי חלקי על payment_intent — מניעת כפילות תרומות (charges בודדים, לא checkout)
create unique index if not exists uniq_donations_payment_intent
  on donations(stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
