-- ═══════════════════════════════════════════════════════════════
--  רב חסד — קבוצות תורמים + מיקוד מגביות
--  הרץ ב-Supabase: SQL Editor → New query → הדבק → Run
--  (רק ADD COLUMN / CREATE INDEX / CHECK — אין DROP/DELETE)
-- ═══════════════════════════════════════════════════════════════

-- שיוך קבוצתי לתורם: קבוצה ראשית (לדוגמה "אנ"ש") ותת-קבוצה (לדוגמה בית כנסת)
alter table donors add column if not exists group_name    text;
alter table donors add column if not exists subgroup_name text;

-- מיקוד מגבית: 'general' (כללית) או 'group' (לפי קבוצה)
alter table campaigns add column if not exists audience_type     text not null default 'general';
alter table campaigns add column if not exists audience_group    text;
alter table campaigns add column if not exists audience_subgroup text;

-- אילוץ ערכים חוקיים לסוג הקהל
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'campaigns_audience_type_chk') then
    alter table campaigns add constraint campaigns_audience_type_chk
      check (audience_type in ('general', 'group'));
  end if;
end $$;

-- אינדקסים
create index if not exists idx_donors_groups
  on donors(group_name, subgroup_name);
create index if not exists idx_campaigns_audience
  on campaigns(audience_type, audience_group, audience_subgroup);
