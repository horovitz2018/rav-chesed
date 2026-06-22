-- ═══════════════════════════════════════════════════════════════
--  רב חסד — הסתרה מלאה של מפתחות Stripe
--  מעביר את המפתחות לטבלה נפרדת שאיש (חוץ מהשרת) לא יכול לקרוא.
--  הרץ ב-Supabase: SQL Editor → New query → הדבק → Run
-- ═══════════════════════════════════════════════════════════════

create table if not exists app_secrets (
  id                      uuid primary key default gen_random_uuid(),
  stripe_secret_key       text,
  stripe_webhook_secret   text,
  stripe_publishable_key  text,
  updated_at              timestamptz default now()
);

-- שורת סודות יחידה
insert into app_secrets (stripe_secret_key)
  select null where not exists (select 1 from app_secrets);

-- העברת מפתחות קיימים מ-app_settings (אם קיימים) — חד-פעמי, מוגן
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'app_settings' and column_name = 'stripe_secret_key') then
    update app_secrets s set
      stripe_secret_key      = a.stripe_secret_key,
      stripe_webhook_secret  = a.stripe_webhook_secret,
      stripe_publishable_key = a.stripe_publishable_key
    from (select * from app_settings limit 1) a;
  end if;
end $$;

-- הסרת המפתחות מ-app_settings (שם הם היו קריאים למשתמש מחובר)
alter table app_settings drop column if exists stripe_secret_key;
alter table app_settings drop column if exists stripe_webhook_secret;
alter table app_settings drop column if exists stripe_publishable_key;

-- ❗ RLS ללא שום מדיניות = אף אחד לא קורא/כותב מהדפדפן.
--    רק service_role (הפונקציות) ניגש, כי הוא עוקף RLS.
alter table app_secrets enable row level security;
