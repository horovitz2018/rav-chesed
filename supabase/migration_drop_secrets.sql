-- ═══════════════════════════════════════════════════════════════
--  רב חסד — הסרת אחסון מפתחות מהדאטהבייס
--  מפתחות Stripe עוברים למשתני סביבה בלבד (לא נשמרים ב-DB).
--  הרץ ב-Supabase: SQL Editor → New query → הדבק → Run
-- ═══════════════════════════════════════════════════════════════

-- מחיקת טבלת הסודות (אם נוצרה)
drop table if exists app_secrets;

-- הסרת עמודות מפתחות מ-app_settings (אם נותרו)
alter table app_settings drop column if exists stripe_secret_key;
alter table app_settings drop column if exists stripe_webhook_secret;
alter table app_settings drop column if exists stripe_publishable_key;
