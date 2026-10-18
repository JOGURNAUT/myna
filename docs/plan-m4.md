# Plan — Milestone 4: web app, Google Sheets adapter, manual-test labels

Status: **in progress (2026-10-18).** Started before M3 on purpose: M3 (browser voice with
Sarvam STT/TTS, audio-mode Hawk, latency numbers) cannot be built or verified without a
`SARVAM_API_KEY`, and untested voice code would be "clever and half-done". Everything here is
testable offline. M3 comes next as soon as a key is in `.env`.

## Done when
- `apps/web` (Next.js App Router + TypeScript + Tailwind) serves, in the Myna design system
  (teal, Figtree + Noto Sans Devanagari, light/dark, phone-first):
  1. **Talk to Myna** (public): a text chat with the real agent, language badge per turn, latency
     per turn, and the booking appearing in a mini schedule. (The mic arrives with M3.)
  2. **Clinic dashboard** (login): metrics with their formulas, handoff alerts, staff task queue
     (mark done), after-hours bookings to approve/reject, today's calls, kill-switch toggle.
  3. **Call detail**: transcript, what Myna understood, tool calls with latency, per-turn
     latency, and the manual label form (correct? failure type, notes).
  4. **Hawk report** (public, read-only link): verdict per flow, pass rates, failure modes.
  5. **Sign in**: one login per clinic.
- API: staff sessions (separate from the agent token), dashboard read endpoints, labels, kill
  switch, after-hours "pending" bookings with approve/reject.
- A **Google Sheets adapter** that passes the same SchedulingAdapter contract suite, tested
  against an in-memory fake of the Sheets API (no Google credentials needed in CI).
- Manual-test labels stored; **judge-vs-human agreement** computed and shown once judge grades
  exist (the LLM judge itself still needs a model key).

## Steps
1. **API for the dashboard.** `staff_sessions` (HMAC-signed, per clinic, expiring), login with a
   per-clinic password hash from env (`CLINIC_LOGINS`), staff-scoped routes: calls list + detail,
   metrics, tasks, pending bookings (approve / reject), kill switch (runtime override of the YAML),
   labels. Agent routes keep the agent token; staff can never call agent tools.
2. **After-hours bookings** (pilot step 2): clinic config `bookingApproval: none | after_hours`.
   Bookings made while the clinic is closed are `pending`; approving confirms (and queues the SMS),
   rejecting cancels and creates a call-back task.
3. **Google Sheets adapter** behind the same interface: one sheet per clinic with Patients and
   Appointments tabs; optimistic concurrency via a version column + re-read before write;
   idempotency keys in a hidden tab. Contract suite runs against a fake Sheets client.
4. **Web app** pages above. Server components fetch the API; the staff session lives in an
   HTTP-only cookie; the public demo talks to the agent's text endpoint through a Next.js route.
5. **Labels**: form on call detail → API; Hawk report gains judge-vs-human agreement when both
   exist.
6. Tests: API (Vitest), adapter contract (fake Sheets), web (Vitest for helpers + a Playwright
   smoke run of each page against a seeded API, if Playwright installs cleanly; otherwise HTTP
   smoke tests of the rendered pages).

## Risks
- Next.js/Tailwind majors may have moved; I'll check installed versions, not assume APIs.
- A real Google Sheet will behave differently from the fake (quotas, latency). The adapter keeps
  writes small and the pilot playbook will record what breaks.
