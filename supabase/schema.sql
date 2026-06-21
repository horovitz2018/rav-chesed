-- ═══════════════════════════════════════════════════════════════
--  רב חסד — סכמת בסיס הנתונים
--  הרץ קובץ זה ב-Supabase: SQL Editor → New query → הדבק → Run
-- ═══════════════════════════════════════════════════════════════

-- מתרימים
create table if not exists fundraisers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text,
  phone       text,
  target      numeric default 0,
  created_at  timestamptz default now()
);

-- תורמים
create table if not exists donors (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  email                   text,
  phone                   text,
  city                    text,
  total_donated           numeric default 0,
  assigned_fundraiser_id  uuid references fundraisers(id) on delete set null,
  created_at              timestamptz default now()
);

-- מגביות / קמפיינים
create table if not exists campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  target      numeric default 0,
  raised      numeric default 0,
  category    text,
  created_at  timestamptz default now()
);

-- נתמכים / משפחות
create table if not exists recipients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  family_size     int default 1,
  priority_score  int default 50,
  status          text default 'פעיל',
  address         text,
  created_at      timestamptz default now()
);

-- בקשות תמיכה
create table if not exists requests (
  id                uuid primary key default gen_random_uuid(),
  recipient_id      uuid references recipients(id) on delete cascade,
  amount_requested  numeric default 0,
  amount_approved   numeric default 0,
  priority          text,
  category          text,
  status            text default 'בהמתנה',
  paid_date         date,
  created_at        timestamptz default now()
);

-- הוצאות
create table if not exists expenses (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  amount      numeric default 0,
  category    text,
  date        date default current_date,
  campaign_id uuid references campaigns(id) on delete set null,
  created_at  timestamptz default now()
);

-- תרומות
create table if not exists donations (
  id          uuid primary key default gen_random_uuid(),
  donor_id    uuid references donors(id) on delete set null,
  amount      numeric default 0,
  campaign_id uuid references campaigns(id) on delete set null,
  source      text,
  date        date default current_date,
  status      text default 'הושלם',
  stripe_id   text,
  created_at  timestamptz default now()
);

-- אינדקסים לשליפות מהירות
create index if not exists idx_donations_donor    on donations(donor_id);
create index if not exists idx_donations_campaign on donations(campaign_id);
create index if not exists idx_donations_date      on donations(date);
create index if not exists idx_requests_recipient  on requests(recipient_id);
create index if not exists idx_donors_fundraiser   on donors(assigned_fundraiser_id);

-- ═══════════════════════════════════════════════════════════════
--  אבטחה (RLS)
--  בשלב זה (משתמש יחיד, לפני התחברות) מאפשרים גישה מלאה.
--  בשלב ההתחברות נחליף למדיניות לפי תפקיד ומשתמש מאומת.
-- ═══════════════════════════════════════════════════════════════
alter table fundraisers enable row level security;
alter table donors      enable row level security;
alter table campaigns   enable row level security;
alter table recipients  enable row level security;
alter table requests    enable row level security;
alter table expenses    enable row level security;
alter table donations   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['fundraisers','donors','campaigns','recipients','requests','expenses','donations']
  loop
    execute format('drop policy if exists "allow_all_%1$s" on %1$s;', t);
    execute format('create policy "allow_all_%1$s" on %1$s for all using (true) with check (true);', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════
--  נתוני התחלה (Seed) — מתרים ומגביות ראשוניות
-- ═══════════════════════════════════════════════════════════════
insert into fundraisers (name, email, phone, target)
  select 'מתרים ראשי', 'main@rav-chesed.org', '050-0000000', 200000
  where not exists (select 1 from fundraisers);

insert into campaigns (name, target, raised, category)
  select 'קרן חסד כללית', 300000, 0, 'כללי'
  where not exists (select 1 from campaigns);
