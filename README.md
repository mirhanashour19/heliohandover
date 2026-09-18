# HelioHandover

A patient-handover Progressive Web App built for the General Surgery Department at Heliopolis General Hospital — replacing paper handover sheets and scattered WhatsApp messages with a single shared, live view of every patient under the team's care.

Built solo by a general surgery resident to solve a real problem in her own department, now in active daily clinical use.

## The problem

Surgical handover between shifts traditionally happens through handwritten sheets, verbal sign-out, or WhatsApp messages — all of which get lost, are hard to search, and leave no record of what changed or who changed it. Critical information (a deteriorating patient, a pending lab result, an unresolved consultation) can slip between shifts with no trace.

## What it does

- **Live shared dashboard** — every patient the team is responsible for, grouped by ward, sorted by acuity (critical patients surface first)
- **Two patient tracks** — full admissions with the complete clinical picture, and lightweight consultations that only escalate to a full record if the patient is admitted under the team's care
- **Structured clinical data** — vitals, labs, imaging, tubes/drains, wound status, comorbidities — instead of free-text notes that are easy to miss
- **Photo attachments** — lab results and imaging can be photographed directly from the phone (camera or gallery), auto-compressed client-side, and attached to the patient record
- **Case Progress timeline** — every field change is logged automatically with who changed it and when, grouped by clinical work-day (9am–9am) rather than the calendar day
- **Offline-friendly PWA** — installable on iOS/Android home screens, with a fallback recovery screen if the app fails to load
- **Role-gated access** — new accounts require admin approval before they can see any patient data

## Tech stack

- **Frontend:** React (Vite), plain CSS — no UI framework, built for a fast, minimal footprint on hospital WiFi
- **Backend:** [Supabase](https://supabase.com) (Postgres + Auth + Storage + Row Level Security)
- **PWA:** `vite-plugin-pwa`, with a custom iOS-safe fallback and service worker
- **Hosting:** Netlify (primary) with a Cloudflare Pages mirror for regions where Netlify subdomains are ISP-blocked

## Screenshots

*(Add screenshots here — dashboard, patient form, Case Progress timeline. Use a demo/seeded patient, never real patient data.)*

## Database schema

The full schema — tables, relationships, RLS policies, and the audit-log trigger that powers the Case Progress timeline — is in [`supabase/schema.sql`](./supabase/schema.sql). Key tables:

- `patients` — the core clinical record, shared between admitted and consultation workflows
- `patient_tubes`, `patient_attachments`, `patient_consultants` — one-to-many detail tables
- `audit_logs` — populated automatically by a Postgres trigger on every patient insert/update
- `wards`, `consultants` — department reference data

## Running locally

```bash
git clone https://github.com/<your-username>/heliohandover.git
cd heliohandover
npm install
cp .env.example .env   # then fill in your own Supabase project URL + anon key
npm run dev
```

You'll need your own Supabase project — run `supabase/schema.sql` in the SQL Editor to set up the database, then create the first user and manually flag their `user_profiles.is_approved` row as `true` to get in.

## Why it's built this way

- **No ORM, no framework** — this runs on hospital WiFi from personal phones; every dependency is a cost. Direct REST calls to Supabase's PostgREST API keep the bundle small and the code auditable.
- **Row Level Security over app-level checks** — access control lives in the database, not just the UI, since this handles real patient data.
- **The audit trigger, not manual logging** — every change is captured automatically at the database layer, so there's no code path that can accidentally skip logging a clinical change.

## About

Built by Mirhan Ashour, a general surgery resident, as a self-taught side project to solve a workflow problem she experienced firsthand on the ward.

---

*This repository contains the application source code only. No patient data, credentials, or production configuration are included — see `.env.example` for the environment variables you'll need to supply.*
