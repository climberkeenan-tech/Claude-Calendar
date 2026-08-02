# High Point University Productivity OS

A personal planner for one student at High Point University, built around ADHD:
capture in two clicks, never lie about state, and never punish someone for doing
the right thing. If you are a new session picking this up, read this file first,
then `docs/ARCHITECTURE.md`.

## Standing rules from the owner

- **This is a real, working site — not a demo.** No fake seeded data, no auth
  bypasses, no "for illustration" scaffolding. Sign-in is real, the database is
  real, the deploy is real.
  - Two real doors, both off unless configured: Google OAuth
    (`AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`) and an owner password
    (`OWNER_PASSWORD_HASH`, scrypt, constant-time compare, see
    `src/lib/owner-password.ts`). The password exists because a Google client
    needs a redirect URI you can't know until the site is already deployed,
    which locked the owner out of his own first deploy. It is a credential,
    **not** a bypass — but it is weaker than Google (no second factor), so
    don't quietly make it the default or extend it to more accounts. Unset the
    variable and the provider is never registered at all.
- **Reliability over speed. Ease of use over technical impressiveness.**
- It should feel like an official Claude companion: warm neutrals, terracotta
  accent (`#d97757`), Lora / Inter / JetBrains Mono.
- Every common action stays within three clicks — `docs/CLICK-COUNTS.md` is the
  receipt, and five of its rows are checked mechanically by the smoke scripts.
- **Explain things plainly.** The owner is not a developer. Short answers, no
  jargon, say what changed and what it means for them.

## Invariants that are easy to break

These each caused a real bug. Breaking one is silent — nothing fails loudly.

1. **Kind invariant.** Tasks live on `dueAt` only; events and habits on
   `startsAt`/`endsAt`. A task with a `startsAt` renders twice.
2. **`endsAt` is exclusive.** An all-day event runs to the NEXT local midnight.
   Window predicates use `end > windowStart || start >= windowStart` — never
   `>=` on the end alone, or yesterday leaks into today.
3. **Floating time.** `rrule`'s TZID handling is DST-buggy, so wall clocks are
   stored as fake-UTC and converted at the boundary (`src/lib/tz.ts`). A value
   ending in `Z` inside an `rrule` is a WALL CLOCK, not UTC — the ICS feed has
   to convert it on the way out.
4. **The browser's timezone is never consulted.** Everything goes through the
   profile-timezone helpers in `src/lib/time.ts`.
5. **`db.batch` is the only atomic unit.** `db.transaction` throws on the
   neon-http driver. Every read must happen BEFORE the first write so a
   multi-row change can go out as one batch.
6. **Never `export type { X }` from a `"use server"` file.** Next's action
   transform leaves it as a runtime reference and the whole module throws when
   called. This shipped once, and quick add returned 500 on every save while
   284 tests passed.

## Verifying a change

Three layers, and the third is the one that matters:

```bash
npm test                 # pure logic, needs nothing
npm run test:integration # real queries against a local Postgres
npm run verify:runtime   # the built app in a real browser (see docs/SETUP.md)
```

The first two cannot catch a server action that throws when invoked, because
nothing calls it. `verify:runtime` clicks through every route and every server
action and then asks the database whether it agrees. Run it for anything that
touches a server action, a query, or a page.

`src/lib/db/client.ts` picks its driver by hostname: a loopback `DATABASE_URL`
gets plain `pg` so the app can run locally; anything else gets `neon-http`
exactly as production does. Restart the server after any rebuild — `next start`
serves from `.next` and rebuilding underneath it breaks the running process.

## Where things are

- `src/lib/**` — pure logic, unit-tested. `src/server/**` — server actions.
- Shared cores (`src/lib/items/*`, `src/lib/scheduling/*`, `src/lib/analytics/*`,
  `src/lib/memory/*`) are used by BOTH the UI and the MCP tools, so "using the
  app" and "asking Claude" can never drift apart. Keep it that way.
- Memory has two halves. `user_patterns` is DERIVED nightly from behaviour;
  `memories` is TOLD, and every told row must stay visible and deletable in
  Settings. A memory the owner can't see or remove isn't a feature, it's a
  surprise.
- `scripts/` — dev-only verification tooling. Never imported by the app; every
  script refuses to run against a non-loopback database because they all write.
- `docs/SETUP.md` — deploying it, and running the checks locally.

## Deliberately not done

- Not deployed by the assistant: that needs the owner's Vercel, Neon and Google
  accounts. `docs/SETUP.md` has the steps.
- `ANTHROPIC_API_KEY` is optional. Without it, quick add falls back to the local
  parser and syllabus import is unavailable. That degradation is intentional and
  tested — don't "fix" it by making the key required.
- SMS is deferred. Push and email are the live channels.
