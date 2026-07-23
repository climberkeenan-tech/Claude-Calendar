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

This applies the checked-in SQL migration (the same one verified against Postgres 16 in CI/dev).

## 6. Sign in

Open your Vercel URL → **Continue with Google**. First sign-in automatically creates your account, settings, and the six default categories. Any other Google account is refused.

---

**Costs after setup:** $0/month for everything except the Claude API key (`ANTHROPIC_API_KEY`), which is pay-per-use — typically a few dollars per semester.
