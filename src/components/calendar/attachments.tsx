"use client";

import * as React from "react";
import { fmtBytes, uploadPrivateFile } from "@/lib/files/client";
import {
  attachFileToEvent,
  deleteAttachment,
  listAttachments,
  type AttachmentRow,
} from "@/server/files";

/**
 * Event attachments (deferred from Phase 4). Files live in the private Blob
 * store; download links go through the authenticated /api/files route, so a
 * shared laptop or leaked URL gets nothing.
 */
export function AttachmentsSection({ eventId }: { eventId: string }) {
  const [rows, setRows] = React.useState<AttachmentRow[] | null>(null);
  const [busy, setBusy] = React.useState<null | { name: string; pct: number }>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    let alive = true;
    listAttachments(eventId)
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch(() => {
        if (alive) setRows([]);
      });
    return () => {
      alive = false;
    };
  }, [eventId]);

  const handleFile = async (file: File | undefined) => {
    if (!file || busy) return;
    setError(null);
    setBusy({ name: file.name, pct: 0 });
    try {
      const uploaded = await uploadPrivateFile("attachments", file, (pct) =>
        setBusy({ name: file.name, pct }),
      );
      const res = await attachFileToEvent({
        eventId,
        url: uploaded.url,
        pathname: uploaded.pathname,
        filename: uploaded.filename,
      });
      if (res.error || !res.id) {
        setError(res.error ?? "Upload failed — try again.");
      } else {
        setRows((r) => [
          ...(r ?? []),
          {
            id: res.id!,
            filename: uploaded.filename,
            mime: uploaded.mime,
            size: uploaded.size,
          },
        ]);
      }
    } catch {
      setError("Upload failed — check your connection and try again.");
    }
    setBusy(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-ink-muted">Attachments</p>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => inputRef.current?.click()}
          className="text-xs text-accent hover:underline disabled:opacity-50"
        >
          {busy ? `Uploading ${Math.round(busy.pct)}%…` : "＋ Attach file"}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      {rows === null ? (
        <p className="text-xs text-ink-faint">Loading…</p>
      ) : rows.length === 0 && !busy ? (
        <p className="text-xs text-ink-faint">
          Rubrics, worksheets, slides — keep them with the event.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              <a
                href={`/api/files/attachment/${a.id}`}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-ink underline-offset-2 hover:text-accent hover:underline"
              >
                {a.filename}
              </a>
              <span className="shrink-0 text-xs text-ink-faint">
                {fmtBytes(a.size)}
              </span>
              <button
                type="button"
                aria-label={`Remove ${a.filename}`}
                className="shrink-0 text-xs text-ink-faint hover:text-danger"
                onClick={async () => {
                  const prev = rows;
                  setRows(rows.filter((r) => r.id !== a.id));
                  try {
                    await deleteAttachment(a.id);
                  } catch {
                    setRows(prev); // put it back — the delete didn't land
                  }
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
