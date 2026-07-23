import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { ensureUser } from "./db/bootstrap";

function allowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
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
