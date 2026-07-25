# Click-count audit

The brief's hard rule: **every common action in three clicks or fewer.** This
table is the receipt. It's counted from the Dashboard (the landing page) unless
a starting point is named, and it's re-counted whenever a surface changes.

**What counts as a click:** one pointer press on an interactive target.
Typing doesn't count. Picking a value inside a native date/time picker counts
as one. Keyboard shortcuts are listed separately because they're a *shortcut*,
not the guaranteed path — every row below is reachable with the mouse alone.

## Daily actions

| Action | Path | Clicks | Keyboard |
|---|---|---:|---|
| Capture anything (event, task, or habit) | ＋ Quick add → type → **Add** | **2** | `Q`, type, `Enter` — **0** |
| Capture with no date (→ Inbox) | same; the chips say "no date → Inbox" | **2** | `Q`, type, `Enter` — **0** |
| Complete a task | ○ on the Deadlines row | **1** | — |
| Un-complete a task | open it → **Un-complete** | **2** | — |
| Mark a habit done for a day | the day cell on the habit strip | **1** | — |
| Give an Inbox item a date | date field → pick a day | **2** | — |
| Start a focus timer | **▶ Start focusing** | **1** | — |
| Start it on a specific course + kind | kind chip → course → **▶ Start focusing** | **3** | — |
| Stop and save a session | **◼ Stop & save** | **1** | — |
| See today's schedule | (it's the landing page) | **0** | `T` from anywhere |
| Read the AI digest | (on the landing page) | **0** | — |

## Calendar

| Action | Path | Clicks | Keyboard |
|---|---|---:|---|
| Open the calendar | Calendar in the nav | **1** | — |
| Switch Day / Week / Month / Agenda | the view chip | **1** | `1` `2` `3` `4` |
| Previous / next period | ‹ or › | **1** | `←` `→` |
| Jump back to today | **Today** | **1** | `T` (Dashboard) |
| Move an event to another time | drag it | **1 drag** | — |
| Resize an event | drag its bottom edge | **1 drag** | — |
| Open an event | click the chip | **1** | `Enter` when focused |
| Change an event's time or title | open → edit → **Save** | **2** | — |
| Change one occurrence of a series | open → scope chip → **Save** | **3** | scope chips take `←`/`→` |
| Complete an event / occurrence | open → **Complete ✓** | **2** | — |
| Delete an event | open → **Delete…** → **Confirm delete** | **3** | — |
| Delete one occurrence of a series | open → **Delete…** → **This one** | **3** | — |
| Add a note, checklist, or reminder | open → **More details** → the field | **3** | — |
| Attach a file to an event | open → **More details** → choose file | **3** | — |

## Planning and triage

| Action | Path | Clicks | Keyboard |
|---|---|---:|---|
| Plan the week | **Plan my week** → **Accept plan** | **2** | — |
| Replan after things slipped | **N slipped — replan** → **Accept plan** | **2** | — |
| Drop one block from a plan | uncheck it → **Accept plan** | **2** | — |
| Undo a whole accepted plan | **Undo** (on the confirmation) | **1** | — |
| Accept a suggestion ("your 4 PM window is open") | Plan → **Add it** | **2** | — |
| Triage one overdue task | Assignments → **Tonight** / **Tomorrow** / **Weekend** / **Shrink it** / **Drop** | **2** | — |
| See everything that's open | Assignments in the nav | **1** | — |

## Setup and review

| Action | Path | Clicks | Clicks (worst case) |
|---|---|---:|---|
| Import a syllabus | Import → the drop zone → pick the file → **Add N to calendar** (extraction starts on its own) | **3** | 3 |
| Undo an import | Import → the import → **Undo import** | **3** | 3 |
| See analytics | Analytics in the nav | **1** | 1 |
| Hide the weekly score | **Hide** on the score card | **1** | 1 |
| Change the study cap or transition buffer | Settings → chip → **Save planning settings** | **3** | 3 |
| Turn a reminder channel on/off | Settings → the channel toggle | **2** | 2 |
| Add a course | Settings → Courses → fill → **Add course** | **3** | 3 |
| Generate a Claude (MCP) token | Settings → **＋ Generate token** | **2** | 2 |
| Switch light/dark | the theme button in the header | **1** | 1 |
| See every shortcut | — | — | `?` |

## Nothing exceeds three

Every row lands at 3 or fewer. Two paths sit *at* 3 and are worth watching if
they ever grow:

- **Attach a file / add a note** — 3 because "More details" is collapsed by
  default. That collapse is deliberate: the edit sheet stays a four-field form
  for the 90% case instead of a wall of options.
- **Change a planning preference** — 3 because the panel batches several
  settings behind one Save, rather than firing a write per chip.

Two things that look like extra clicks but aren't:

- **Quick add is always one click away.** The ＋ button is fixed to the
  viewport on every page inside the app, so no action's count includes
  "navigate somewhere first" to capture.
- **The scope chips ("This one / This & future / Whole series") are one tab
  stop**, not three. Arrow keys move between them, so keyboard users don't pay
  three Tabs to reach Save.

## Keyboard coverage

`Q` quick add · `T` today · `1`–`4` calendar views · `←`/`→` previous/next
period, or move between chips in a choice group · `Enter` open the focused
event · `?` this list. All of them go quiet while a dialog is open or focus is
in a text field, so typing "quiz" into a title never flips the calendar view.

Inside the app: **Tab** from the top of any page hits **Skip to content**
first, which jumps past the seven nav links straight into the page.
