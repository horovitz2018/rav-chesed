-- ═══════════════════════════════════════════════════════════════
--  רב חסד — טבלת הגדרות ארגון (כולל חיבור Stripe מתוך האתר)
--  הרץ ב-Supabase: SQL Editor → New query → הדבק → Run
-- ═══════════════════════════════════════════════════════════════

create table if not exists app_settings (
  id                      uuid primary key default gen_random_uuid(),
  org_name                text default 'רב חסד',
  stripe_secret_key       text,   -- מפתח סודי של ה-Stripe של הארגון
  stripe_webhook_secret   text,   -- סוד החתימה של ה-webhook
  stripe_publishable_key  text,   -- מפתח ציבורי (אופציונלי)
  stripe_enabled          boolean default false,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

-- שורת הגדרות יחידה ראשונית
insert into app_settings (org_name)
  select 'רב חסד' where not exists (select 1 from app_settings);

-- אבטחה: רק משתמש מחובר (ה-webhook ניגש עם service_role שעוקף RLS)
alter table app_settings enable row level security;
drop policy if exists "auth_all_app_settings" on app_settings;
create policy "auth_all_app_settings" on app_settings for all to authenticated using (true) with check (true);
