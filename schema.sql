-- HelioHandover — Database Schema
-- Run this in the Supabase SQL Editor on a fresh project to set up all
-- tables, relationships, and row-level security used by the app.

-- ═══════════════════════════════════════════════════
-- CORE TABLES
-- ═══════════════════════════════════════════════════

create table if not exists wards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  floor text,
  sort_order int default 0,
  created_at timestamptz default now()
);

create table if not exists consultants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade unique,
  full_name text,
  is_approved boolean default false,
  is_admin boolean default false,
  created_at timestamptz default now()
);

create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  age int,
  admission_date date,
  ward_id uuid references wards(id),
  department_type text default 'general_surgery',

  -- Supervision (admitted vs. consultation-only)
  supervision_type text default 'admitted', -- 'admitted' | 'consultation'
  patient_status text default 'active',     -- 'active' | 'discharged' | 'dama' | 'died'

  -- Clinical
  diagnosis text,
  history text,
  has_dm boolean default false,
  has_htn boolean default false,
  has_cardiac boolean default false,
  has_renal boolean default false,
  has_hepatic boolean default false,
  other_comorbidities text,
  surgery_status text default 'followup',   -- 'followup' | 'preop' | 'postop'
  operation text,
  postop_day int,
  nutrition_status text default 'normal_diet',
  general_condition text default 'stable',  -- 'stable' | 'borderline' | 'critical'
  case_complexity text default 'normal',

  -- Examination
  general_examination text,
  abdomen_condition text,
  bowel_condition text,
  bowel_sounds text,
  chest_condition_comment text,
  other_specialities text[],
  other_speciality_diagnosis text,

  -- Vitals
  vital_temp numeric,
  vital_bp text,
  vital_hr int,
  vital_rr int,
  vital_spo2 numeric,

  -- Labs / imaging
  labs_summary text,
  critical_labs text,
  imaging_summary text,
  critical_imaging text,

  -- Wound
  has_wound boolean default false,
  wound_condition text,
  wound_dressing_done_today boolean default false,

  -- Handover
  handover_notes text,
  tasks_next_day text,

  -- Consultation-specific fields
  consultation_cause text,
  consultation_reply text,
  consultation_admitted boolean default false,
  awaiting_investigation boolean default false,
  consultant_contacted boolean default false,
  consultant_contacted_name text,

  -- Tracking
  last_checked_at timestamptz,
  last_checked_by uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists patient_consultants (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  consultant_id uuid references consultants(id) on delete cascade
);

create table if not exists patient_tubes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  tube_type text not null,
  quantity int default 1,
  site text,
  content_quantity text,
  content_color text,
  emptied_previous_days boolean default false,
  is_removed boolean default false,
  created_at timestamptz default now()
);

create table if not exists patient_checks (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  checked_by uuid,
  checked_at timestamptz default now()
);

create table if not exists patient_vitals (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  recorded_at timestamptz default now(),
  temp numeric, bp text, hr int, rr int, spo2 numeric
);

create table if not exists patient_labs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  recorded_at timestamptz default now(),
  summary text, critical_values text
);

create table if not exists patient_imaging (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  recorded_at timestamptz default now(),
  summary text, critical_findings text
);

-- Photo attachments (Labs / Imaging)
create table if not exists patient_attachments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  category text not null check (category in ('labs','imaging')),
  file_path text not null,
  uploaded_by uuid,
  uploaded_by_name text,
  created_at timestamptz default now()
);

-- Audit log — powers the Case Progress timeline
create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  action text not null, -- 'INSERT' | 'UPDATE' | 'DELETE'
  changed_by uuid,
  changed_by_name text,
  old_data jsonb,
  new_data jsonb,
  changed_at timestamptz default now()
);

-- ═══════════════════════════════════════════════════
-- STORAGE BUCKET (Labs / Imaging photos)
-- ═══════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('patient-attachments', 'patient-attachments', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

-- ═══════════════════════════════════════════════════
-- HELPER FUNCTIONS
-- ═══════════════════════════════════════════════════

create or replace function public.is_approved_user()
returns boolean language sql security definer stable as $$
  select coalesce(
    (select is_approved from user_profiles where user_id = auth.uid()),
    false
  );
$$;

create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select coalesce(
    (select is_admin from user_profiles where user_id = auth.uid()),
    false
  );
$$;

-- Auto-create a user_profiles row on signup (starts unapproved)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.user_profiles (user_id, full_name, is_approved)
  values (new.id, new.raw_user_meta_data->>'full_name', false);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_patients_updated_at on patients;
create trigger set_patients_updated_at
  before update on patients
  for each row execute function public.update_updated_at();

-- Logs every INSERT/UPDATE on patients into audit_logs, powering Case Progress
create or replace function public.log_patient_changes()
returns trigger language plpgsql security definer as $$
declare
  changer_name text;
begin
  select full_name into changer_name from user_profiles where user_id = auth.uid();
  if (tg_op = 'INSERT') then
    insert into audit_logs (table_name, record_id, action, changed_by, changed_by_name, old_data, new_data)
    values ('patients', new.id, 'INSERT', auth.uid(), changer_name, null, to_jsonb(new));
    return new;
  elsif (tg_op = 'UPDATE') then
    insert into audit_logs (table_name, record_id, action, changed_by, changed_by_name, old_data, new_data)
    values ('patients', new.id, 'UPDATE', auth.uid(), changer_name, to_jsonb(old), to_jsonb(new));
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists patients_audit_trigger on patients;
create trigger patients_audit_trigger
  after insert or update on patients
  for each row execute function public.log_patient_changes();

-- ═══════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════

alter table wards enable row level security;
alter table consultants enable row level security;
alter table user_profiles enable row level security;
alter table patients enable row level security;
alter table patient_consultants enable row level security;
alter table patient_tubes enable row level security;
alter table patient_checks enable row level security;
alter table patient_vitals enable row level security;
alter table patient_labs enable row level security;
alter table patient_imaging enable row level security;
alter table patient_attachments enable row level security;
alter table audit_logs enable row level security;

-- Reference tables: any approved user can read; only admins write
create policy "approved_read_wards" on wards for select using (public.is_approved_user());
create policy "admin_write_wards" on wards for all using (public.is_admin()) with check (public.is_admin());

create policy "approved_read_consultants" on consultants for select using (public.is_approved_user());
create policy "admin_write_consultants" on consultants for all using (public.is_admin()) with check (public.is_admin());

-- Users can see their own profile; admins can see and approve everyone
create policy "own_profile" on user_profiles for select using (user_id = auth.uid());
create policy "admin_read_all_profiles" on user_profiles for select using (public.is_admin());
create policy "admin_update_profiles" on user_profiles for update using (public.is_admin());

-- Clinical data: any approved user can read/write (shared team workflow)
create policy "approved_all_patients" on patients for all using (public.is_approved_user()) with check (public.is_approved_user());
create policy "approved_all_patient_consultants" on patient_consultants for all using (public.is_approved_user()) with check (public.is_approved_user());
create policy "approved_all_patient_tubes" on patient_tubes for all using (public.is_approved_user()) with check (public.is_approved_user());
create policy "approved_all_patient_checks" on patient_checks for all using (public.is_approved_user()) with check (public.is_approved_user());
create policy "approved_all_patient_vitals" on patient_vitals for all using (public.is_approved_user()) with check (public.is_approved_user());
create policy "approved_all_patient_labs" on patient_labs for all using (public.is_approved_user()) with check (public.is_approved_user());
create policy "approved_all_patient_imaging" on patient_imaging for all using (public.is_approved_user()) with check (public.is_approved_user());
create policy "approved_all_patient_attachments" on patient_attachments for all using (public.is_approved_user()) with check (public.is_approved_user());

-- Audit log: readable by approved users, written only by the trigger (security definer)
create policy "approved_read_audit_logs" on audit_logs for select using (public.is_approved_user());
create policy "audit_insert" on audit_logs for insert with check (true);

-- Storage: approved users only, scoped to the patient-attachments bucket
create policy "approved_select_attachments"
  on storage.objects for select to authenticated
  using (bucket_id = 'patient-attachments' and public.is_approved_user());

create policy "approved_insert_attachments"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'patient-attachments' and public.is_approved_user());

create policy "approved_delete_attachments"
  on storage.objects for delete to authenticated
  using (bucket_id = 'patient-attachments' and public.is_approved_user());
