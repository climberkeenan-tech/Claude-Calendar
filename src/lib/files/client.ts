"use client";

/**
 * Browser-side upload helper: files go straight to the private Blob store
 * with a server-minted token (Vercel functions can't carry >4.5 MB bodies).
 * Photographed syllabi are downscaled first — a 12 MP HEIC-turned-JPEG both
 * uploads slowly and exceeds what vision models accept.
 */
import { upload } from "@vercel/blob/client";
import { uploadPathFor } from "@/server/files";
import type { FileScope } from "@/lib/files/storage";

/** Longest edge Claude reads at full fidelity (Opus high-res vision). */
const MAX_IMAGE_EDGE = 2576;

export async function downscaleImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height);
    if (scale >= 1 && file.size < 4 * 1024 * 1024) return file;
    const w = Math.round(bitmap.width * Math.min(scale, 1));
    const h = Math.round(bitmap.height * Math.min(scale, 1));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.87),
    );
    if (!blob) return file;
    const stem = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${stem}.jpg`, { type: "image/jpeg" });
  } catch {
    return file; // never let optimization break the upload
  }
}

export type UploadedBlob = {
  url: string;
  pathname: string;
  filename: string;
  mime: string;
  size: number;
};

export async function uploadPrivateFile(
  scope: FileScope,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<UploadedBlob> {
  const prepared = scope === "syllabus" ? await downscaleImage(file) : file;
  const pathname = await uploadPathFor(scope, prepared.name);
  const result = await upload(pathname, prepared, {
    access: "private",
    handleUploadUrl: "/api/blob/upload",
    clientPayload: JSON.stringify({ scope }),
    contentType: prepared.type || undefined,
    multipart: prepared.size > 8 * 1024 * 1024,
    onUploadProgress: onProgress
      ? ({ percentage }) => onProgress(percentage)
      : undefined,
  });
  return {
    url: result.url,
    pathname: result.pathname,
    filename: prepared.name,
    mime: prepared.type || "application/octet-stream",
    size: prepared.size,
  };
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
