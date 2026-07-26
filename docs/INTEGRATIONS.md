# Integrations

What's built, what's worth building next, and what isn't — with the reasoning,
so a future decision doesn't have to re-derive it.

The standing rule from the architecture: **the sync-adapter abstraction gets
designed when the first real two-way integration is chosen, not before.** One
concrete integration teaches more about the right shape than any amount of
up-front generalising.

---

## Shipped

### ICS subscription feed (outbound, read-only)

`Settings → Subscribe from another calendar` gives a URL that Google Calendar,
Apple Calendar, and Outlook can subscribe to. Events, habits, and deadlines
flow out; nothing flows back.

| | |
|---|---|
| Direction | One-way, out |
| Auth | A 24-byte token in the URL — calendar clients can't send headers, so the capability has to live in the link |
| Revocation | **Reset link** in Settings; instantly breaks every existing subscription |
| Window | Non-recurring items −90 to +365 days. Recurring series always included — the RRULE travels with them |
| Recurrence | Passed through as `RRULE`, so the subscriber expands it. Cancelled occurrences become `EXDATE`; edited ones become a second `VEVENT` with the same `UID` and a `RECURRENCE-ID` |
| Timezones | `TZID` plus a generated `VTIMEZONE`, never UTC — a UTC-anchored `RRULE` drifts an hour at every DST change |
| Tasks | All-day banners on the due date, marked `TRANSP:TRANSPARENT`. Not `VTODO`: Google Calendar ignores `VTODO` entirely |
| Refresh | Advertised as `PT1H`. Google honours it loosely (expect a few hours); Apple can poll as often as every five minutes |

**Known limits, stated plainly.** Anyone with the link can read the calendar —
it's a bearer credential, which is inherent to how calendar subscriptions work
everywhere. Subscribed calendars are read-only in every client; edits still
happen in the app. And the feed is a snapshot on a poll, so a change made now
appears on the phone whenever that client next fetches, not instantly.

### MCP over OAuth (Claude, two-way)

Claude Code has connected with a personal bearer token since Phase 6. Phase 11
added the OAuth 2.1 authorization server that **claude.ai and Claude Desktop
custom connectors** require, since those clients register themselves and can't
be handed a token.

- Discovery: `/.well-known/oauth-authorization-server` (RFC 8414) and
  `/.well-known/oauth-protected-resource` (RFC 9728, served at both the root
  and the resource-specific path).
- Registration: `POST /api/oauth/register` (RFC 7591). Open by necessity —
  a connector registers itself the moment you add it. Registration alone grants
  nothing: every client still sends the user through consent, and only the
  allowlisted Google account can approve.
- Authorization: `/oauth/authorize` — a consent screen behind the normal Google
  sign-in. PKCE S256 mandatory; `plain` refused. An unknown client or an
  unregistered `redirect_uri` is a dead end on this site, never a redirect.
- Token: `POST /api/oauth/token`. Codes are single-use (claimed with a
  conditional `UPDATE`, so a replay racing the real exchange still loses),
  five-minute TTL, bound to client + redirect URI + challenge. Access tokens
  last an hour; refresh tokens rotate.
- Management: `Settings → Connected apps`, one click to disconnect, which
  revokes every token that client holds.

Both token types reach the same MCP tools, and every tool wraps the same shared
cores the UI uses — Claude can never quote a number the page disagrees with.

*Note on RFC 8707 `resource`:* it's recorded on codes and tokens but not
enforced, because this authorization server protects exactly one resource. A
token it mints is redeemable only at that resource, so there's no second
audience to confuse. If a second protected resource is ever added, this becomes
a real check and the field is already there.

---

## Evaluated: Canvas → this app (inbound coursework)

**Recommendation: GO**, as a one-way ICS import. It's the cheapest real
integration available and the only one that needs nothing from HPU's IT.

### Why ICS and not the Canvas API

The Canvas REST API is the richer path, and it's blocked in practice: on
Canvas Cloud, developer keys are issued by the **institution's admin**, and
institutions treat them as reserved for pre-approved, critical integrations.
A personal project doesn't get one, and a manually generated access token
can't be used by an app serving a user other than the person who made it.

The per-user calendar feed needs none of that. Every Canvas user has one at
`Calendar → Calendar Feed`, and pasting it into this app is the whole setup.

### What the Canvas feed actually contains

- Events **and assignments** from every course the student is in, plus their
  personal Canvas calendar and any appointment groups.
- **Course names are already in the item titles** — which means course mapping
  is a string match, not a lookup.
- **Excluded: Canvas "To Do" items.** Anything a student only tracks as a To Do
  won't arrive.
- Window: future events to **366 days**, past events to **30 days**, capped at
  **1,000 items**.

### What building it would take

Roughly a day, and most of the pieces already exist:

1. **A parser.** The app writes ICS but doesn't read it. `ical.js` is already a
   dev dependency for validating our own output and would move to a runtime
   dependency. It handles the parts a hand-rolled parser gets wrong — folding,
   `TZID` resolution, `RRULE` expansion, `RECURRENCE-ID`.
2. **A field mapping.** Canvas assignments → `kind: "task"` with `dueAt`;
   Canvas events → `kind: "event"`. `source: "integration"` and
   `sourceId: <Canvas UID>` already exist on `events`, which gives idempotent
   re-import and one-click undo for free — the same machinery syllabus import
   uses.
3. **A poll.** The nightly cron already runs; add a fetch-and-diff pass.
   Deleted-in-Canvas → cancel here; changed due date → update, unless the user
   edited it locally (last-writer-wins would silently undo their reschedule, so
   local edits must win).
4. **A review step.** Same shape as syllabus import: nothing lands on the
   calendar without a look. An LMS feed with a wrong due date should cost one
   glance, not a missed deadline.

### The honest downsides

- **The feed URL is a bearer secret** for the student's whole Canvas calendar.
  Storing it means storing a credential; it would need the same treatment as
  the outbound feed token, and resetting it in Canvas silently breaks the
  import until it's re-pasted.
- **One-way only.** Marking an assignment done here will never mark it done in
  Canvas. That has to be said in the UI or it becomes a trust bug.
- **Instructor-dependent quality.** A syllabus deadline that never got entered
  into Canvas isn't in the feed. Syllabus import stays the primary path;
  Canvas is the thing that keeps it current afterwards.
- **1,000-item cap** — irrelevant for one semester, worth knowing.

### Verdict

Build it after v1.0, as the first integration. It gives the single highest-value
inbound data (real, current due dates) for the lowest cost, and it validates
the sync-adapter shape against a real system before that abstraction is
committed to.

---

## The rest of the candidate list

Assessed against the same bar: what does it cost, and what does it actually
change about a Tuesday?

### Google Calendar (two-way) — **defer**

Reading is already solved in the useful direction: the ICS feed puts this app's
data *into* Google. The genuinely valuable direction is pulling non-academic
commitments (work shifts, family events) *in*, so free-time finding and "plan
my week" account for them.

Cost is real: a Google Cloud project with Calendar scopes, OAuth consent
screen verification (sensitive scopes need a review to leave testing mode),
webhook channels that expire and need renewing, and a sync-token loop. Two-way
adds conflict resolution, which is where every calendar sync project gets hard.

**Cheaper first step, and the one to take:** support subscribing to *external*
ICS URLs inbound — the same parser the Canvas work needs. Google, Outlook, and
Apple all publish private ICS URLs. That gets 80% of the value for ~0% of the
OAuth cost, and it's read-only, so no conflict resolution.

### Apple Calendar / Outlook (two-way) — **no**

Both are already covered outbound by subscription. Two-way means CalDAV
(app-specific passwords, fragile) or Microsoft Graph (its own app registration
and consent). The inbound ICS path above covers the same ground for a fraction
of the work.

### Blackboard / Brightspace — **not applicable**

HPU runs Canvas. Written down only so a future reader doesn't re-investigate:
both expose similar per-user feeds, and the ICS-import work would carry over
almost unchanged if the LMS ever changed.

### Notion, Todoist — **no**

Both are task managers, and this app is a task manager. Syncing two task
systems means picking which one is the truth, and the honest answer for a
single user is "pick one." If the answer is Notion, this app shouldn't exist;
if it's this app, the integration is a migration script, not a sync.

### Google Drive / Dropbox / OneDrive — **no**

The pull is "attach a syllabus straight from Drive." Attachments already work
through the private Blob store, and a file picker saves one download. Three
more OAuth surfaces for one saved step is a bad trade.

### Apple Reminders — **no**

There is no server API. It's local to the device via EventKit, which means a
native app. Out of scope for a web app.

### HPU systems (dining, shuttle, athletics, course registration) — **no, but ask**

Nothing here is documented as a public API. Worth ten minutes with HPU IT to
ask whether anything exists, because a shuttle schedule or dining hours would
genuinely improve time-blocking — the transition-buffer warnings already know
about walking across campus. Until such an API is confirmed, this stays a
question, not a plan.

---

## Ordering, if the work continues

1. **Inbound ICS subscription** (generic) — one parser, immediately useful for
   Canvas, Google, Outlook, and Apple.
2. **Canvas** on top of it, with the mapping and review step above.
3. **Everything else** only if a specific Tuesday gets worse without it.

---

## Sources

Canvas calendar feed behaviour and the developer-key policy were checked
against current documentation rather than recalled:

- [Canvas: subscribe to the Calendar Feed](https://community.canvaslms.com/t5/Canvas-Basics-Guide/How-do-I-subscribe-to-the-Calendar-feed-using-Outlook-com/ta-p/617601)
- [Canvas Calendar Events API](https://canvas.instructure.com/doc/api/calendar_events.html)
- [Canvas OAuth2 overview](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth)
- [Canvas developer keys](https://developerdocs.instructure.com/services/canvas/oauth2/file.developer_keys)
- [MIT Sloan: syncing the Canvas calendar feed](https://mitsloanedtech.mit.edu/support/how-to-sync-your-canvas-calendar-feed-to-outlook-in-office-365)
