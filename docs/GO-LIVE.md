# Putting it online

Three things to set up. About ten minutes. You need a browser, nothing else —
no terminal, no commands, no code.

At the end you'll have a real web address you can open on your laptop or your
phone, sign into with your Google account, and use.

---

## 1 · Put it on Vercel (about 2 minutes)

1. Go to **https://vercel.com/new**
2. Click **Continue with GitHub** and sign in.
3. Find **claude-calendar** in the list and click **Import**.
4. Don't change any settings. Click **Deploy**.

The first deploy will **fail**. That's expected — it has nowhere to store
anything yet. Steps 2 and 3 fix that.

---

## 2 · Add the database (about 1 minute)

Vercel can make the database for you, so there's no separate signup.

1. In your new project, click the **Storage** tab.
2. Click **Create Database** → choose **Neon** (Serverless Postgres).
3. Pick the free plan and click through. Accept the defaults.

That's it. Vercel fills in the database address for you, and the app creates
all its own tables on the next deploy.

---

## 3 · Turn on Google sign-in (about 5 minutes)

This is the fiddly one. It's what stops anyone but you opening your calendar.

1. Go to **https://console.cloud.google.com/apis/credentials**
2. Sign in with your Google account. If it asks you to make a project, make
   one and call it anything — "High Point OS" is fine.
3. Click **Create credentials** → **OAuth client ID**.
   - If it asks you to "configure a consent screen" first: choose **External**,
     put your own name and email in the boxes it insists on, and save. You do
     not need to publish it or get it verified — you're the only user.
4. For **Application type**, choose **Web application**.
5. Under **Authorized redirect URIs**, click **Add URI** and paste this,
   replacing `YOUR-APP` with your actual Vercel address:

   ```
   https://YOUR-APP.vercel.app/api/auth/callback/google
   ```

   Your Vercel address is at the top of your Vercel project page. It must
   match exactly, including the `https://`.
6. Click **Create**. Google shows you a **Client ID** and a **Client secret**.
   Keep that window open — you need both in the next step.

---

## 4 · Paste in the settings (about 1 minute)

1. In Vercel: **Settings** → **Environment Variables**.
2. There's a box that accepts a whole block at once. Paste the block **I sent
   you in chat** into it, then fill in the two Google values from step 3.

The block looks like this, but with real values where the `...` are:

```
AUTH_SECRET=...
AUTH_GOOGLE_ID=paste-your-client-id-here
AUTH_GOOGLE_SECRET=paste-your-client-secret-here
ALLOWED_EMAILS=climberkeenan@gmail.com
CRON_SECRET=...
VAPID_PUBLIC_KEY=...
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
```

> **Why the real values aren't printed here.** This repository is public —
> anyone on the internet can read this file. `AUTH_SECRET` is what signs your
> login cookie, so anyone holding it could mint a cookie that looks like you
> and walk straight into your calendar. Secrets belong in Vercel's settings
> screen and nowhere else. If you ever need a fresh set, ask me and I'll
> generate them.

`ALLOWED_EMAILS` is the rest of the security model: only addresses on that
list can get in, even though the sign-in button is Google's. Leave it as just
yours.

3. Go to the **Deployments** tab, click the **⋯** menu on the top deployment,
   and choose **Redeploy**.

Wait about two minutes. Then open your address and sign in.

---

## What you get without doing anything else

Everything in the app works at this point: quick add, the calendar, the weekly
plan, habits, the study timer, analytics, and the memory panel in Settings.

## Optional extras, any time later

None of these are needed. Add them if you want them, by putting the key in the
same Environment Variables screen and redeploying.

| You want | Add | Where to get it |
| --- | --- | --- |
| Quick add to understand messier sentences, and syllabus PDF import | `ANTHROPIC_API_KEY` | https://console.anthropic.com |
| Reminder emails | `RESEND_API_KEY` | https://resend.com |
| Reminders that fire while the app is closed | `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | https://console.upstash.com |
| Attaching files to events | `BLOB_READ_WRITE_TOKEN` | Vercel → Storage → Blob |

Without the Anthropic key, quick add still works — it falls back to a parser
built into the app. That's deliberate, not a bug.

---

## If something goes wrong

**The deploy failed.** Open the failed deploy and read the last few red lines.
If it mentions `DATABASE_URL`, step 2 didn't finish — go back and add the Neon
database, then redeploy.

**"Access blocked" or "redirect_uri_mismatch" when you sign in.** The address
in step 3.5 doesn't exactly match your real one. Compare them character by
character — a missing `https://` or a trailing `/` is enough to break it.

**You sign in and get bounced straight back out.** Your Google address isn't
on `ALLOWED_EMAILS`, or it's spelled differently. Fix it and redeploy.

**Pages load but everything is empty.** That's correct on day one — it's your
planner, and it starts empty. Press **Q** or the **Quick add** button and type
something like "lab report due friday 5pm".

Stuck on any of it — tell me which step and what you see, and I'll sort it.
