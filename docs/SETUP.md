# Going live — one-time setup (~15 minutes, all free)

The code is production-ready; these are the accounts only you can create. Do them in order. When you're done, the site is live at your own URL with real Google sign-in.

## 1. Neon (the database) — ~3 min

1. Go to [neon.tech](https://neon.tech) → sign up (free) → **Create project** (name it anything, region `US East (Ohio)` is closest to campus).
2. Copy the **connection string** (starts with `postgres://`).

## 2. Google sign-in — ~5 min

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a project (e.g. "HPU Productivity OS").
2. **APIs & Services → OAuth consent screen**: External, app name, your email; add yourself as a test user. (Publishing status "Testing" is fine — only you sign in.)
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → type **Web application**.
4. Add Authorized redirect URIs (you can add the Vercel one after step 3 when you know your URL):
   - `http://localhost:3000/api/auth/callback/google`
   - `https://YOUR-PROJECT.vercel.app/api/auth/callback/google`
5. Copy the **Client ID** and **Client secret**.

## 3. Vercel (hosting) — ~5 min

1. Go to [vercel.com](https://vercel.com) → sign up with your GitHub account → **Add New → Project** → import `climberkeenan-tech/Claude-Calendar`.
2. Before deploying, open **Environment Variables** and add:

| Name | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string |
| `AUTH_SECRET` | any long random string — run `npx auth secret` locally, or use a password generator (32+ chars) |
| `AUTH_GOOGLE_ID` | Google client ID |
| `AUTH_GOOGLE_SECRET` | Google client secret |
| `ALLOWED_EMAILS` | `climberkeenan@gmail.com` |

3. Deploy. Note your URL (`https://YOUR-PROJECT.vercel.app`) and add it to the Google redirect URIs (step 2.4) if you hadn't.

## 4. Reminders, AI, and file storage — ~7 min

These power push/email reminders (Phase 5), the AI assistant (Phase 6), and syllabus import + attachments (Phase 7). Add each value in Vercel → your project → **Settings → Environment Variables**, then redeploy once at the end.

1. **Upstash QStash** (the reminder alarm clock): [console.upstash.com](https://console.upstash.com) → QStash → copy three values → `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`. Free tier is plenty.
2. **Resend** (reminder emails): [resend.com](https://resend.com) → API Keys → create one → `RESEND_API_KEY`.
3. **Web push keys**: run `npx web-push generate-vapid-keys` in any terminal. Public key goes in **both** `VAPID_PUBLIC_KEY` and `NEXT_PUBLIC_VAPID_PUBLIC_KEY`; private key in `VAPID_PRIVATE_KEY`.
4. **Cron secret**: any long random string → `CRON_SECRET` (protects the nightly maintenance route).
5. **Claude API key** (quick-add parsing, daily digest, syllabus extraction): [console.anthropic.com](https://console.anthropic.com) → API Keys → `ANTHROPIC_API_KEY`. This is the one paid piece — a semester of normal use is a few dollars.
6. **Blob store** (private file storage for syllabi + attachments): in Vercel, open your project → **Storage → Create Database → Blob** → create. Vercel adds `BLOB_READ_WRITE_TOKEN` to the project automatically.

Then **Deployments → ⋯ → Redeploy** so the new variables take effect.

## 5. Create the database tables — ~2 min

On your computer (or any terminal with the repo):

```bash
npm install
DATABASE_URL="<your Neon connection string>" npm run db:migrate
```

This applies every checked-in SQL migration in order (all verified against Postgres 16 in dev). Re-run this same command after pulling any future update that adds a migration — it only applies what's missing.

> If `db:migrate` appears to hang, apply the files directly instead:
> `psql "$DATABASE_URL" -f drizzle/0000_*.sql` and so on, in filename order.

## 6. Sign in

Open your Vercel URL → **Continue with Google**. First sign-in automatically creates your account, settings, and the six default categories. Any other Google account is refused.

## 7. Connect it to Claude and to your other calendars — optional, ~3 min

All of this lives in **Settings** once you're signed in.

**Claude Code** — generate a token under *Claude access (MCP)* and run the
command it shows you.

**claude.ai or Claude Desktop** — add a custom connector pointing at
`https://YOUR-PROJECT.vercel.app/api/mcp`. It registers itself, sends you
through Google sign-in, and asks you to approve. No token to copy. Connections
show up under *Connected apps*, one click to disconnect.

**Your phone's calendar** — copy the link under *Subscribe from another
calendar* and paste it into Google Calendar (*Other calendars → From URL*),
Apple Calendar (*File → New Calendar Subscription*), or Outlook (*Add calendar
→ Subscribe from web*). It's read-only, and anyone with the link can read your
calendar — **Reset link** kills every subscription instantly if it ever leaks.

---

**Costs after setup:** $0/month for everything except the Claude API key (`ANTHROPIC_API_KEY`), which is pay-per-use — typically a few dollars per semester.

---

## Appendix: running the tests

`npm test` needs nothing but the repo — it's the pure-logic suite (recurrence,
timezones, the parser, the score, the ICS builder) and runs anywhere.

`npm run test:integration` needs a throwaway Postgres. It exercises the real
queries against the real schema, which is the half `npm test` deliberately
can't reach.

```bash
# any local Postgres will do; nothing here touches your Neon database
createdb hpos_test
export INTEGRATION_DATABASE_URL="postgres://localhost:5432/hpos_test"

# apply the migrations
for f in drizzle/*.sql; do
  psql "$INTEGRATION_DATABASE_URL" -q -f <(sed 's/--> statement-breakpoint//' "$f")
done

npm run test:integration     # or: npm run test:all
```

The suite TRUNCATEs every table between tests, so point it at a scratch
database and never at anything you care about. It refuses to run rather than
silently testing nothing if the migrations haven't been applied.

You can also run the whole app against that database — a loopback
`DATABASE_URL` automatically switches the client onto a plain `pg` driver
(see ARCHITECTURE.md, "Two test suites"). Google sign-in still applies, so
add your address to `ALLOWED_EMAILS`.

### The UI sweep

`scripts/verify-ui.mjs` walks every route in light and dark, at desktop and
phone widths, runs [axe](https://github.com/dequelabs/axe-core) on each, and
reports anything broken, any accessibility violation, any page that scrolls
sideways, and any console error. It also writes a screenshot per page.

It signs in the way a real Google login does — minting an Auth.js session token
with the app's own `AUTH_SECRET` — so nothing in the app is stubbed or bypassed;
the allowlist, the JWT callbacks and the layout redirect all behave exactly as
they ship. Because it seeds rows, it **refuses to start** unless `DATABASE_URL`
points at a loopback host.

```bash
npm run build && npm start &          # with the local DATABASE_URL from above
npm run verify:runtime                # all six passes, one command
```

Individually, if you want just one:

```bash
node scripts/verify-ui.mjs            # every route, light/dark, phone/desktop, axe
node scripts/smoke-flows.mjs          # quick add, completion, habits, timer, feed
node scripts/smoke-recurring.mjs      # the three recurring edit scopes
node scripts/smoke-reminders.mjs      # reminder jobs survive a re-sync
node scripts/smoke-plan.mjs           # plan accept, undo, replan sweep
node scripts/smoke-import.mjs         # syllabus approve and undo
node scripts/smoke-mcp.mjs            # the MCP protocol surface
```

`smoke-flows.mjs` is the one that catches what the other two can't. Unit tests
and integration tests both pass over a server action that throws the moment
it's invoked — on its first run this script found exactly that, with quick add
returning 500 on every save. It types into the real dialog, confirms, and then
asks the database whether the row it expected is there, with the right kind,
the right title and the right instant.

Restart the server after any rebuild before running either script: `next start`
serves from `.next`, and rebuilding underneath it leaves the running process
pointing at chunks that no longer exist.
