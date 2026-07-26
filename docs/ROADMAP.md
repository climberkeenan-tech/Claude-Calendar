# Roadmap — the 12 phases

Working agreement (from the project brief, treated as law):

- **One phase at a time. Never skip ahead.**
- Every phase ends with: (1) an explanation of what was completed, (2) verification that it works, (3) an explicit question — *continue?* — before the next phase starts.
- **Reliability over speed. Ease-of-use over technical impressiveness.**

Each phase below lists its deliverables and the verification checklist that must pass before the phase is called done. "E2E" means a Playwright test or a recorded manual walkthrough of the real running app. Larger phases are split into internal checkpoints (a/b) so each chunk is honestly verifiable — the phase gate still comes once, at the end of the phase.

---

## Phase 1 — Project Planning ✅

**Deliverables:** `README.md`, `docs/ARCHITECTURE.md`, this roadmap.

**Verification:** architecture adversarially reviewed by three independent reviewers (technical feasibility with live fact-checking, over-engineering + ADHD-first usability, requirements coverage against the full project brief); 38 findings triaged and folded back into the documents; committed and pushed.

---

## Phase 2 — UI Design

### 2a — Foundation
- Next.js project scaffold: TypeScript strict, Tailwind 4, design tokens from ARCHITECTURE §10, light/dark themes, fonts via `next/font`.
- Auth: Google sign-in with allowlist; login page.
- Database provisioned; schema migrated; seed script with realistic sample data.
- CI (typecheck, lint, unit tests, build) + first Vercel deploy.

**Verify 2a:** deployed; sign-in works and blocks non-allowlisted accounts; CI green.

### 2b — Design system + shell + dashboard
- `components/ui` primitive set (Button, Card, Dialog, Input, Select, Toast, Tooltip, Badge) — Claude-styled, Radix-backed.
- App shell: sidebar nav, topbar, responsive (sidebar → bottom tabs on mobile).
- Dashboard with the **NOW / NEXT hero band** (current block + time remaining; next thing + live countdown) as the only above-the-fold element, and all nine zones from the brief (Today's Schedule, Upcoming Deadlines, Assignments, Habits, Study Timer, Quick Add button, Calendar Preview, Productivity Score, Recent Activity) as secondary/collapsible cards.
- Keyboard shortcut framework + `?` overlay (single `Q` omnibox — no separate command palette).

**Verify 2b:** both themes pass AA contrast spot-checks; layout works on phone + laptop; keyboard shortcuts fire; Lighthouse a11y ≥ 95. (The literal timed "5-second glance" test runs in Phase 3, once real events exist — against seed data it proves nothing.)

---

## Phase 3 — Calendar System

**Deliverables:** Day/Week/Month/Agenda views on one data hook; event CRUD; recurring events (RRULE with floating-time convention, three edit modes); **habit kind** with weekly targets (X-of-Y days), backfill, and no-zero-shaming display, wiring the dashboard Habits zone; drag to move/resize with 15-min snap; category colors + custom colors; **Quick Add with natural language** — local-first `chrono-node` chips on every keystroke, Claude reconciliation for recurrence/category/course, one-Enter confirm; **Inbox** for captures with no parseable date, with a one-tap "schedule it" path.

**Verify:** unit tests for recurrence expansion (incl. both America/New_York DST boundaries, `UNTIL` end-of-series correctness) and overlap layout; E2E: create → drag → edit-occurrence → complete; habit weekly-target math unit-tested; quick-add acceptance list ("Study Biology tomorrow at 7 PM", "Gym every Monday at 5", "Exam next Friday", ≥ 10 more phrasings) parses correctly or fails safe; **hard latency gate: p95 keystroke-to-chips < 1.5 s regardless of API state**; the timed 5-second dashboard glance test, now with real data. **Decision points at the gate:** (1) approve the one-Enter confirm step as a deliberate deviation from the brief's "automatically create events"; (2) model choice for the Claude reconciliation step if its latency is noticeable in practice.

---

## Phase 4 — Event Management

**Deliverables:** full event detail (title, description, course, location, priority, estimated/actual time, tags, checklist, notes, completion, repeat rules); fast-path editing — inline edits from calendar/list without opening the full sheet; automatic default reminders per category (capped at 1–2 per event); courses management screen; **working Study Timer** on the dashboard writing `focus_sessions`. (Attachments move to Phase 7, which introduces the private Blob store for syllabi anyway — nothing in Phases 4–6 depends on them.)

**Verify:** every field round-trips (E2E); common edits (retitle, reschedule, complete, change category) each ≤ 3 clicks from the calendar, counted explicitly; timer start/stop produces correct `focus_sessions` rows.

---

## Phase 5 — Reminder System

### 5a — The reliable core
- Scheduler + `notification_jobs` + QStash delivery with the ≤ 48 h enqueue window + lease-based crash-safe dispatch + daily sweep (ARCHITECTURE §7).
- Channels: in-app + email; all standard offsets + custom; quiet hours (defer, never drop); acknowledgment tracking; **snooze and "back off" controls on every notification surface**.

### 5b — Push + phone reliability
- Web push (VAPID + service worker), PWA install flow for iOS with onboarding.
- Cross-channel fallback: deadline-critical push unacknowledged after N minutes → automatic email.
- **SMS decision at the gate**, framed as reliability (the one channel that needs no installed PWA), not just cost: enable Twilio or record an explicit approved deferral.

**Verify:** unit tests for job diffing (create/edit/complete/delete each produce the right job set) and the 48 h enqueue window; live test: reminder fires within ±1 min on email and push; **reminder received on the actual iPhone — PWA installed, screen locked**; completed event's pending reminders auto-cancel (test); duplicate-delivery and crash-mid-send recovery tests (lease reclaim); quiet-hours deferral test; snooze round-trip.

*(Escalation intentionally lives in Phase 6 — a good escalation policy needs the real ignore-rate data this phase starts collecting.)*

---

## Phase 6 — AI Assistant

**Deliverables:** insights engine (nightly staged jobs → `claude-opus-4-8` → **≤ 3 action-framed insights/day as one digest**, each with one-click Accept from the whitelisted action set); `user_patterns` nightly derivation; conflict detection; starter-block suggestions for slipping tasks (procrastination vocabulary stays internal); estimate-accuracy feedback ("BIO homework usually takes you 1.5× your estimate"); auto-prioritization of the task list; **escalation policy v1**, tuned on the ignore-rate data Phase 5 collected; **MCP server v1** — bearer-token auth for Claude Code, tools: `get_agenda`, `get_upcoming_deadlines`, `quick_add`, `complete_item`, `reschedule_item`, `start/stop_focus_session`, `get_productivity_summary`, plus the token-generation UI in Settings.

**Verify:** seeded scenarios produce expected insight kinds (overloaded week → warning; repeated postponement → starter-block suggestion; overlap → conflict); Accept applies the change and is undoable; daily digest cap holds; escalation triggers in a simulated ignore scenario and respects caps + quiet hours; **MCP: connect from Claude Code and exercise every tool**; a week of real usage reviewed for signal-vs-noise before calling the phase done.

---

## Phase 7 — Syllabus Import

**Deliverables:** upload UI (PDF/image/screenshot/DOCX) → private Blob store → extraction → review screen (per-item edit/accept/reject, confidence flags, source excerpts) → transactional approve → bulk-undo per import (ARCHITECTURE §11); **event attachments** (upload/download through authenticated routes), deferred here from Phase 4.

**Verify:** test corpus of ≥ 5 real syllabi (varied formats, incl. a photographed one); measure extraction precision on dates; nothing is created without approval (test); undo removes exactly the import's rows; a malformed/non-syllabus file fails with a friendly error; uploaded files unreachable without auth (test the URL from a logged-out session).

---

## Phase 8 — Analytics Dashboard

**Deliverables:** nightly rollups + `daily_stats` (incl. **free time** and **average work-session length**); analytics page: weekly timeline, category pie, course workload bars, productive-days heatmap, trend lines, semester progress; completed/late/missed tracking; focus-session stats; productivity score with its guardrails (weekly framing, renormalized missing components, hideable tile, wins + next-action presentation).

**Verify:** rollup math unit-tested against hand-computed fixtures; charts readable in both themes and on mobile; each chart passes the "immediately communicates something useful" review — any chart that needs explaining gets redesigned or cut; page loads < 1 s warm on seeded semester-scale data; score disappears cleanly when hidden and renormalizes correctly with the timer unused.

---

## Phase 9 — Smart Time Management ✅

**Deliverables:** free/busy engine (`free-time.ts`) with **configurable transition buffers** (default 10–15 min — no back-to-back packing) and location-adjacency warnings; open study-block finder; overload detection; suggestion surfaces: best study time, workout time, sleep consistency, work sessions, break timing — each **one-click accept**; "plan my week" assist proposing a full week's study blocks in one pass; **one-tap "replan today / tomorrow"** — rolls unfinished tasks and un-started blocks forward around existing commitments with a single confirm screen; gentle daily overdue triage ("3 things slipped — move, shrink, or drop?"); MCP `get_free_time` tool added.

**Verify:** free-block finder unit-tested against dense/sparse schedules incl. buffer math; accepted suggestions land correctly and respect existing events; replan handles a fully derailed day in one confirm; "plan my week" run end-to-end in < 5 minutes including review — the brief's headline success criterion.

---

## Phase 10 — User Experience ✅

A dedicated friction hunt across everything shipped so far.

**Deliverables:** click-count audit (every common action ≤ 3, measured and listed in the repo); load-time pass (route-level code splitting, calendar window prefetch); transition/animation polish; typography + spacing pass; mobile ergonomics (thumb-reachable primary actions); dark/light parity sweep; shortcut coverage review; empty states and error states everywhere; **timezone consistency pass** — client views currently key dates off the browser's timezone while the server uses the profile timezone (identical while the user is in Eastern time; flagged by the Phase 3 review as latent skew when traveling — unify on the profile timezone end-to-end).

**Verify:** the click-count table published; Lighthouse perf ≥ 90 / a11y ≥ 95 on dashboard + calendar; a full "plan the week on the phone" session performed without touching the laptop.

**Done.** `docs/CLICK-COUNTS.md` publishes the audit — 40 actions traced,
nothing over three. Timezone: every client view now keys off the profile
timezone through `@/lib/time`, verified byte-identical from Eastern, Pacific,
and Tokyo browsers (see ARCHITECTURE §6). Accessibility: 0 axe violations
(WCAG 2.0/2.1/2.2 A + AA) across light and dark at 390 / 768 / 1280 px, with
`tests/unit/tokens.test.ts` guarding the palette from here on. Performance:
chrono and Recharts moved out of the critical path (~200 KB gz), Lighthouse
100/100/100/100 desktop and 98/100/100/100 mobile on `/login`, 100 desktop /
95 mobile on a fixture route carrying the dashboard and calendar components.

**Still open for the deployed site:** Lighthouse on `/` and `/calendar`
themselves, and the "plan the week on the phone" session — both need a live
database and a real Google sign-in, so they belong to the post-deploy pass in
Phase 12.

---

## Phase 11 — Future Integrations ✅

Deliberately thin — real value now, speculation never. The sync-adapter abstraction gets designed **when the first real two-way integration is chosen**, not before.

**Deliverables:** **ICS feed export** (read-only subscribe URL — instantly usable from Google/Apple/Outlook calendars); **Canvas ICS-import evaluation** (Canvas exposes per-user calendar feeds — likely the cheapest real integration for HPU coursework); **MCP OAuth** (OAuth 2.1 + dynamic client registration via `mcp-handler`'s auth wrapper) so claude.ai and Claude Desktop custom connectors can finally connect — completing the "accessible from Claude everywhere" promise; a short written integration guide covering the brief's full candidate list (Google/Apple/Outlook two-way, Canvas/Blackboard/Brightspace, Notion, Todoist, Drive/Dropbox/OneDrive, Apple Reminders, HPU systems if APIs exist).

**Verify:** ICS export validates and subscribes cleanly in Google Calendar + Apple Calendar; the app connected as a claude.ai custom connector via OAuth with every MCP tool exercised; Canvas evaluation documented with a go/no-go recommendation.

**Done.** ICS export ships with a revocable subscribe URL; correctness is
checked twice — unit tests on what we write, plus a second suite that parses
the output back with `ical.js` (Thunderbird's implementation) and asserts a
9 AM class is still 9 AM local after the clocks change. A mutation check
confirmed those tests actually exercise our generated VTIMEZONE. The feed was
also built end-to-end from real Postgres rows and re-parsed. MCP OAuth is a
full OAuth 2.1 authorization server: RFC 8414 + 9728 discovery, RFC 7591
dynamic registration, mandatory PKCE S256, single-use codes, refresh rotation,
consent behind Google sign-in, and a Connected apps panel. 18 store-level
checks pass against real Postgres including the concurrent code-replay race.
`docs/INTEGRATIONS.md` carries the Canvas go/no-go (**GO**, one-way ICS
import) and the full candidate-list assessment.

**Still open for the deployed site:** subscribing the feed in real Google and
Apple Calendar, and adding the app as a real claude.ai custom connector — both
need the public HTTPS URL. Part of the post-deploy pass in Phase 12.

---

## Phase 12 — Final Polish

**Deliverables:** screen-by-screen review with fixes; workflow simplification pass (remove anything unused); **UI consistency sweep, animation review, and responsiveness re-check** (re-verified here even though Phase 10 passed — Phases 11–12 changes count too); performance + reliability sweep; full code review; accessibility re-audit; documentation set: user guide, installation/setup instructions, `.env` reference, future roadmap, testing checklist; version 1.0 tag.

**Verify — the brief's success criteria, one by one:**
- Plan a week in < 5 minutes ✓ (measured, Phase 9 flow)
- Never miss important deadlines ✓ (reminder reliability demonstrated end-to-end, incl. locked iPhone)
- Always know what to work on next ✓ (NOW/NEXT glance test)
- Syllabus → semester calendar ✓ (on a real HPU syllabus)
- AI continuously improves the schedule ✓ (insight quality compared with empty vs. populated `user_patterns` — the learning loop must demonstrably change the output)
- **Enjoyable to use** ✓ (a week of real use with a short daily journal: "did I open it willingly or avoid it?" — avoidance is a bug report)
- Commercial-grade polish; feels like an official Claude companion ✓ (screen-by-screen review)

---

## Standing decision points (flagged early so they're never surprises)

| Phase | Decision |
|---|---|
| 3 | Approve the one-Enter confirm on quick add (deviation from the brief's "automatically create") |
| 3 | Model for the quick-add reconciliation step, if its latency is noticeable behind the local-first chips |
| 5 | SMS: enable Twilio (reliability argument — no PWA dependency) or record an approved deferral |
| 6 | Escalation aggressiveness defaults, informed by Phase 5's real ignore-rate data |
| 11 | Which integration (if any) gets built first for real |
