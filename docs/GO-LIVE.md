# Putting it online

One link, about five minutes, all in a browser. No terminal, no commands.

At the end you have a real web address you can open on your laptop or phone,
sign into, and use.

Google sign-in is **not** required to get going — there's a password door as
well, and setting that up takes one paste instead of a trip through the Google
Cloud Console. [Add Google later](#adding-google-sign-in-later) if you want it.

---

## 1 · Deploy it (about 4 minutes)

[**Click here to deploy**](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fclimberkeenan-tech%2FClaude-Calendar&project-name=high-point-os&repository-name=high-point-os&env=AUTH_SECRET%2COWNER_PASSWORD_HASH%2CALLOWED_EMAILS%2CCRON_SECRET&envDescription=Paste+the+four+values+from+the+chat.+They+are+not+in+the+repo+on+purpose.&envLink=https%3A%2F%2Fgithub.com%2Fclimberkeenan-tech%2FClaude-Calendar%2Fblob%2Fclaude%2Fhigh-point-productivity-os-9c8yq3%2Fdocs%2FGO-LIVE.md&products=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%5D)

That one link carries everything: the repository, the database, and the list
of settings to ask you for.

1. **Sign in with GitHub.**
2. **Add the database.** It offers Neon (Postgres) already picked out —
   choose the free plan and click through. You don't sign up for anything
   separately, and you never see a connection string.
3. **Paste four settings** when it asks: `AUTH_SECRET`,
   `OWNER_PASSWORD_HASH`, `ALLOWED_EMAILS`, `CRON_SECRET`. They're in the
   chat. They are deliberately not in this repo — it's public.
4. **Deploy.**

Two to three minutes later, open the address it gives you and type your
password. You're in.

The app creates all its own tables during that deploy, so there is nothing to
run and nothing to migrate — not now, and not when a later update adds
something.

> **If the link misbehaves**, do it by hand: **https://vercel.com/new** → sign
> in with GitHub → import **Claude-Calendar** → Deploy. That first deploy
> fails, because there's no database yet. Then open the project's **Storage**
> tab → **Create Database** → **Neon** → free plan, add the four settings
> under **Settings → Environment Variables**, and **Redeploy**. Same
> destination, a few more clicks.

---

## What you get

Everything: quick add, the calendar, assignments, plan-my-week, habits, the
study timer, analytics, and the memory panel in Settings.

`ALLOWED_EMAILS` is the account the password signs you in as, and it's also
the allowlist — if you add Google later, only addresses on that list can get
in. Leave it as just yours.

---

## Adding Google sign-in later

Optional. The password already works; this just adds the Google button next to
it. Do it once you know your Vercel address, because Google needs it.

1. **https://console.cloud.google.com/apis/credentials** → make a project if
   it asks.
2. **Create credentials** → **OAuth client ID**. If it makes you configure a
   consent screen first: **External**, fill the required boxes with your own
   name and email, save. You don't need to publish or verify it — you're the
   only user.
3. Application type **Web application**. Under **Authorized redirect URIs**,
   add this with your real address:

   ```
   https://YOUR-APP.vercel.app/api/auth/callback/google
   ```

   It must match exactly — `https://`, no trailing slash.
4. Copy the **Client ID** and **Client secret** into Vercel → Settings →
   Environment Variables as `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`, then
   redeploy.

The Google button appears on the login page on its own once both are set. If
they aren't set, it stays hidden rather than showing a button that can't work.

---

## Changing your password

```bash
npm run make-password
```

Prints a new password and its hash. Put the hash in `OWNER_PASSWORD_HASH` and
redeploy. To turn the password door off entirely, delete that variable — the
form disappears and Google becomes the only way in.

The password itself is never stored, only a scrypt hash of it. Lose it and you
make a new one; nobody can recover the old one, including me.

---

## Optional extras, any time later

None of these are needed. Add the key in the same Environment Variables screen
and redeploy.

| You want | Add | Where to get it |
| --- | --- | --- |
| Quick add to understand messier sentences, and syllabus PDF import | `ANTHROPIC_API_KEY` | https://console.anthropic.com |
| Reminder emails | `RESEND_API_KEY` | https://resend.com |
| Reminders that fire while the app is closed | `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | https://console.upstash.com |
| Attaching files to events | `BLOB_READ_WRITE_TOKEN` | Vercel → Storage → Blob |
| Web push notifications | `VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | ask me, or `npx web-push generate-vapid-keys` |

Without the Anthropic key, quick add still works — it falls back to a parser
built into the app. That's deliberate, not a bug.

---

## If something goes wrong

**The first deploy failed.** Expected — see step 2. If it still fails after
adding the database, open the failed deploy and read the last few red lines.
If it mentions `DATABASE_URL`, the Neon step didn't finish.

**The login page says "No way to sign in yet."** `OWNER_PASSWORD_HASH` is
missing or got mangled. Check it in Vercel — it should start with `scrypt:`
and have five colons in it. If you pasted it somewhere that ate characters,
run `npm run make-password` and use a fresh one.

**Your password doesn't work.** It's case-sensitive and includes the hyphens.
After ten wrong tries it stops accepting attempts for fifteen minutes.

**"redirect_uri_mismatch" on the Google button.** The address in the Google
console doesn't exactly match your real one. Compare character by character.

**Pages load but everything is empty.** Correct on day one — it's your
planner and it starts empty. Press **Q** or the **Quick add** button and type
something like "lab report due friday 5pm".

Stuck — tell me the step and what you see, and I'll sort it.
