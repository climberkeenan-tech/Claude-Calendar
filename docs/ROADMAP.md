# Roadmap — the 12 phases

Working agreement (from the project brief, treated as law):

- **One phase at a time. Never skip ahead.**
- Every phase ends with: (1) an explanation of what was completed, (2) verification that it works, (3) an explicit question — *continue?* — before the next phase starts.
- **Reliability over speed. Ease-of-use over technical impressiveness.**

Each phase below lists its deliverables and the verification checklist that must pass before the phase is called done. "E2E" means a Playwright test or a recorded manual walkthrough of the real running app.

---

## Phase 1 — Project Planning ✅

**Deliverables:** `README.md`, `docs/ARCHITECTURE.md`, this roadmap.

**Verification:** architecture adversarially reviewed (feasibility, over-engineering, requirements coverage against the full project brief) and revised; committed and pushed.

---

## Phase 2 — UI Design

Design system + application shell + a dashboard with real layout (wired to placeholder data where the backing feature is a later phase).

**Deliverables**
- Next.js project scaffold: TypeScript strict, Tailwind 4, tokens from ARCHITECTURE §10, light/dark themes, fonts via `next/font`.
- `components/ui` primitive set (Button, Card, Dialog, Input, Select, Toast, Tooltip, Badge) — Claude-styled, Radix-backed.
- App shell: sidebar nav, topbar, responsive (sidebar → bottom tabs on mobile).
- Dashboard layout with all nine zones from the brief: Today's Schedule, Upcoming Deadlines, Assignments, Habits, Study Timer, Quick Add button, Calendar Preview, Productivity Score, Recent Activity.
- Keyboard shortcut framework + `?` overlay; `⌘K` command palette stub.
- Auth: Google sign-in with allowlist; login page.
- Database provisioned; schema migrated; seed script with sample data so every screen shows something real-looking.

**Verify:** app deploys to Vercel; sign-in works and blocks non-allowlisted accounts; both themes pass AA contrast spot-checks; dashboard readable in 5 seconds on phone + laptop; keyboard shortcuts fire; Lighthouse a11y ≥ 95.

---

## Phase 3 — Calendar System

**Deliverables:** Day/Week/Month/Agenda views on one data hook; event CRUD; recurring events (RRULE, three edit modes); drag to move/resize with 15-min snap; category colors + custom colors; **Quick Add with natural language** (`claude-opus-4-8` structured output → editable confirm chips; `chrono-node` offline fallback).

**Verify:** unit tests for recurrence expansion (incl. DST boundaries in America/New_York) and overlap layout; E2E: create → drag → edit-occurrence → complete; quick-add acceptance list ("Study Biology tomorrow at 7 PM", "Gym every Monday at 5", "Exam next Friday", ≥ 10 more phrasings) parses correctly or fails safe to the manual editor; latency of quick-add confirm loop measured. **Decision point:** if parse latency feels slow in real use, decide whether to move quick-add to a faster model.

---

## Phase 4 — Event Management

**Deliverables:** full event detail (title, description, course, location, priority, estimated/actual time, tags, attachments, checklist, notes, completion, repeat rules); fast-path editing — inline edits from calendar/list without opening the full sheet; automatic default reminders per category; courses management screen.

**Verify:** every field round-trips (E2E); common edits (retitle, reschedule, complete, change category) each ≤ 3 clicks from the calendar, counted explicitly; attachments upload/download via Blob.

---

## Phase 5 — Reminder System

**Deliverables:** scheduler + `notification_jobs` + QStash delivery + daily sweep (ARCHITECTURE §7); channels: in-app, web push (incl. PWA install flow for iOS), email; SMS decision made (Twilio setup or explicitly deferred); all standard offsets + custom; quiet hours; acknowledgment tracking; **escalation policy v1** for ignored reminders.

**Verify:** unit tests for job diffing (create/edit/complete/delete each produce the right job set); live test: reminder fires within ±1 min on push and email; completed event's pending reminders auto-cancel (proven by test); duplicate-delivery idempotency test; escalation triggers in a simulated ignore scenario and respects caps + quiet hours.

---

## Phase 6 — AI Assistant

**Deliverables:** insights engine (nightly context → `claude-opus-4-8` → capped, prioritized `ai_insights` with one-click Accept actions); `user_patterns` nightly derivation; procrastination + conflict detection; estimate-accuracy feedback ("BIO homework usually takes you 1.5× your estimate"); auto-prioritization of the task list; dashboard "Insights" surface.

**Verify:** seeded scenarios produce expected insight kinds (overloaded week → warning; repeated postponement → procrastination flag; overlap → conflict); Accept applies the change and is undoable; daily insight volume respects the cap; a week of real usage reviewed for signal-vs-noise before calling it done.

---

## Phase 7 — Syllabus Import

**Deliverables:** upload UI (PDF/image/screenshot/DOCX) → extraction → review screen (per-item edit/accept/reject, confidence flags, source excerpts) → transactional approve → bulk-undo per import (ARCHITECTURE §11).

**Verify:** test corpus of ≥ 5 real syllabi (varied formats, incl. a photographed one); measure extraction precision on dates; nothing is created without approval (test); undo removes exactly the import's rows; a malformed/non-syllabus file fails with a friendly error.

---

## Phase 8 — Analytics Dashboard

**Deliverables:** nightly rollups + `daily_stats`; analytics page: weekly timeline, category pie, course workload bars, productive-days heatmap, trend lines, semester progress; completed/late/missed tracking; focus-session stats; productivity score with in-UI explanation.

**Verify:** rollup math unit-tested against hand-computed fixtures; charts readable in both themes and on mobile; each chart passes the "immediately communicates something useful" review — any chart that needs explaining gets redesigned or cut; page loads < 1 s on seeded semester-scale data.

---

## Phase 9 — Smart Time Management

**Deliverables:** free/busy engine (`free-time.ts`); open study-block finder; overload detection; suggestion surfaces: best study time, workout time, sleep consistency, work sessions, break timing — each with **one-click accept** (creates the calendar block); "plan my week" assist that proposes a full week's study blocks in one pass.

**Verify:** free-block finder unit-tested against dense/sparse schedules; accepted suggestions land correctly and respect existing events; "plan my week" run end-to-end in < 5 minutes including review — the brief's headline success criterion.

---

## Phase 10 — User Experience

A dedicated friction hunt across everything shipped so far.

**Deliverables:** click-count audit (every common action ≤ 3, measured and listed); load-time pass (route-level code splitting, calendar window prefetch); transition/animation polish; typography + spacing pass; mobile ergonomics (thumb-reachable primary actions); dark/light parity sweep; shortcut coverage review; empty states and error states everywhere.

**Verify:** the click-count table published in the repo; Lighthouse perf ≥ 90 / a11y ≥ 95 on dashboard + calendar; a full "plan the week on the phone" session performed without touching the laptop.

---

## Phase 11 — Future Integrations (architecture, not implementations)

**Deliverables:** `CalendarSyncProvider` adapter interface + `external_sources` table design; **ICS feed export** (read-only subscribe URL — instantly usable from Google/Apple/Outlook calendars); ICS *import* evaluation for Canvas (Canvas exposes per-user calendar feeds — likely the cheapest real integration for HPU coursework); documented integration guide for the rest (Google/Apple/Outlook two-way, Canvas/Blackboard/Brightspace, Notion, Todoist, Drive/Dropbox/OneDrive, Apple Reminders, HPU systems if APIs exist).

**Verify:** ICS export validates and subscribes cleanly in Google Calendar + Apple Calendar; adapter interface reviewed against two hypothetical implementations (Google two-way, Canvas pull) to confirm it wouldn't need breaking changes.

---

## Phase 12 — Final Polish

**Deliverables:** screen-by-screen review with fixes; workflow simplification pass (remove anything unused); performance + reliability sweep; full code review; accessibility re-audit; documentation set: user guide, installation/setup instructions, `.env` reference, future roadmap, testing checklist; version 1.0 tag.

**Verify:** the brief's success criteria, checked one by one — plan a week in < 5 min · never miss deadlines (reminder reliability demonstrated) · always know what's next (dashboard test) · syllabus → semester calendar works on a real HPU syllabus · AI suggestions genuinely helpful for a full week · polish comparable to a commercial app · feels like an official Claude companion.

---

## Standing decision points (flagged early so they're never surprises)

| Phase | Decision |
|---|---|
| 3 | Quick-add model: keep `claude-opus-4-8` vs. faster model if latency bothers in practice |
| 5 | Enable Twilio SMS (real per-message cost) or rely on push + email |
| 5 | Escalation aggressiveness defaults |
| 11 | Which integration (if any) gets built first for real |
