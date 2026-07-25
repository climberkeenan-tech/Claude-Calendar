import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const eventKind = pgEnum("event_kind", ["event", "task", "habit"]);
export const eventStatus = pgEnum("event_status", [
  "scheduled",
  "completed",
  "cancelled",
]);
export const eventPriority = pgEnum("event_priority", [
  "low",
  "normal",
  "high",
  "critical",
]);
export const eventSource = pgEnum("event_source", [
  "manual",
  "quick_add",
  "syllabus",
  "ai_suggestion",
  "integration",
]);
export const jobStatus = pgEnum("job_status", [
  "pending",
  "sending",
  "sent",
  "failed",
  "cancelled",
  "acknowledged",
  "deferred",
]);
export const insightStatus = pgEnum("insight_status", [
  "new",
  "accepted",
  "dismissed",
]);
export const importStatus = pgEnum("import_status", [
  "uploaded",
  "parsing",
  "review",
  "approved",
  "failed",
]);
export const focusKind = pgEnum("focus_kind", [
  "study",
  "work",
  "reading",
  "other",
]);

// ---------------------------------------------------------------------------
// Users & settings
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  timezone: text("timezone").notNull().default("America/New_York"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userSettings = pgTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  theme: text("theme").notNull().default("system"),
  weekStartDay: integer("week_start_day").notNull().default(1),
  // Per-category default reminder offsets, minutes before start/due.
  defaultReminders: jsonb("default_reminders")
    .$type<Record<string, number[]>>()
    .notNull()
    .default({}),
  quietHoursStart: text("quiet_hours_start"),
  quietHoursEnd: text("quiet_hours_end"),
  phoneNumber: text("phone_number"),
  channelPrefs: jsonb("channel_prefs")
    .$type<{ inApp: boolean; push: boolean; email: boolean; sms: boolean }>()
    .notNull()
    .default({ inApp: true, push: true, email: true, sms: false }),
  escalationEnabled: boolean("escalation_enabled").notNull().default(true),
  focusTargetMinutesPerDay: integer("focus_target_minutes_per_day"),
  // Scheduling preferences (Phase 9). Buffers are configurable per the
  // roadmap — 15 min suits a walkable campus, 5 suits a dorm desk.
  transitionBufferMinutes: integer("transition_buffer_minutes")
    .notNull()
    .default(15),
  dayStart: text("day_start").notNull().default("08:00"),
  dayEnd: text("day_end").notNull().default("22:00"),
  /** Ceiling on planned study minutes per day — stops "plan my week" from
   * paving over every waking hour. */
  maxPlanMinutesPerDay: integer("max_plan_minutes_per_day")
    .notNull()
    .default(240),
  showProductivityScore: boolean("show_productivity_score")
    .notNull()
    .default(true),
});

// ---------------------------------------------------------------------------
// Courses & categories
// ---------------------------------------------------------------------------

export const courses = pgTable("courses", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code"),
  professor: text("professor"),
  location: text("location"),
  color: text("color"),
  officeHours: jsonb("office_hours").$type<
    { day: string; start: string; end: string; location?: string }[]
  >(),
  term: text("term"),
  sourceImportId: text("source_import_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const categories = pgTable(
  "categories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    icon: text("icon"),
    isDefault: boolean("is_default").notNull().default(false),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("categories_user_name_idx").on(t.userId, t.name)],
);

// ---------------------------------------------------------------------------
// Events (the heart of the system)
// ---------------------------------------------------------------------------

export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    notes: text("notes"),
    kind: eventKind("kind").notNull().default("event"),
    categoryId: text("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    courseId: text("course_id").references(() => courses.id, {
      onDelete: "set null",
    }),
    location: text("location"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    allDay: boolean("all_day").notNull().default(false),
    dueAt: timestamp("due_at", { withTimezone: true }),
    rrule: text("rrule"),
    tz: text("tz").notNull().default("America/New_York"),
    priority: eventPriority("priority").notNull().default("normal"),
    estimatedMinutes: integer("estimated_minutes"),
    actualMinutes: integer("actual_minutes"),
    tags: text("tags").array(),
    status: eventStatus("status").notNull().default("scheduled"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Habits: weekly target ("3 of 7 days"), never consecutive streaks.
    habitTargetPerWeek: integer("habit_target_per_week"),
    source: eventSource("source").notNull().default("manual"),
    sourceId: text("source_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("events_user_starts_idx").on(t.userId, t.startsAt),
    index("events_user_due_idx").on(t.userId, t.dueAt),
    index("events_user_kind_idx").on(t.userId, t.kind),
  ],
);

export const occurrences = pgTable(
  "occurrences",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    occurrenceDate: date("occurrence_date").notNull(),
    cancelled: boolean("cancelled").notNull().default(false),
    completed: boolean("completed").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    overrides: jsonb("overrides").$type<{
      startsAt?: string;
      endsAt?: string;
      title?: string;
      location?: string;
    }>(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.occurrenceDate] })],
);

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    done: boolean("done").notNull().default(false),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("checklist_event_idx").on(t.eventId)],
);

export const attachments = pgTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    blobUrl: text("blob_url").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("attachments_event_idx").on(t.eventId)],
);

// ---------------------------------------------------------------------------
// Reminders & notification pipeline
// ---------------------------------------------------------------------------

export const reminders = pgTable(
  "reminders",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    offsetMinutes: integer("offset_minutes"),
    absoluteAt: timestamp("absolute_at", { withTimezone: true }),
    channels: text("channels").array().notNull(),
    enabled: boolean("enabled").notNull().default(true),
  },
  (t) => [index("reminders_event_idx").on(t.eventId)],
);

export const notificationJobs = pgTable(
  "notification_jobs",
  {
    id: text("id").primaryKey(),
    reminderId: text("reminder_id").references(() => reminders.id, {
      onDelete: "cascade",
    }),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    occurrenceAt: timestamp("occurrence_at", { withTimezone: true }).notNull(),
    sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
    channel: text("channel").notNull(),
    status: jobStatus("status").notNull().default("pending"),
    qstashMessageId: text("qstash_message_id"),
    attempts: integer("attempts").notNull().default(0),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    isEscalation: boolean("is_escalation").notNull().default(false),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ackedAt: timestamp("acked_at", { withTimezone: true }),
  },
  (t) => [
    index("jobs_status_send_idx").on(t.status, t.sendAt),
    index("jobs_event_idx").on(t.eventId),
  ],
);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  keys: jsonb("keys").$type<{ p256dh: string; auth: string }>().notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Tracking & intelligence
// ---------------------------------------------------------------------------

export const focusSessions = pgTable(
  "focus_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: text("event_id").references(() => events.id, {
      onDelete: "set null",
    }),
    courseId: text("course_id").references(() => courses.id, {
      onDelete: "set null",
    }),
    kind: focusKind("kind").notNull().default("study"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationMinutes: integer("duration_minutes"),
    notes: text("notes"),
  },
  (t) => [index("focus_user_started_idx").on(t.userId, t.startedAt)],
);

export const activityLog = pgTable(
  "activity_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("activity_user_created_idx").on(t.userId, t.createdAt)],
);

export const dailyStats = pgTable(
  "daily_stats",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    minutesStudied: integer("minutes_studied").notNull().default(0),
    minutesByCategory: jsonb("minutes_by_category")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    freeMinutes: integer("free_minutes").notNull().default(0),
    avgWorkSessionMinutes: real("avg_work_session_minutes"),
    tasksCompleted: integer("tasks_completed").notNull().default(0),
    tasksCompletedLate: integer("tasks_completed_late").notNull().default(0),
    tasksOverdue: integer("tasks_overdue").notNull().default(0),
    focusSessionCount: integer("focus_session_count").notNull().default(0),
    productivityScore: real("productivity_score"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

export const userPatterns = pgTable("user_patterns", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  patterns: jsonb("patterns").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const aiInsights = pgTable(
  "ai_insights",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    confidence: real("confidence"),
    // Zod-validated union of whitelisted operations; never open dispatch.
    action: jsonb("action").$type<Record<string, unknown>>(),
    status: insightStatus("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [index("insights_user_status_idx").on(t.userId, t.status)],
);

// ---------------------------------------------------------------------------
// Imports & machine access
// ---------------------------------------------------------------------------

export const syllabusImports = pgTable("syllabus_imports", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  blobUrl: text("blob_url").notNull(),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  status: importStatus("status").notNull().default("uploaded"),
  courseId: text("course_id").references(() => courses.id, {
    onDelete: "set null",
  }),
  extraction: jsonb("extraction").$type<Record<string, unknown>>(),
  model: text("model"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const apiTokens = pgTable("api_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
