import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { ensureUser } from "./db/bootstrap";
import {
  clearFailures,
  ownerLoginEnabled,
  recordFailure,
  throttled,
  verifyPassword,
} from "./owner-password";

function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Whether a Google OAuth client actually exists.
 *
 * Auth.js registers the Google provider whether or not it is configured, so
 * an install without credentials still renders a "Continue with Google"
 * button that can only ever fail. On a first deploy — before anyone has been
 * near the Cloud Console — that button IS the login page, and pressing it
 * looks like the app is broken.
 */
export function googleConfigured(): boolean {
  return Boolean(
    process.env.AUTH_GOOGLE_ID?.trim() && process.env.AUTH_GOOGLE_SECRET?.trim(),
  );
}

function googleProvider() {
  return googleConfigured() ? [Google] : [];
}

/**
 * The owner's password door, or nothing at all.
 *
 * Two conditions, both required. Without `OWNER_PASSWORD_HASH` there is no
 * password to check; without `ALLOWED_EMAILS` there is no identity to sign in
 * AS, and returning a user whose email isn't on the allowlist would be
 * rejected by the signIn callback anyway. Returning [] in either case means
 * the provider is never registered, so the route doesn't exist rather than
 * existing and always failing.
 */
function ownerProvider() {
  const owner = allowedEmails()[0];
  if (!ownerLoginEnabled() || !owner) return [];
  return [
    Credentials({
      id: "owner",
      name: "Password",
      credentials: { password: { label: "Password", type: "password" } },
      authorize(credentials) {
        const password = credentials?.password;
        if (typeof password !== "string" || password.length === 0) return null;
        if (throttled()) return null;
        if (!verifyPassword(password, process.env.OWNER_PASSWORD_HASH)) {
          recordFailure();
          return null;
        }
        clearFailures();
        // The email is the allowlist's own first entry, so this lands on
        // exactly the same account Google sign-in would — one person, one
        // row, whichever door they came through.
        return { id: owner, email: owner, name: "Owner" };
      },
    }),
  ];
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [...googleProvider(), ...ownerProvider()],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    signIn({ user }) {
      const email = user.email?.toLowerCase();
      return !!email && allowedEmails().includes(email);
    },
    async jwt({ token, user }) {
      // First sign-in of a session: bootstrap (idempotent) and pin our user id.
      if (user?.email) {
        token.appUserId = await ensureUser({
          email: user.email,
          name: user.name,
          image: user.image,
        });
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.appUserId === "string") {
        session.userId = token.appUserId;
      }
      return session;
    },
  },
});

declare module "next-auth" {
  interface Session {
    userId?: string;
  }
}

/**
 * For server components/actions inside the authenticated shell: returns the
 * app user id or throws (the (app) layout already redirects unauthenticated
 * visitors, so a throw here means a broken invariant, not a user error).
 */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.userId) throw new Error("Not authenticated");
  return session.userId;
}
