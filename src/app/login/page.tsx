import { redirect, unstable_rethrow } from "next/navigation";
import { auth, googleConfigured, signIn } from "@/lib/auth";
import { ownerLoginEnabled } from "@/lib/owner-password";
import { safeReturnPath } from "@/lib/oauth/pkce";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const target = safeReturnPath(next);
  const session = await auth();
  if (session?.userId) redirect(target);
  const passwordLogin = ownerLoginEnabled();
  const google = googleConfigured();

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

      {google ? (
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
      ) : null}

      {!google && !passwordLogin ? (
        // Neither door exists. Saying so beats a page with nothing on it —
        // this is what a deploy that's missing its settings looks like, and
        // the fix is two lines away.
        <div
          role="alert"
          className="max-w-sm rounded-(--radius-sm) border border-border bg-surface-raised p-4 text-sm text-ink-muted"
        >
          <p className="mb-2 font-medium text-ink">No way to sign in yet</p>
          <p>
            Set <code className="font-mono text-xs">OWNER_PASSWORD_HASH</code>{" "}
            for a password, or{" "}
            <code className="font-mono text-xs">AUTH_GOOGLE_ID</code> and{" "}
            <code className="font-mono text-xs">AUTH_GOOGLE_SECRET</code> for
            Google, then redeploy. See <span className="text-ink">docs/GO-LIVE.md</span>.
          </p>
        </div>
      ) : null}

      {passwordLogin ? (
        <div className="flex w-full max-w-xs flex-col gap-3">
          {google ? (
            <div className="flex items-center gap-3" aria-hidden>
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-ink-faint">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          ) : null}

          <form
            action={async (formData: FormData) => {
              "use server";
              const password = String(formData.get("password") ?? "");
              try {
                await signIn("owner", { password, redirectTo: target });
              } catch (err) {
                // A successful sign-in redirects by THROWING. Swallowing that
                // here would leave you sitting on the login page having just
                // logged in successfully, which is the classic Auth.js v5
                // trap. unstable_rethrow is Next's own guard for this — it
                // re-throws the framework's control-flow errors and returns
                // for everything else, so it can't drift out of date the way
                // reaching into next/dist for isRedirectError would.
                unstable_rethrow(err);
                redirect(
                  `/login?error=1${next ? `&next=${encodeURIComponent(target)}` : ""}`,
                );
              }
            }}
            className="flex flex-col gap-2"
          >
            <label htmlFor="owner-password" className="sr-only">
              Owner password
            </label>
            <input
              id="owner-password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="Owner password"
              aria-describedby={error ? "login-error" : undefined}
              aria-invalid={error ? true : undefined}
              className="h-11 w-full rounded-(--radius-sm) border border-border-input bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none"
            />
            <button
              type="submit"
              className="h-11 rounded-(--radius-sm) bg-accent px-5 text-sm font-medium text-accent-text shadow-soft transition-opacity hover:opacity-90"
            >
              Sign in
            </button>
          </form>

          {error ? (
            <p id="login-error" role="alert" className="text-xs text-danger-ink">
              That password didn&apos;t match. Try again.
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="max-w-xs text-center text-xs text-ink-faint">
        Private system — only the approved account can sign in.
      </p>
    </main>
  );
}
