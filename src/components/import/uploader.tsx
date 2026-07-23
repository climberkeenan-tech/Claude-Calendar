"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { fmtBytes, uploadPrivateFile } from "@/lib/files/client";
import { registerSyllabusUpload } from "@/server/imports";

const ACCEPT = ".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp,.gif";

/**
 * Drop-or-pick a syllabus. On success we land on the import's page, which
 * immediately starts extraction — one gesture from file to review screen.
 */
export function SyllabusUploader() {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [busy, setBusy] = React.useState<null | { name: string; pct: number }>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file || busy) return;
    setError(null);
    setBusy({ name: file.name, pct: 0 });
    try {
      const uploaded = await uploadPrivateFile("syllabus", file, (pct) =>
        setBusy({ name: file.name, pct }),
      );
      const res = await registerSyllabusUpload({
        url: uploaded.url,
        pathname: uploaded.pathname,
        filename: uploaded.filename,
      });
      if (res.error || !res.id) {
        setError(res.error ?? "Upload failed — try again.");
        setBusy(null);
        return;
      }
      router.push(`/import/${res.id}`);
    } catch (e) {
      setError(
        e instanceof Error && /storage isn't configured/i.test(e.message)
          ? "File storage isn't set up yet — add a Blob store in Vercel (see docs/SETUP.md)."
          : "Upload failed — check your connection and try again.",
      );
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFile(e.dataTransfer.files[0]);
        }}
        className={cn(
          "flex min-h-36 w-full flex-col items-center justify-center gap-2 rounded-(--radius) border-2 border-dashed px-6 py-8 text-center transition-colors",
          dragOver
            ? "border-accent bg-accent-soft"
            : "border-border hover:border-border-strong hover:bg-surface-raised",
          busy && "pointer-events-none opacity-70",
        )}
      >
        {busy ? (
          <>
            <p className="text-sm font-medium text-ink">
              Uploading {busy.name}…
            </p>
            <div className="h-1.5 w-56 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200"
                style={{ width: `${Math.max(4, busy.pct)}%` }}
              />
            </div>
          </>
        ) : (
          <>
            <span aria-hidden className="text-2xl">
              ⇪
            </span>
            <p className="text-sm font-medium text-ink">
              Drop a syllabus here, or click to choose
            </p>
            <p className="text-xs text-ink-faint">
              PDF, Word doc, or a photo/screenshot · up to {fmtBytes(15 * 1024 * 1024)}
            </p>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
