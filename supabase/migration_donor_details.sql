-- ═══════════════════════════════════════════════════════════════
--  רב חסד — שדות תורם מורחבים (ליבוא רשימת קהילה)
--  הרץ ב-Supabase: SQL Editor → New query → הדבק → Run
--  (רק ADD COLUMN — אין DROP/DELETE; group_name/subgroup_name כבר קיימים)
-- ═══════════════════════════════════════════════════════════════

alter table donors add column if not exists title_before text;  -- תואר לפני
alter table donors add column if not exists first_name   text;  -- שם פרטי
alter table donors add column if not exists last_name    text;  -- שם משפחה
alter table donors add column if not exists title_after  text;  -- תואר אחרי
alter table donors add column if not exists connection   text;  -- חתן / קשר
alter table donors add column if not exists address      text;  -- כתובת
