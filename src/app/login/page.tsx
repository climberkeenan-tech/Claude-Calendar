import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";

export const metadata = { title: "Sign in" };

/** Only same-origin paths may be returned to — "//evil.com" is a URL, not a
 * path, and would turn sign-in into an open redirect. */
function safeNext(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = safeNext(next);
  const session = await auth();
  if (session?.userId) redirect(target);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          aria-hidden
          className="flex size-14 items-center justify-center rounded-2xl bg-accent text-2xl text-accent-text shadow-soft"
        >
          ✦
        </div>
        <h1 className="font-display text-3xl text-ink">
          High Point Productivity OS
        </h1>
        <p className="max-w-sm text-sm text-ink-muted">
          Your calendar, assignments, and study life — organized in one calm
          place, with Claude alongside.
        </p>
      </div>

      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: target });
        }}
      >
        <button
          type="submit"
          className="flex h-11 items-center gap-3 rounded-(--radius-sm) border border-border bg-surface px-5 text-sm font-medium text-ink shadow-soft transition-colors hover:border-border-strong hover:bg-surface-raised"
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
          </svg>
          Continue with Google
        </button>
      </form>

      <p className="text-xs text-ink-faint">
        Private system — only the approved account can sign in.
      </p>
    </main>
  );
}
