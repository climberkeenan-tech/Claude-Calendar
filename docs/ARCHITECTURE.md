# Architecture — High Point Productivity OS

**Phase 1 deliverable.** This document is the complete technical plan for the application. Every later phase builds on decisions made here; if a later phase contradicts this document, this document gets updated first.

---

## TL;DR

One Next.js application deployed on Vercel. Postgres (Neon) holds everything. Auth is "sign in with Google" locked to one allowed email. The Claude API powers natural-language quick add, syllabus extraction, and the insights engine. Reminders are rows in a `notification_jobs` table delivered at the exact minute by Upstash QStash callbacks, through a channel abstraction (in-app, web push, email, SMS-later). A built-in MCP server at `/api/mcp` makes the whole system usable directly from claude.ai, Claude Desktop, and Claude Code. Everything runs on free tiers; the only meaningful ongoing cost is Claude API usage.

**Guiding rule for every decision below:** the option that is easier to *use* wins over the option that is more impressive to *build*. The second rule: fewest moving parts that can still be reliable.

---

## 1. Key decisions at a glance

| Area | Decision | Rejected alternative & why |
|---|---|---|
| App framework | **Next.js 15, App Router, TypeScript** | Separate SPA + API server — two deploys, two codebases, no benefit for one user |
| Database | **Neon Postgres + Drizzle ORM** | SQLite — no good story for a serverless host + multi-device access; Supabase — brings a second auth/storage system we don't need |
| Auth | **Auth.js v5, Google provider, email allowlist** | Passwords/magic links — more code, worse UX than one Google tap |
| Recurrence | **RFC 5545 RRULEs stored on the event, expanded at query time** (`rrule` library, floating-time convention — see §4) | Materializing every occurrence as rows — write amplification, edit/rescheduling nightmares |
| Reminder timing | **`notification_jobs` table as source of truth; QStash callbacks enqueued only for jobs due ≤ 48 h out (QStash free tier caps delay at 7 days); daily cron tops up the enqueue window and sweeps** | Vercel Cron alone — Hobby tier crons run at most daily, useless for "15 minutes before class"; a persistent worker server — a second deployment to babysit |
| AI model | **`claude-opus-4-8` for all AI features** (Anthropic-recommended default) | Smaller models for cost — cost at single-user volume is negligible; can revisit per-feature if quick-add latency bothers in practice (decision point flagged in Phase 3) |
| AI output format | **Structured outputs (`client.messages.parse` + Zod schemas)** | Free-text JSON prompting — parse failures become user-facing bugs |
| "Accessible from Claude" | **MCP server route inside the app** (Streamable HTTP, bearer token) | Building a chat UI inside the app — duplicates what claude.ai already does better |
| Mobile | **Responsive PWA (installable, web push)** | Native app — an order of magnitude more work, blocks the 12-phase plan |
| Hosting | **Vercel Hobby + Neon + QStash + Resend free tiers** | Self-hosted VPS — becomes a sysadmin chore for a student |

---

## 2. Technology stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 15 (App Router, React Server Components, Server Actions) | One codebase for UI + API; server actions keep mutations simple and typed |
| Language | TypeScript, `strict: true` everywhere | |
| Styling | Tailwind CSS 4 + custom design tokens (`src/styles/tokens.css`) | Tokens implement the Claude-inspired palette (§10); light + dark from day one |
| UI primitives | Radix UI (dialog, popover, dropdown, tooltip) wrapped in `src/components/ui` | Accessible by default (focus traps, ARIA, keyboard) without building it by hand |
| Animation | CSS transitions for most things; `motion` for drag/reorder and view transitions | Animation is seasoning, not sauce |
| Database | Neon Postgres (serverless driver) | Free tier: 0.5 GB storage — years of headroom for one user |
| ORM | Drizzle ORM + `drizzle-kit` migrations | Schema lives in TypeScript; migrations are plain SQL files checked into the repo |
| Auth | Auth.js v5 (NextAuth), Google OAuth, JWT session strategy | No database adapter needed; allowlist check in the `signIn` callback. Note: v5 is a pinned beta in maintenance mode (see §14) — kept because the alternative (Better Auth) requires a DB adapter we otherwise don't need |
| AI | `@anthropic-ai/sdk`, model `claude-opus-4-8` | Structured outputs via `zodOutputFormat`; PDFs/images sent directly as content blocks |
| File storage | Vercel Blob (**private store**) | Syllabus uploads + event attachments; served through authenticated routes / signed URLs, never public-by-obscurity links |
| Email | Resend | Free tier 100/day |
| Push | Web Push (VAPID) via `web-push` + a service worker | Works on desktop browsers and Android; iOS requires the PWA installed to the home screen (iOS 16.4+) — email is the fallback channel |
| SMS | Twilio (Phase 5, optional — costs real money) | Channel abstraction means adding it later touches one file |
| Scheduled delivery | Upstash QStash (signed HTTP callbacks at a scheduled time) | Free tier 1,000 messages/day, **max scheduled delay 7 days** — hence the ≤ 48 h enqueue window in §7. Sizing note: one event with 3 offsets × 2 channels = 6 jobs, so a heavy day is realistically 50–100 jobs — still comfortable |
| Dates | `date-fns` + `date-fns-tz`; `rrule` for recurrence | All storage in UTC; display timezone `America/New_York` (configurable). `rrule`'s native `TZID` handling is known-buggy around DST, so we use the floating-time convention (§4) and convert at the boundary with `date-fns-tz` |
| NL date fallback | `chrono-node` | Offline fallback if the Claude API is unreachable during quick add |
| DOCX extraction | `mammoth` (DOCX → text) | PDFs and images go to Claude natively; DOCX needs one conversion step |
| Charts | Recharts | Phase 8 |
| MCP server | `@modelcontextprotocol/sdk` + the `mcp-handler` Next.js adapter | §12 |
| Testing | Vitest (unit), Playwright (E2E smoke), GitHub Actions CI | Recurrence math, reminder scheduling, and parsers get real unit tests |

---

## 3. Folder structure

```
Claude-Calendar/
├── README.md
├── docs/
│   ├── ARCHITECTURE.md          # this file
│   └── ROADMAP.md               # phase plan + verification checklists
├── drizzle/                     # generated SQL migrations (checked in)
├── public/
│   ├── manifest.webmanifest     # PWA manifest
│   ├── sw.js                    # service worker (push + offline shell)
│   └── icons/
├── src/
│   ├── app/
│   │   ├── (app)/               # authenticated app shell (sidebar + topbar)
│   │   │   ├── page.tsx         # Dashboard — "what should I be doing right now?"
│   │   │   ├── calendar/        # day / week / month / agenda views
│   │   │   ├── assignments/     # deadline-centric list view
│   │   │   ├── import/          # syllabus upload + review screen
│   │   │   ├── analytics/       # charts (Phase 8)
│   │   │   └── settings/        # profile, notifications, categories, tokens
│   │   ├── login/
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts
│   │   │   ├── mcp/route.ts             # MCP server (Streamable HTTP)
│   │   │   ├── notifications/deliver/route.ts  # QStash-signed delivery callback
│   │   │   └── cron/daily/route.ts      # sweep missed jobs, nightly rollups, insights
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                  # Button, Dialog, Input, Card... (Claude-styled)
│   │   ├── calendar/            # grid views, event chips, drag layer
│   │   ├── dashboard/           # Today panel, deadlines, habits, timer, score
│   │   ├── quick-add/           # the Q-key omnibox
│   │   └── import/              # syllabus review table
│   ├── lib/
│   │   ├── db/
│   │   │   ├── schema.ts        # entire Drizzle schema (single file, single source of truth)
│   │   │   ├── client.ts
│   │   │   └── queries/         # one file per domain (events, stats, insights...)
│   │   ├── ai/
│   │   │   ├── client.ts        # Anthropic client singleton
│   │   │   ├── schemas.ts       # Zod schemas for every structured output
│   │   │   ├── quick-add.ts     # NL → event draft
│   │   │   ├── syllabus.ts      # document → extraction with confidences
│   │   │   └── insights.ts      # nightly/weekly analysis
│   │   ├── calendar/
│   │   │   ├── recurrence.ts    # RRULE expansion within a window (pure, unit-tested)
│   │   │   ├── conflicts.ts     # overlap detection
│   │   │   └── free-time.ts     # open-block finder (Phase 9)
│   │   ├── notifications/
│   │   │   ├── scheduler.ts     # reminders → notification_jobs → QStash
│   │   │   ├── escalation.ts    # ignored-reminder policy (Phase 5)
│   │   │   └── channels/        # in-app.ts, push.ts, email.ts, sms.ts — one interface
│   │   ├── analytics/
│   │   │   ├── rollups.ts       # nightly daily_stats computation
│   │   │   └── score.ts         # productivity score (documented formula)
│   │   └── utils/
│   ├── server/                  # server actions: events.ts, reminders.ts, imports.ts...
│   ├── hooks/                   # useKeyboardShortcuts, useCalendarNav...
│   └── styles/tokens.css        # design tokens (light + dark)
├── tests/
│   ├── unit/                    # vitest — recurrence, scheduler, score, parsers
│   └── e2e/                     # playwright — smoke flows
├── .env.example
├── drizzle.config.ts
├── next.config.ts
└── package.json
```

Conventions: pages stay thin; logic lives in `src/lib` (pure, testable) and `src/server` (actions). The MCP server and the UI call the **same** server-action layer, so behavior can never drift between "using the app" and "asking Claude."

---

## 4. Database schema

Single Postgres database. All timestamps `timestamptz` (UTC). Every table carries a `user_id` even though there is one user today — future-proofing costs one column now versus a painful migration later.

### Core entities

**`users`** — id, email, name, timezone (default `America/New_York`), created_at.

**`user_settings`** (one row) — theme, week_start_day, default reminder offsets per category (jsonb), quiet_hours_start/end, sleep target, phone_number, notification channel preferences, escalation_enabled.

**`courses`** — id, name, code (`BIO 1500`), professor, location, color, office_hours (jsonb), term (`Fall 2026`), source_import_id (nullable → which syllabus created it).

**`categories`** — id, name, color, icon, is_default. Seeded: Class, Homework, Exam, Personal, Work, Practice. Custom ones addable; colors editable.

**`events`** — the heart of the system. One table, one `kind` discriminator, because everything renders on the same calendar and shares reminders/checklists/attachments:

| Column | Notes |
|---|---|
| id, user_id, title, description, notes | |
| kind | `'event'` (time-blocked) · `'task'` (deadline-driven: assignments, homework) · `'habit'` (recurring, tracked against a **weekly target**, e.g. "gym 3 of 7 days" — deliberately *not* consecutive-day streaks; one missed day never zeroes anything, and completions can be backfilled after the fact) |
| category_id, course_id, location | course nullable |
| starts_at, ends_at, all_day | for `event`/`habit`; nullable for pure tasks |
| due_at | for `task`; the deadline shown in Upcoming Deadlines |
| rrule, rrule_until, tz | RFC 5545 string for recurring events/habits; null = one-off |
| priority | `low · normal · high · critical` |
| estimated_minutes, actual_minutes | Phase 4/6: estimate-accuracy learning |
| tags | `text[]` |
| status, completed_at | `scheduled · completed · cancelled` |
| source, source_id | `manual · quick_add · syllabus · ai_suggestion · integration` — every AI-created row is traceable and bulk-undoable |

**`occurrences`** — per-instance state for recurring events. Row exists only when an instance deviates from the series: (event_id, occurrence_date) PK, cancelled flag, completed flag + completed_at (habit weekly-target adherence is computed from these rows), overrides (jsonb patch: moved time, changed location, etc.).

### Event sub-resources

- **`checklist_items`** — event_id, text, done, position.
- **`attachments`** — event_id, blob_url, filename, mime, size.
- **`reminders`** — event_id, offset_minutes (nullable), absolute_at (nullable — "custom" timing), channels (`text[]`), enabled. Standard offsets: 1 week, 3 days, 1 day, 12 h, 1 h, 30 m, 15 m, 5 m.

### Notification pipeline

- **`notification_jobs`** — reminder_id, event_id, occurrence_at, send_at, channel, status (`pending · sent · failed · cancelled · acknowledged`), qstash_message_id, attempts, sent_at, acked_at, is_escalation flag. **This table is the source of truth**; QStash is only the alarm clock (§7).
- **`push_subscriptions`** — endpoint, keys (jsonb), user_agent, per device.

### Tracking & intelligence

- **`focus_sessions`** — event_id?, course_id?, started_at, ended_at, duration_minutes, kind (`study · work · reading · other`). Fed by the dashboard Study Timer.
- **`activity_log`** — append-only: type, entity_type, entity_id, data (jsonb), created_at. Powers "Recent Activity" and gives the AI honest behavioral data (created-then-postponed-3-times is a procrastination signal).
- **`daily_stats`** — date PK + rolled-up columns: minutes_studied, minutes_by_category (jsonb), free_minutes, avg_work_session_minutes, tasks_completed, tasks_completed_late, tasks_overdue, focus_session_count, productivity_score. Recomputed nightly; charts read this, never raw tables.
- **`user_patterns`** (one row, jsonb) — nightly-derived: estimate-accuracy ratio per course, completion-rate-by-hour histogram, reminder ignore rates, typical busy windows. Injected into AI prompts — the "gets smarter over time" mechanism is structured data, not model fine-tuning.
- **`ai_insights`** — kind (`study_suggestion · conflict · starter_block_suggestion · busy_week_warning · schedule_improvement · time_estimate`), title, body, confidence, action (jsonb — **a Zod-validated union of a small whitelisted operation set**: `create_event`, `reschedule_item`, `add_reminder` — never an open "call any server action by name" dispatch), status (`new · accepted · dismissed`), created_at, expires_at. Procrastination detection exists as an *internal signal* that produces action-framed suggestions ("BIO essay keeps slipping — want a 25-minute starter block at 4?"), never as a user-facing label.

### Import & access

- **`syllabus_imports`** — blob_url, filename, mime, status (`uploaded · parsing · review · approved · failed`), course_id?, extraction (jsonb — full structured result with per-item confidence), model, error, created_at.
- **`api_tokens`** — name (`"claude.ai connector"`), token_hash (SHA-256; plaintext shown once), last_used_at, revoked_at. Auth for the MCP server.

### Recurrence model (how repeat rules actually work)

1. A recurring event is **one row** with an `rrule` (e.g. `FREQ=WEEKLY;BYDAY=MO,WE` + an `UNTIL` at the last occurrence's instant).
2. Any calendar query expands rules **server-side within the visible window** using the `rrule` library. Because `rrule`'s native `TZID` support is known-buggy around DST, expansion uses the **floating-time convention**: wall-clock values go in as fake-UTC, come out as wall-clock, and are converted to real instants at the boundary with `date-fns-tz`. All of it is a pure function, heavily unit-tested, including DST boundaries (America/New_York has two per year).
3. "Edit this occurrence" writes an `occurrences` override row; "edit whole series" edits the parent; "this and future" splits the series (old row gets `UNTIL`, new row starts at the split). These are the only three edit modes — matching what every mainstream calendar trains users to expect. `UNTIL` is always stored as the instant of the final occurrence to keep — never bare UTC midnight, which silently drops the last day for any US-timezone event.
4. Reminder jobs for recurring events are materialized into `notification_jobs` on a **60-day rolling horizon** by the nightly cron, but handed to QStash only when due within **48 hours** (QStash's free tier caps scheduled delay at 7 days; the database is the long-horizon store, QStash is just the short-fuse alarm clock).

---

## 5. Authentication

- **Auth.js v5** with the Google provider only. The `signIn` callback rejects any email not in the `ALLOWED_EMAILS` env var. One tap to sign in, nothing to remember, and the app is private even though it's on the public internet.
- **JWT session strategy** — no session table, no DB adapter; fewer moving parts.
- Middleware protects everything under `(app)/` and `/api/*` except: the auth routes, `/api/notifications/deliver` (QStash signature verification instead), `/api/cron/*` (Vercel cron secret header), and `/api/mcp` (bearer token, below).
- **MCP access tokens**: generated in Settings, stored hashed in `api_tokens`, sent as `Authorization: Bearer`. Revocable individually. This keeps human auth (Google) and machine auth (tokens) cleanly separated. **Reality check on clients:** static bearer headers work for Claude Code (and any header-capable MCP client), but claude.ai and Claude Desktop custom connectors support only OAuth or no-auth — so full claude.ai/Desktop connectivity requires implementing MCP OAuth (OAuth 2.1 + dynamic client registration; `mcp-handler` ships an experimental auth wrapper). Plan: bearer-token MCP v1 for Claude Code first, MCP OAuth as a scheduled later deliverable (see ROADMAP Phases 6 and 11).

---

## 6. Calendar architecture

- **Views**: Day, Week (default), Month, Agenda. One shared data hook (`useCalendarWindow(start, end)`) feeds all four; a server query returns expanded occurrences + tasks-due + habits in the window in a single round trip.
- **Rendering**: CSS-grid time grid. Events are absolutely positioned chips; overlap resolution (side-by-side columns) is a pure function with unit tests.
- **Drag & drop**: move (drag), resize (drag edges), and drag-from-task-list-to-calendar (turns a deadline task into a scheduled work block — Phase 9's manual precursor). Server action commits on drop; optimistic UI with rollback on failure. 15-minute snap.
- **Quick Add (the flagship interaction)**: `Q` anywhere (or the always-visible ＋ button) opens a single text field. **Parsing is local-first**: `chrono-node` runs on every keystroke, so date/time chips render *instantly* as you type. In parallel, the text goes to Claude with a strict Zod schema → `{title, kind, start, end, rrule?, category_guess, course_guess, confidence}`, which reconciles and enriches the chips when it returns (recurrence like "every Monday", category and course guesses — things chrono can't do). One Enter confirms. Hard latency gate in Phase 3: p95 keystroke-to-chips < 1.5 s regardless of API state; if the API is unreachable, the local parse alone is fully usable. **Input with no parseable date isn't rejected or interrogated — it lands in the Inbox** (a `task` with `due_at = null`) with a one-tap "schedule it" path later, so capturing a stray thought never forces a scheduling decision. **Deliberate deviation from the brief** (which says quick add "automatically creates events"): nothing is created without the one-Enter confirm, because a wrong parse should cost one keypress, not a wrong calendar entry — flagged for approval at the Phase 3 gate.
- **Timezone policy**: store UTC, display in the user's timezone setting, expand RRULEs in the event's own `tz`. The one rule that prevents an entire class of bugs. **The browser's own timezone is never consulted** — client views bucket days and wall-clock minutes through the `@/lib/time` profile-tz primitives (`isoDay`, `minutesOfDay`, `timeValue`, `wallClockValue`, `instantFromWallClock`, `fmtIsoDay`), and everything that *writes* a date (quick add, the event sheet, inbox scheduling, drag-and-drop) builds the instant from a profile wall clock. `chrono-node` only thinks in host-local time, so quick-add hands it a reference whose local fields already read as campus time and re-anchors the components it returns. Identical output from Eastern, Pacific, and Tokyo is unit-tested (`tests/unit/time.test.ts`, `tests/unit/quick-add.test.ts`) — without this, an 11:30 PM study block booked on campus renders on the wrong day the moment you fly home.

---

## 7. Notification system

```
reminders (intent) → notification_jobs (materialized ≤60 days out; DB = source of truth)
                          │ nightly cron + scheduler enqueue to QStash ONLY jobs due ≤ 48 h
                          ▼
                     QStash schedule ──signed callback at send_at──▶ /api/notifications/deliver
                          re-check: still due? event exists, not completed/rescheduled? quiet hours?
                          lease (pending → sending) → channel dispatch → sent on provider accept
                                   in-app · push · email · (sms)
```

- **Source of truth is the database; QStash is only the alarm clock.** When an event is created/edited, `scheduler.ts` diffs the desired job set against existing rows: creates/cancels `notification_jobs`, and enqueues to QStash immediately only if `send_at` is within 48 hours (QStash free tier caps scheduled delay at 7 days — the nightly cron tops up the enqueue window). Cancelling deletes the QStash message and marks the row `cancelled`. Rescheduling an event automatically moves its reminders — no orphaned notifications.
- **Delivery is crash-safe and idempotent.** The callback takes a lease (`pending → sending` with `lease_expires_at`), dispatches to the channel, and marks `sent` only after the provider accepts — using provider idempotency keys (e.g. Resend's `Idempotency-Key`) so a retry can't double-send. A duplicate/late QStash delivery finds a non-pending row and no-ops; a crash mid-send leaves an expired lease the sweep reclaims and retries. The event's current state is re-checked at delivery time, so a completed assignment never nags.
- **Quiet hours defer, never drop**: a job landing inside quiet hours is marked deferred and re-enqueued for quiet-hours end.
- **Safety net**: the daily Vercel cron sweeps for `pending` jobs past `send_at` and expired `sending` leases (QStash outage, deploy race, mid-send crash) and re-delivers. Vercel Hobby crons are daily-only — which is exactly why per-minute precision lives in QStash, not cron.
- **Channels** implement one interface (`send(job, event) → ok/fail`): **in-app** (notification bell + toast), **web push** (VAPID; desktop + Android; iOS via installed PWA), **email** (Resend), **SMS** (Twilio — Phase 5 decision; the interface exists from day one, and the decision is framed as a *reliability* question, not just cost, since SMS is the one channel that doesn't depend on a PWA being installed).
- **Cross-channel fallback**: a deadline-critical push left unacknowledged for N minutes automatically falls back to email. Reliability on the phone is the product; a single flaky channel must never be a single point of failure.
- **Anti-fatigue by design**: category defaults attach at most 1–2 reminders per event (the full 8-offset menu exists, but as a menu, not a default); every notification surface carries **snooze** ("again in 30 min · tonight · tomorrow") and a one-tap **"too much — back off"** control that thins future defaults for that category. Ignored notifications train blanket ignoring — the system's job is to stay trustworthy, not loud.
- **Acknowledgment**: tapping/clicking a notification (or completing the item) marks the job `acknowledged`. Unacknowledged + still-incomplete is the input signal for escalation.
- **Escalation (built in Phase 6, once real ignore-rate data exists)**: if the last N reminders for an item were ignored and the deadline is inside the danger window, the policy inserts extra jobs at tighter intervals and promotes channel urgency (in-app → push → email). Hard caps + quiet-hours respect so it motivates rather than harasses. Escalation jobs are flagged, so the system can learn which escalations actually worked.

---

## 8. Analytics system

- **Write path**: normal app usage populates `events`, `occurrences`, `focus_sessions`, `activity_log`. No separate tracking calls to forget.
- **Nightly rollup** (daily cron): computes yesterday's `daily_stats` row and refreshes `user_patterns`. Charts always read pre-aggregated data — the analytics page stays instant no matter how much history accumulates.
- **Productivity score** (0–100): weighted blend of on-time completion rate (40%), focus minutes vs. personal target (25%), habit adherence (20%), and overdue pressure (15%, inverse) — with guardrails so it stays feedback rather than shame-ware: it is computed **weekly**, not as a daily judgment; any component with no underlying data drops out and the weights renormalize (an unused timer is a tracking gap, not a productivity failure); the dashboard tile is **hideable**, and its default presentation is a short "wins + one next action" summary ("everything on time — want a study block tomorrow?") with the number available on tap. The formula lives in one documented, unit-tested function and is always explainable in the UI, framed as next actions, never deficits.
- **Phase 8 charts** (Recharts): weekly timeline, category pie, workload-by-course bars, most/least productive day heatmap, trend lines, semester progress bar. Sleep/exercise tracking enters as `habit` events + focus-session kinds rather than a parallel tracking subsystem.

---

## 9. AI processing pipeline

All calls go through `src/lib/ai/` — one client, one place for retries/timeouts/logging, Zod schemas for every response. Model: **`claude-opus-4-8`** (Anthropic's recommended default; adaptive thinking left on). Every AI write into user data flows through the same server actions as the UI and is tagged with `source`, so it is inspectable and reversible.

Three pipelines:

1. **Quick-add parsing** (interactive, §6). Single structured-output call; strict schema; `chrono-node` offline fallback. Cost ≈ half a cent per parse.
2. **Syllabus extraction** (§11). One document-in, structured-JSON-out call per upload.
3. **Insights engine** (background). The daily cron composes a compact context — next 14 days of events, open tasks, `daily_stats` trends, `user_patterns` — and asks for prioritized suggestions against a fixed taxonomy (study-time suggestions, busy-week predictions, break recommendations, starter-block suggestions for slipping tasks, conflicts, schedule improvements, estimate corrections). **Every insight leads with its one-click action** — the framing is always "here's a move" ("BIO essay keeps slipping — want a 25-minute starter block at 4?"), never a diagnosis; procrastination/ignore-rate vocabulary stays internal. Results land in `ai_insights` with a whitelisted `action` payload so the dashboard renders **one-click Accept**. Volume control: **at most 3 insights per day, delivered as one digest**, and they expire — an assistant that nags gets ignored, which defeats every other feature.

**How it "gets smarter":** `user_patterns` is recomputed nightly from real behavior (estimate accuracy per course, productive hours, ignore rates) and injected into every prompt. Learning is transparent, inspectable data — not hidden model state.

**Rate/cost envelope:** at realistic single-user volume (≈20 quick-adds/day, 1 insights run/day, occasional syllabus) this is well under typical API rate limits and roughly **$3–8/month** at Opus 4.8 pricing ($5/$25 per MTok). If quick-add latency ever feels slow in practice, swapping that one pipeline to a faster model is a one-line, user-approved change — flagged as a decision point in Phase 3.

---

## 10. Design language (implemented fully in Phase 2)

Tokens defined once in `src/styles/tokens.css`, consumed via Tailwind theme:

| Token | Light | Dark |
|---|---|---|
| Background | `#FAF9F5` warm ivory | `#262624` |
| Surface / card | `#FFFFFF` | `#30302E` |
| Text | `#1F1E1D` | `#F5F4EF` |
| Muted text | `#6B6A67` | `#A6A39C` |
| Border | `#E8E6E1` | `#3E3D3A` |
| **Accent** | `#D97757` terracotta (Claude's signature warmth) | same |

- **Type**: serif display face for headings (Lora or Source Serif 4 via `next/font` — self-hosted, no external requests), Inter for UI/body, JetBrains Mono for times/dates. Large default sizes, generous line-height.
- **Shape**: 12–16 px radii, soft low shadows, whitespace over dividers.
- **Category palette** (muted, warm, distinguishable): Class `#6A9BCC` · Homework `#D97757` · Exam `#BF4D43` · Personal `#7D9B76` · Work `#C2A87D` · Practice `#A187BE`. Custom colors allowed.
- **Motion**: 150–200 ms ease-out on everything interactive; drag physics via `motion`; `prefers-reduced-motion` honored globally.
- **Dashboard hierarchy (the 5-second answer)**: the only above-the-fold hero is a **NOW / NEXT band** — the current block with time remaining, and the next thing with a live countdown ("Bio lab · in 40 min") — because "time until next thing" is the single best aid for time blindness. Everything else the brief lists (schedule, deadlines, assignments, habits, timer, calendar preview, score, recent activity) is present but secondary: compact cards below the fold or collapsed, never competing with the answer to "what should I be doing right now?"
- **Keyboard**: `Q` quick add — the one omnibox (no separate ⌘K palette; two summonable text boxes with overlapping jobs is one too many) · `T` today · `1/2/3/4` day/week/month/agenda · `←/→` navigate period · `Space` complete focused item · `?` shortcut overlay.
- **Accessibility**: Radix primitives, visible focus rings, WCAG AA contrast verified for both themes (including event-chip text over category colors), full keyboard reachability.

### Accessibility, as verified in Phase 10

Terracotta is a mid tone. That one fact drives the token layout: `--accent`
(`#d97757`) is only 3.12:1 against white and 4.23:1 against the dark surface,
so it is a **fill and mark colour, never a text colour**, and anything set in
it as text uses `--accent-ink` instead (a darkened terracotta in light, a
lightened one in dark). Text that sits *on* an accent fill is `--accent-text`
= ink, which is the same conclusion `contrastText()` already reached for
category chips — so buttons and chips finally agree. `--danger`, `--warn`, and
`--ok` follow the identical fill/ink split.

Three rules fell out of measuring rather than eyeballing:

- **Never dim text with opacity.** `opacity-50` over `--text-muted` composites
  to 2.05:1. Done, past, and excluded rows recede through colour and
  strike-through instead; opacity is reserved for decorative marks (the
  category dot), which are `aria-hidden` anyway.
- **`--border` is a divider hue, not a control boundary.** At ~1.25:1 it fails
  WCAG 1.4.11 for anything whose edge is the only thing identifying it, so
  inputs, selects, and textareas use `--border-input` (≥3:1 on every surface).
- **The focus ring is drawn in `--accent-ink`**, because `--accent` itself is
  2.96:1 against the light page — under the 3:1 floor for a focus indicator,
  and a focus ring is the one affordance a keyboard user cannot work around.

`tests/unit/tokens.test.ts` checks every ink against every surface in both
themes on each run, so a future palette tweak fails the suite instead of
shipping. Rendered verification is an axe-core pass (WCAG 2.0/2.1/2.2 A + AA)
over a fixture page carrying every real surface, run at 390 / 768 / 1280 px in
both themes: **0 violations**, no horizontal overflow at any width.

Interaction details worth naming: choice groups (`RadioChips` — edit scope,
import course handling) are one tab stop with arrow-key roving, not N tab
stops; every page starts with a **Skip to content** link past the seven nav
links; and every mutation that can fail says so, because a server action that
throws inside `startTransition` otherwise looks exactly like a click that
didn't register (`useActionGuard`).

Target sizes meet WCAG 2.2's 24 px minimum, with one deliberate exception:
**week/day grid chips**, whose height *is* the event's duration — a 15-minute
block that renders 24 px tall would be lying about the schedule. Month-grid
chips have no such constraint and are sized to 24 px.

`docs/CLICK-COUNTS.md` is the companion audit for the ≤3-click rule.

### Payload, as measured in Phase 10

Two libraries dominate the client bundle, and both were in the wrong place:

- **`chrono-node`** backs the instant quick-add chips, and quick-add is
  mounted in the app layout — so every route paid for it. Two changes: import
  `chrono-node/en` instead of the package root (which pulls all fourteen
  locale parsers), and split the dialog *body* into its own chunk behind
  `next/dynamic`. The shell that stays in the layout is just the ＋ button,
  the `Q` key, and the dialog frame.
- **Recharts** is ~105 KB gzipped and lives only on `/analytics`; it now
  loads behind skeletons of the right height, so the KPIs and the score paint
  first and nothing below the charts jumps when they arrive.

The lazy quick-add chunk is warmed on `requestIdleCallback` after first paint
(and again on pointer-enter of the button), so the "chips as you type"
guarantee survives the split: measured **479 ms** from click to a focused
input on a *cold* load that skips the warm entirely, and 221 ms from
keystrokes to chips once loaded — against the Phase 3 gate of 1.5 s.

Critical-path JS for an app route is **~200 KB gzipped**, with neither the
chrono chunk (332 KB raw) nor the Recharts chunk (368 KB raw) in it.

Lighthouse, against the production build: **/login 100 / 100 / 100 / 100**
desktop and **98 / 100 / 100 / 100** mobile (performance / accessibility /
best practices / SEO); a fixture route carrying the dashboard and calendar
components scores **100 desktop, 95 mobile** on performance with LCP 0.6 s,
TBT 0 ms, CLS 0. `/` and `/calendar` themselves can't be scored without a
live database and a real Google sign-in, so those numbers come from the same
components on a reachable route — re-run Lighthouse against the deployed URL
after signing in to confirm.

Re-measure with:

```bash
npx next build && npx next start -p 3000
CHROME_PATH=$(which chromium) npx lighthouse http://127.0.0.1:3000/login \
  --preset=desktop --only-categories=performance,accessibility,best-practices,seo
```

---

## 11. Syllabus parser

```
Upload (PDF · image/screenshot · DOCX)
  → Vercel Blob + syllabus_imports row (status: uploaded)
  → extraction call (status: parsing)
      PDF/image  → sent to claude-opus-4-8 directly as document/image content blocks
      DOCX       → mammoth → text → same call
  → structured result (status: review):
      course {name, code, professor, office_hours, meeting_times, location, confidence each}
      items[] {kind: class_session | assignment | exam | project | reading | lab | holiday,
               title, date(s), recurrence guess, notes, confidence 0–1, source_excerpt}
  → Review screen: table of proposed items; confidence < 0.8 visually flagged;
      per-item edit / accept / reject; nothing exists on the calendar yet
  → Approve → one transaction: create course + events (+ default reminders per kind)
      every row tagged source='syllabus', source_id=import_id
  → Undo: "remove everything from this import" is one query away
```

The `source_excerpt` field (the text span the item came from) makes review trustworthy — you can see *why* Claude thinks the midterm is October 14 before you accept it. The review gate is non-negotiable per the project brief: **nothing reaches the calendar without approval.**

---

## 12. Accessible directly from Claude — the MCP server

`/api/mcp` implements MCP over Streamable HTTP (official TypeScript SDK + `mcp-handler` adapter). Auth is staged to match what Claude clients actually support (§5): **v1 = bearer token → Claude Code** (which supports custom headers) ships first; **claude.ai and Claude Desktop custom connectors require MCP OAuth** (they have no static-header field), which is a scheduled follow-up deliverable. Once connected:

> "What's my day look like?" · "Add gym every Monday at 5" · "Mark the bio homework done" · "When am I free Thursday afternoon?" · "How was my week?"

Initial tool surface (fast, JSON-out, wrapping the same server actions as the UI — expect occasional extra latency from Neon free-tier cold starts after idle):

| Tool | Purpose |
|---|---|
| `get_agenda(date?)` | Today's (or any day's) schedule + due tasks |
| `get_upcoming_deadlines(days?)` | Deadline list with urgency |
| `quick_add(text)` | Same NL pipeline as the in-app quick add |
| `complete_item(id)` / `reschedule_item(id, when)` | Core state changes |
| `get_free_time(range)` | Open-block finder (Phase 9 shares this code) |
| `start_focus_session(...)` / `stop_focus_session()` | Timer control |
| `get_productivity_summary(period)` | Stats + score |

This is the highest-leverage "feels like a Claude product" feature: the calendar becomes something you can *talk to* from any Claude surface, with zero extra UI to build or maintain.

---

## 13. Deployment strategy

**Environments**

| Env | What | Data |
|---|---|---|
| Local dev | `next dev` | Neon dev branch (or Docker Postgres) |
| Preview | Vercel preview per PR/branch push | Neon branch per preview |
| Production | Vercel, `main` branch | Neon main |

**Pipeline**: push → GitHub Actions (typecheck, lint, unit tests, build) → Vercel deploy. **Migration policy: expand/contract (additive-only) schema changes** — Vercel has no release phase that guarantees migrations land before new code serves traffic, so instead of fighting for ordering, every migration must be safe to apply before *or* after the code deploy; destructive contractions wait a full release. `drizzle-kit migrate` runs from the Actions job. Rollback = redeploy previous Vercel build (safe under the same additive rule).

**Nightly background work** (sweep, rollups, `user_patterns`, insights, QStash top-up) is **not one monolithic cron function** — the daily cron kicks off idempotent stages fanned out through QStash self-invocations, each with `maxDuration` pinned, because a single function doing everything (including a Claude call that can run minutes) courts Vercel's function time ceiling. Hobby cron also fires at an arbitrary minute within the scheduled hour — nothing time-precise is allowed to depend on it.

**Environment variables** (`.env.example` checked in): `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID/SECRET`, `ALLOWED_EMAILS`, `ANTHROPIC_API_KEY`, `QSTASH_TOKEN` + signing keys, `RESEND_API_KEY`, `VAPID_PUBLIC/PRIVATE_KEY`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`, (later: `TWILIO_*`).

**Cost budget**

| Service | Tier | Monthly |
|---|---|---|
| Vercel (hosting, blob, daily cron) | Hobby | $0 |
| Neon Postgres | Free | $0 |
| Upstash QStash | Free (1,000 msg/day) | $0 |
| Resend | Free (100 email/day) | $0 |
| Web Push | — | $0 |
| Anthropic API | usage | ~$3–8 |
| Twilio SMS (optional, Phase 5) | usage | ~$1–3 if enabled |

**Backups**: Neon point-in-time restore covers the free tier's window; a weekly GitHub Action runs `pg_dump` to a private artifact for belt-and-suspenders.

**Reliability posture**: the notification path is the only truly time-critical piece, and it degrades gracefully — QStash misses are swept by cron; push failures fall back to email; AI outages never block manual entry (quick add falls back to `chrono-node`; everything has a manual path).

---

## 14. Risks & mitigations

| Risk | Mitigation |
|---|---|
| iOS push requires installed PWA | Onboarding explains "Add to Home Screen"; email is a first-class channel, not an afterthought |
| Recurrence edge cases (DST, "this and future") | All recurrence logic in one pure module with a serious unit-test suite before Phase 3 ships |
| AI parse errors polluting the calendar | Confirm-before-create everywhere; `source` tagging + bulk undo per import |
| Vercel Hobby cron is daily-only | Precise timing delegated to QStash by design; cron only does sweeps/rollups |
| Reminder spam eroding trust | 1–2 default reminders per event, snooze + back-off controls, delivery-time re-checks, quiet hours, escalation caps |
| Auth.js v5 is a beta in maintenance mode (stewardship moved to Better Auth) | Pin the exact beta version; it works today on Next.js 15 with JWT + Google, and the alternative (Better Auth) forces a DB adapter we otherwise don't need. Revisit only if a security fix stalls |
| Neon free tier autosuspends after ~5 min idle → cold-start latency on first query | Acceptable for a personal app; UX absorbs it (local-first quick add, optimistic UI); latency targets stated as steady-state |
| Scope creep across 12 phases | This document + ROADMAP.md are the contract; each phase ends with verification and an explicit go/no-go |
