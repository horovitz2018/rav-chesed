-- ═══════════════════════════════════════════════════════════════
--  רב חסד — נעילת הנתונים מאחורי התחברות (RLS)
--  מחליף את מדיניות "גישה לכולם" במדיניות "רק משתמש מחובר".
--  הרץ ב-Supabase: SQL Editor → New query → הדבק → Run
--
--  ⚠️ הרץ זאת רק *אחרי* שהוספת משתמש מורשה ב-Authentication → Users,
--     אחרת לא תוכל לגשת לנתונים (כי תידרש התחברות).
--  הערה: ה-webhook של Stripe משתמש ב-service_role ולכן ימשיך לעבוד.
-- ═══════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array['fundraisers','donors','campaigns','recipients','requests','expenses','donations','pledges']
  loop
    execute format('drop policy if exists "allow_all_%1$s" on %1$s;', t);
    execute format('drop policy if exists "auth_all_%1$s" on %1$s;', t);
    execute format('create policy "auth_all_%1$s" on %1$s for all to authenticated using (true) with check (true);', t);
  end loop;
end $$;
