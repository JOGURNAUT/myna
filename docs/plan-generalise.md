# Plan: one engine, two verticals (clinics + restaurants), and a voice-layer spike

Status: **draft, waiting for OK to start code** (CLAUDE.md: plan first, then wait).
Decided with the user on 2026-11-05: make Myna general-purpose, add restaurant reservations as a
second vertical in the same repo; evaluate LiveKit instead of Pipecat (advice from an FDE contact).
Defaults assumed where not answered: India-first (EN / Hindi / Hinglish) for restaurants too; a
sit-down restaurant (tables, party size), not a cafe or quick-service counter.

## Why
- Clinic-only reads as "built to impress one company". A config-driven engine proven on two very
  different businesses is a stronger engineering story, and the architecture already allows it
  (`vertical` is in the config schema; a business = resources + services + hours + rules).
- Restaurants are lower-stakes than clinics (no medical advice, no emergencies in the same sense),
  so they are a cheap way to prove the engine is not clinic-shaped.
- Cost: scope doubles. Mitigation: a hard order of work with cut points (below), and clinic Hawk
  stays at 106/106 after every step.

## What is clinic-shaped today (measured by grep, 2026-11-05)
- Words: "patient" appears in 67 source files, "dob" in 129, "doctor" in 60. The reply templates
  (`services/agent/src/myna_agent/i18n.py`) say "patient ka poora naam", "Dr. Mehta".
- Rules: verification is hard-wired to name + date of birth (CLAUDE.md safety rule 4).
- Schema: `vertical: z.literal('clinic')`, `resources` = doctors, `services` have a duration only.
- Hawk scenarios, the dashboard copy and the demo page speak clinic.

## Design

### 1. Vocabulary per vertical (no rewrite)
Reply templates stay fixed per language (the LLM never writes speech). Add a vertical layer:
`line(key, lang, vertical=...)` looks up `LINES[vertical][key]` and falls back to the shared line.
A small `Vocabulary` (customer / resource / visit words) feeds the web copy as well.
`patient` in code and the DB becomes `customer`; a migration renames columns, the API keeps the
old field names accepted for one release so Hawk scenarios do not all change at once.

### 2. Verification policy in config
`verification: { mode: 'name_dob' | 'name_phone' | 'name_only' }`, default `name_dob` (clinics,
unchanged). Restaurants use `name_phone` for cancel/change (never reveal a booking without it);
a plain new booking needs only a name and a phone. The check stays in code, with the same
"no detail before verification" test suite, parametrised by mode.

### 3. Capacity and party size
`resources[].capacity` (table seats) and `services[]` become "party size bands" for restaurants
(duration by party size: 1 to 2 people 75 min, 3 to 4 people 90 min, 5 or more 120 min). Slot
search requires `capacity >= party size`, merges nothing, and offers the smallest table that
fits. A party larger than the biggest table is a message/handoff, never an invented booking.
Seating preference (indoor/outdoor) is a resource tag. Special requests ("birthday", "allergy")
are saved as a note on the booking and a staff task; Myna never answers allergen or menu-safety
questions (same family as "no medical advice").

### 4. Waitlist and "seat available" callback (the one genuinely new flow)
- New tool `join_waitlist(customer, phone, party_size, date, time_window)`; a `waitlist` table
  (tenant id on every row, as everywhere).
- When a booking is cancelled or a no-show frees a table, the scheduler finds the first waitlist
  entry (FIFO) that fits, and places an outbound call: opening line says who is calling and that
  it is an automated assistant, offers the seat, and holds it for a configured window (default
  10 minutes). Outcomes: accepted (booked), declined, no answer / voicemail (next in line after
  max attempts), opt-out (do-not-call, same mechanism as reminders).
- Reuses what exists: outbound state machine, reminder claims (Redis `SET NX PX`) so two agent
  instances never call the same person, call window rules, kill switch, opt-out.
- Race rule: the seat is held for the entry being called; a second inbound caller is not offered
  it during the hold.

### 5. Hawk for restaurants
New scenarios under `hawk/scenarios/restaurant-*.yaml`: book for 4, party too large, fully booked
then waitlisted, cancel frees a seat and the waitlist gets a callback (accepted / declined / no
answer), change party size mid-call, mind-change on time, allergy question (handoff, no answer),
wrong-person cancel attempt, caller who asks for the menu or prices (FAQ from config only).
The report gains a "by vertical" cut next to "by language"; the judge and its agreement view are
shared. Gate: both verticals must be SAFE for CI to pass.

### 6. Web and docs
The talk page and dashboard choose their words from the vertical's vocabulary; the demo page can
switch between "Smile Dental Care" and the demo restaurant. Metrics get vertical-specific
formulas (clinic: share handled without staff, no-show rate; restaurant: covers booked by phone,
waitlist fill rate). README: "Built vertical-agnostic; validated on clinics (pilot) and
restaurants." CLAUDE.md scope note updated (done with this plan).

## LiveKit spike (separate from the verticals, timeboxed to 1 day)
Not a migration. Question to answer: is LiveKit Agents + Sarvam + an Indian SIP trunk a shorter
path to a real phone number than Pipecat's telephony serializers?
- Check (from docs, not memory): a Sarvam STT/TTS plugin for LiveKit Agents, its supported models
  (saaras:v4, bulbul:v3), and SIP inbound with an Indian provider (Exotel / Plivo / Twilio).
- Build: the smallest LiveKit agent that connects to our existing `Brain` (text-in, text-out over
  the agent's `/v1/calls/*` API), so the conversation core is untouched.
- Measure: first-audio latency and barge-in vs the Pipecat numbers (493 ms stage sum, about
  0.95 s felt).
- Decision rule: move the voice layer only if telephony is clearly simpler or latency is no worse.
  The swap is contained to `services/agent/src/myna_agent/voice/` (about 600 lines).
- Write the result in `docs/decisions.md` either way.

## Order of work, with cut points
1. **A. Generalise** (vocabulary, verification policy, capacity). Gate: clinic Hawk 106/106,
   all tests green. Commit per sub-step.
2. **B. Restaurant vertical** (config, scenarios, report cut, web copy). Gate: restaurant Hawk
   SAFE offline.
3. **C. Waitlist + callback.** Cut line: if time is short, ship waitlist as "join waitlist and
   staff task" without the outbound callback, and say so.
4. **D. LiveKit spike**, before telephony work (Milestone 5) starts.
Clinic pilot work (Milestone 5) is not blocked by B and C, but is not started until D decides
the voice layer.

## Out of scope
Deposits and payments, menu ordering / POS, delivery, a third vertical.

## Open questions (defaults in brackets)
1. Walk-in tokens for restaurants? [no]
2. Per-table or per-section booking? [per table, with a seating tag]
3. Does the demo restaurant keep Hawk's fake clock (Mon 12 Oct 2026)? [yes]
