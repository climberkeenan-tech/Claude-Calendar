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
| Recurrence | **RFC 5545 RRULEs stored on the event, expanded at query time** (`rrule` library) | Materializing every occurrence as rows — write amplification, edit/rescheduling nightmares |
| Reminder timing | **`notification_jobs` table as source of truth + QStash scheduled callback per job; daily cron as sweep/safety net** | Vercel Cron alone — Hobby tier crons run at most daily, useless for "15 minutes before class"; a persistent worker server — a second deployment to babysit |
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
| Auth | Auth.js v5 (NextAuth), Google OAuth, JWT session strategy | No database adapter needed; allowlist check in the `signIn` callback |
| AI | `@anthropic-ai/sdk`, model `claude-opus-4-8` | Structured outputs via `zodOutputFormat`; PDFs/images sent directly as content blocks |
| File storage | Vercel Blob | Syllabus uploads + event attachments |
| Email | Resend | Free tier 100/day |
| Push | Web Push (VAPID) via `web-push` + a service worker | Works on desktop browsers and Android; iOS requires the PWA installed to the home screen (iOS 16.4+) — email is the fallback channel |
| SMS | Twilio (Phase 5, optional — costs real money) | Channel abstraction means adding it later touches one file |
| Scheduled delivery | Upstash QStash (signed HTTP callbacks at a scheduled time) | Free tier 500 messages/day; a heavy day needs ~30 |
| Dates | `date-fns` + `date-fns-tz`; `rrule` for recurrence | All storage in UTC; display timezone `America/New_York` (configurable in settings) |
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
| kind | `'event'` (time-blocked) · `'task'` (deadline-driven: assignments, homework) · `'habit'` (recurring, streak-tracked) |
| category_id, course_id, location | course nullable |
| starts_at, ends_at, all_day | for `event`/`habit`; nullable for pure tasks |
| due_at | for `task`; the deadline shown in Upcoming Deadlines |
| rrule, rrule_until, tz | RFC 5545 string for recurring events/habits; null = one-off |
| priority | `low · normal · high · critical` |
| estimated_minutes, actual_minutes | Phase 4/6: estimate-accuracy learning |
| tags | `text[]` |
| status, completed_at | `scheduled · completed · cancelled` |
| source, source_id | `manual · quick_add · syllabus · ai_suggestion · integration` — every AI-created row is traceable and bulk-undoable |

**`occurrences`** — per-instance state for recurring events. Row exists only when an instance deviates from the series: (event_id, occurrence_date) PK, cancelled flag, completed flag + completed_at (this is also how habit streaks are computed), overrides (jsonb patch: moved time, changed location, etc.).

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
- **`daily_stats`** — date PK + rolled-up columns: minutes_studied, minutes_by_category (jsonb), tasks_completed, tasks_completed_late, tasks_overdue, focus_session_count, productivity_score. Recomputed nightly; charts read this, never raw tables.
- **`user_patterns`** (one row, jsonb) — nightly-derived: estimate-accuracy ratio per course, completion-rate-by-hour histogram, reminder ignore rates, typical busy windows. Injected into AI prompts — the "gets smarter over time" mechanism is structured data, not model fine-tuning.
- **`ai_insights`** — kind (`study_suggestion · conflict · procrastination · busy_week_warning · schedule_improvement · time_estimate`), title, body, confidence, action (jsonb — a machine-applicable payload naming a server action + args, enabling one-click accept), status (`new · accepted · dismissed`), created_at, expires_at.

### Import & access

- **`syllabus_imports`** — blob_url, filename, mime, status (`uploaded · parsing · review · approved · failed`), course_id?, extraction (jsonb — full structured result with per-item confidence), model, error, created_at.
- **`api_tokens`** — name (`"claude.ai connector"`), token_hash (SHA-256; plaintext shown once), last_used_at, revoked_at. Auth for the MCP server.

### Recurrence model (how repeat rules actually work)

1. A recurring event is **one row** with an `rrule` (`FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261211T000000Z`).
2. Any calendar query expands rules **server-side within the visible window** using the `rrule` library — pure function, heavily unit-tested, including DST boundaries (America/New_York has two per year).
3. "Edit this occurrence" writes an `occurrences` override row; "edit whole series" edits the parent; "this and future" splits the series (old row gets `UNTIL`, new row starts at the split). These are the only three edit modes — matching what every mainstream calendar trains users to expect.
4. Reminder jobs for recurring events are materialized on a **60-day rolling horizon** by the nightly cron, so QStash never needs to know about infinity.

---

## 5. Authentication

- **Auth.js v5** with the Google provider only. The `signIn` callback rejects any email not in the `ALLOWED_EMAILS` env var. One tap to sign in, nothing to remember, and the app is private even though it's on the public internet.
- **JWT session strategy** — no session table, no DB adapter; fewer moving parts.
- Middleware protects everything under `(app)/` and `/api/*` except: the auth routes, `/api/notifications/deliver` (QStash signature verification instead), `/api/cron/*` (Vercel cron secret header), and `/api/mcp` (bearer token, below).
- **MCP access tokens**: generated in Settings, stored hashed in `api_tokens`, sent as `Authorization: Bearer` by Claude clients. Revocable individually. This keeps human auth (Google) and machine auth (tokens) cleanly separated.

---

## 6. Calendar architecture

- **Views**: Day, Week (default), Month, Agenda. One shared data hook (`useCalendarWindow(start, end)`) feeds all four; a server query returns expanded occurrences + tasks-due + habits in the window in a single round trip.
- **Rendering**: CSS-grid time grid. Events are absolutely positioned chips; overlap resolution (side-by-side columns) is a pure function with unit tests.
- **Drag & drop**: move (drag), resize (drag edges), and drag-from-task-list-to-calendar (turns a deadline task into a scheduled work block — Phase 9's manual precursor). Server action commits on drop; optimistic UI with rollback on failure. 15-minute snap.
- **Quick Add (the flagship interaction)**: `Q` anywhere (or the always-visible ＋ button) opens a single text field. Input goes to `claude-opus-4-8` with a strict Zod schema → `{title, kind, start, end, rrule?, category_guess, course_guess, confidence}`. The parsed result renders as **editable chips** (date, time, category) in the same box — one Enter to confirm. Sub-second perceived latency via optimistic chip rendering; if the API is unreachable, `chrono-node` parses dates offline and the user picks the category manually. Nothing is ever created without the confirm step, so a wrong parse costs one click, not a wrong calendar entry.
- **Timezone policy**: store UTC, display in the user's timezone setting, expand RRULEs in the event's own `tz`. The one rule that prevents an entire class of bugs.

---

## 7. Notification system

```
reminders (intent)  →  notification_jobs (materialized, send_at)  →  QStash schedule
                                                                        │ signed callback at send_at
                                                                        ▼
                                                        /api/notifications/deliver
                                                                        │ re-check: still pending? event still exists,
                                                                        │ not completed, not rescheduled? quiet hours?
                                                                        ▼
                                                     channel dispatch: in-app · push · email · (sms)
```

- **Source of truth is the database.** When an event is created/edited, `scheduler.ts` diffs the desired job set against existing rows: creates new jobs (+ QStash schedule per job), cancels stale ones (delete QStash message, mark row `cancelled`). Rescheduling an event automatically moves its reminders — no orphaned notifications.
- **Delivery is idempotent.** The callback transitions `pending → sent` atomically; a duplicate or late QStash delivery finds a non-pending row and no-ops. The event's current state is re-checked at delivery time, so a completed assignment never nags.
- **Safety net**: the daily Vercel cron sweeps for `pending` jobs whose `send_at` slipped past (QStash outage, deploy race) and delivers or re-schedules them. Vercel Hobby crons are daily-only — which is exactly why per-minute precision lives in QStash, not cron.
- **Channels** implement one interface (`send(job, event) → ok/fail`): **in-app** (notification bell + toast), **web push** (VAPID; desktop + Android; iOS via installed PWA), **email** (Resend), **SMS** (Twilio — Phase 5 decision, since it's the only channel that costs money per message; the interface exists from day one).
- **Acknowledgment**: tapping/clicking a notification (or completing the item) marks the job `acknowledged`. Unacknowledged + still-incomplete is the signal for…
- **Escalation (Phase 5/6)**: if the last N reminders for an item were ignored and the deadline is inside the danger window, the escalation policy inserts extra jobs at tighter intervals and promotes channel urgency (in-app → push → email). Hard caps + quiet-hours respect so it motivates rather than harasses. All escalation jobs are flagged, so the AI can later learn which escalations actually worked.

---

## 8. Analytics system

- **Write path**: normal app usage populates `events`, `occurrences`, `focus_sessions`, `activity_log`. No separate tracking calls to forget.
- **Nightly rollup** (daily cron): computes yesterday's `daily_stats` row and refreshes `user_patterns`. Charts always read pre-aggregated data — the analytics page stays instant no matter how much history accumulates.
- **Productivity score** (0–100, shown on the dashboard): weighted blend of on-time completion rate (40%), focus minutes vs. personal target (25%), habit adherence (20%), and overdue pressure (15%, inverse). The formula lives in one documented, unit-tested function — the score must be **explainable in the UI** ("87 — strong: everything on time, light on study minutes"), never a mystery number, or it becomes anxiety fuel instead of feedback.
- **Phase 8 charts** (Recharts): weekly timeline, category pie, workload-by-course bars, most/least productive day heatmap, trend lines, semester progress bar. Sleep/exercise tracking enters as `habit` events + focus-session kinds rather than a parallel tracking subsystem.

---

## 9. AI processing pipeline

All calls go through `src/lib/ai/` — one client, one place for retries/timeouts/logging, Zod schemas for every response. Model: **`claude-opus-4-8`** (Anthropic's recommended default; adaptive thinking left on). Every AI write into user data flows through the same server actions as the UI and is tagged with `source`, so it is inspectable and reversible.

Three pipelines:

1. **Quick-add parsing** (interactive, §6). Single structured-output call; strict schema; `chrono-node` offline fallback. Cost ≈ half a cent per parse.
2. **Syllabus extraction** (§11). One document-in, structured-JSON-out call per upload.
3. **Insights engine** (background). The daily cron composes a compact context — next 14 days of events, open tasks, `daily_stats` trends, `user_patterns` — and asks for prioritized suggestions against a fixed taxonomy (study-time suggestions, busy-week predictions, break recommendations, procrastination flags, conflicts, schedule improvements, estimate corrections). Results land in `ai_insights`, each carrying an `action` payload (server action + args) so the dashboard renders **one-click Accept**. Insights expire; stale advice self-deletes. Volume control: suggestions are capped per day — an assistant that nags gets ignored, which defeats every other feature.

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
- **Keyboard**: `Q` quick add · `T` today · `1/2/3/4` day/week/month/agenda · `←/→` navigate period · `⌘K` command palette · `Space` complete focused item · `?` shortcut overlay.
- **Accessibility**: Radix primitives, visible focus rings, WCAG AA contrast verified for both themes (including event-chip text over category colors), full keyboard reachability.

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

`/api/mcp` implements MCP over Streamable HTTP (official TypeScript SDK + `mcp-handler` adapter), authenticated by bearer token (§5). Add it once as a custom connector in claude.ai / Claude Desktop / Claude Code, then:

> "What's my day look like?" · "Add gym every Monday at 5" · "Mark the bio homework done" · "When am I free Thursday afternoon?" · "How was my week?"

Initial tool surface (each ≤ ~1 s, JSON-out, wrapping the same server actions as the UI):

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

**Pipeline**: push → GitHub Actions (typecheck, lint, unit tests, build) → Vercel deploy. Drizzle migrations run via a release step (`drizzle-kit migrate`) before traffic hits new code. Rollback = redeploy previous Vercel build (schema changes stay additive between phases to keep rollback safe).

**Environment variables** (`.env.example` checked in): `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID/SECRET`, `ALLOWED_EMAILS`, `ANTHROPIC_API_KEY`, `QSTASH_TOKEN` + signing keys, `RESEND_API_KEY`, `VAPID_PUBLIC/PRIVATE_KEY`, `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`, (later: `TWILIO_*`).

**Cost budget**

| Service | Tier | Monthly |
|---|---|---|
| Vercel (hosting, blob, daily cron) | Hobby | $0 |
| Neon Postgres | Free | $0 |
| Upstash QStash | Free (500 msg/day) | $0 |
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
| Reminder spam eroding trust | Delivery-time re-checks, quiet hours, escalation caps, per-category defaults |
| Scope creep across 12 phases | This document + ROADMAP.md are the contract; each phase ends with verification and an explicit go/no-go |
