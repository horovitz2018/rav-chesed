-- ═══════════════════════════════════════════════════════════════
--  רב חסד — אידמפוטנטיות לתרומות Stripe
--  מבטיח שאותו תשלום לא יירשם פעמיים (גם אם ה-webhook נשלח שוב).
--  הרץ ב-Supabase: SQL Editor → New query → הדבק → Run
-- ═══════════════════════════════════════════════════════════════

alter table donations add column if not exists stripe_checkout_session_id text;

-- אינדקס ייחודי חלקי — מונע כפילות לפי מזהה ה-Checkout Session.
-- (חל רק על ערכים שאינם NULL — תרומות ידניות/בנק לא מושפעות.)
create unique index if not exists uniq_donations_checkout_session
  on donations(stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
