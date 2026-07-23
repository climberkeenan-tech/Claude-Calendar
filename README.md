# High Point Productivity OS

A personal productivity system for organizing academic and personal life at High Point University — built to feel like an official Claude companion app: calm, warm, fast, and designed for a brain that doesn't want to fight its tools.

> **Status: Phase 1 complete (Project Planning).** No application code exists yet — by design. The development rules for this project require finishing and verifying one phase at a time.

## What this will be

- A **calendar + task system** with day/week/month/agenda views, drag-and-drop, recurring events, and color categories.
- A **natural-language quick add** — type "Study Biology tomorrow at 7 PM", watch the parsed chips appear as you type, press Enter once, and the event exists.
- A **syllabus importer** — upload a PDF/image/DOCX syllabus, review what Claude extracted, approve, and the whole semester lands on the calendar.
- A **reminder system** (push, email, in-app, optional SMS) that escalates intelligently when reminders are ignored.
- An **AI assistant** powered by the Claude API that suggests study times, detects conflicts and procrastination, and learns habits over time.
- An **analytics dashboard** that answers "how am I actually doing?" at a glance.
- **Accessible directly from Claude**: a built-in MCP server lets claude.ai, Claude Desktop, and Claude Code read and manage the calendar in conversation.

## Design principles

1. **The dashboard answers one question: "What should I be doing right now?"** — a NOW/NEXT hero with a live countdown to the next thing; everything else is secondary.
2. **Three clicks maximum** for any common action; one keystroke for the most common (`Q` = quick add).
3. **Easier-to-use beats technically-impressive** on every design decision.
4. **Reliability over speed of development.** Each phase is verified before the next begins.
5. **Claude's visual language**: warm ivory neutrals, terracotta accent, serif display type, rounded corners, minimal chrome.

## Documentation

| Document | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Full system architecture: stack, folder structure, database schema, auth, calendar engine, notifications, analytics, AI pipeline, syllabus parser, MCP server, deployment |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | The 12 development phases, each with concrete deliverables and a verification checklist |

## Development phases

| Phase | Name | Status |
|---|---|---|
| 1 | Project Planning | ✅ Complete |
| 2 | UI Design (design system + app shell + dashboard) | ⬜ |
| 3 | Calendar System | ⬜ |
| 4 | Event Management | ⬜ |
| 5 | Reminder System | ⬜ |
| 6 | AI Assistant | ⬜ |
| 7 | Syllabus Import | ⬜ |
| 8 | Analytics Dashboard | ⬜ |
| 9 | Smart Time Management | ⬜ |
| 10 | User Experience polish pass | ⬜ |
| 11 | Future Integrations (architecture hooks) | ⬜ |
| 12 | Final Polish + docs + testing checklist | ⬜ |

## Planned stack (summary)

Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · Neon Postgres + Drizzle ORM · Auth.js (Google sign-in) · Anthropic API (`claude-opus-4-8`) · Vercel hosting · Upstash QStash (reminder delivery) · Resend (email) · Web Push · MCP server at `/api/mcp`

Runs on free tiers end-to-end; the only ongoing cost is Claude API usage (estimated a few dollars per month). Details and rationale in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
