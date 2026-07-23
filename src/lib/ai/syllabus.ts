/**
 * Syllabus extraction (ARCHITECTURE §11). One document-in, structured-JSON-out
 * call per upload: PDF/image go to claude-opus-4-8 as native document/image
 * blocks; DOCX is converted to text with mammoth first. The result is stored
 * on the syllabus_imports row for the review screen — NOTHING is created on
 * the calendar here.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { syllabusImports } from "@/lib/db/schema";
import { readStoredFileBuffer } from "@/lib/files/storage";
import {
  syllabusExtractionSchema,
  type StoredExtraction,
} from "@/lib/import/schema";

const MODEL = "claude-opus-4-8";
const TZ = "America/New_York";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export class ExtractionError extends Error {
  friendly: string;
  constructor(friendly: string) {
    super(friendly);
    this.friendly = friendly;
  }
}

function buildSystemPrompt(now: Date): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    dateStyle: "short",
  }).format(now);
  return [
    "You extract structured schedules from college course syllabi for a student's calendar app.",
    "",
    "Rules:",
    `- Today is ${today} (${TZ}). Dates in syllabi often omit the year: infer it from the term named in the document (e.g. 'Fall 2026'); if no term is named, assume the semester containing or next following today. Never output a date more than a year in the past.`,
    "- Output dates as YYYY-MM-DD and times as 24-hour HH:MM wall clock (America/New_York). Use null when the document does not say — never invent times.",
    "- One item per distinct dated thing: every assignment, exam, quiz, project milestone, reading deadline, lab, and holiday/break. A weekly class meeting is ONE class_session item with an rrule, not dozens of items.",
    "- rrule: only for genuinely recurring meetings. Use RFC5545 bodies like FREQ=WEEKLY;BYDAY=MO,WE,FR (BYDAY codes: MO TU WE TH FR SA SU). Set the item's date to the FIRST meeting and endDate to the LAST (or leave endDate null if unknown). Do not include DTSTART or UNTIL in the rrule string.",
    "- sourceExcerpt: quote the exact text span (≤300 chars) the item came from, verbatim. The student reads this to decide whether to trust you.",
    "- confidence: your honest 0-1 probability the DATE is right. Ambiguous year, smudged photo, or inferred deadline → below 0.8.",
    "- Course fields: fill what the document states; null otherwise. term like 'Fall 2026'.",
    "- If the document is not a course syllabus (or is unreadable), set isSyllabus=false, explain briefly in documentSummary, and return zero items.",
  ].join("\n");
}

type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "document";
      source: { type: "base64"; media_type: "application/pdf"; data: string };
    }
  | {
      type: "image";
      source: { type: "base64"; media_type: ImageType; data: string };
    };

function buildContent(mime: string, buffer: Buffer, text: string | null): ContentBlock[] {
  const ask: ContentBlock = {
    type: "text",
    text: "Extract the course info and every dated item from this syllabus.",
  };
  if (mime === "application/pdf") {
    return [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: buffer.toString("base64"),
        },
      },
      ask,
    ];
  }
  if ((IMAGE_TYPES as readonly string[]).includes(mime)) {
    return [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: mime as ImageType,
          data: buffer.toString("base64"),
        },
      },
      ask,
    ];
  }
  // DOCX / plain text arrive here already converted to a string.
  return [
    { type: "text", text: `SYLLABUS TEXT:\n\n${text ?? ""}` },
    ask,
  ];
}

async function toText(mime: string, buffer: Buffer): Promise<string | null> {
  if (mime === DOCX_MIME) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer });
    if (!value.trim()) {
      throw new ExtractionError(
        "That Word document appears to be empty or unreadable.",
      );
    }
    return value.slice(0, 200_000);
  }
  if (mime === "text/plain") return buffer.toString("utf8").slice(0, 200_000);
  return null;
}

/**
 * Run extraction for one upload. Moves the row uploaded → parsing → review,
 * or → failed with a friendly error message.
 */
export async function extractSyllabus(
  importId: string,
  userId: string,
): Promise<{ status: "review" | "failed"; error?: string }> {
  const rows = await db
    .select()
    .from(syllabusImports)
    .where(eq(syllabusImports.id, importId));
  const row = rows[0];
  if (!row || row.userId !== userId) {
    return { status: "failed", error: "Import not found." };
  }
  if (row.status === "approved") {
    return { status: "review" }; // never re-parse an approved import
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    const error =
      "AI extraction isn't configured — set ANTHROPIC_API_KEY in your environment.";
    await db
      .update(syllabusImports)
      .set({ status: "failed", error })
      .where(eq(syllabusImports.id, importId));
    return { status: "failed", error };
  }

  await db
    .update(syllabusImports)
    .set({ status: "parsing", error: null })
    .where(eq(syllabusImports.id, importId));

  try {
    const file = await readStoredFileBuffer(row.blobUrl);
    if (!file) throw new ExtractionError("The uploaded file could not be read.");

    const text = await toText(row.mime, file.buffer);
    const content = buildContent(row.mime, file.buffer, text);

    const client = new Anthropic();
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      system: buildSystemPrompt(new Date()),
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(syllabusExtractionSchema) },
    });

    const result = response.parsed_output;
    if (!result) {
      throw new ExtractionError(
        "Claude couldn't produce a structured reading of this file — try a clearer copy.",
      );
    }
    if (!result.isSyllabus || result.items.length === 0) {
      throw new ExtractionError(
        result.isSyllabus
          ? "No dated items were found in this document."
          : `This doesn't look like a course syllabus. ${result.documentSummary}`.trim(),
      );
    }

    const extraction: StoredExtraction = {
      result,
      model: MODEL,
      extractedAt: new Date().toISOString(),
    };
    await db
      .update(syllabusImports)
      .set({
        status: "review",
        extraction,
        model: MODEL,
        error: null,
      })
      .where(eq(syllabusImports.id, importId));
    return { status: "review" };
  } catch (err) {
    const friendly =
      err instanceof ExtractionError
        ? err.friendly
        : "Extraction failed — the file may be too large, damaged, or the AI service was unavailable. Try again in a minute.";
    console.error(`[syllabus] extraction failed for ${importId}:`, err);
    await db
      .update(syllabusImports)
      .set({ status: "failed", error: friendly })
      .where(eq(syllabusImports.id, importId));
    return { status: "failed", error: friendly };
  }
}
