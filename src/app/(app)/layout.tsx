import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth, signOut } from "@/lib/auth";
import { getCategories } from "@/lib/db/queries/dashboard";
import { getBellFeed } from "@/server/notifications";
import { NotificationBell } from "@/components/notifications/bell";
import { SidebarNav, MobileTabs } from "@/components/shell/nav";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { ShortcutsOverlay } from "@/components/shortcuts/shortcuts-overlay";
import { QuickAdd } from "@/components/quick-add/quick-add";
import { fmtWeekday } from "@/lib/time";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.userId) redirect("/login");
  const initialDark = (await cookies()).get("theme")?.value === "dark";
  const categories = await getCategories(session.userId);
  const bellFeed = await getBellFeed();

  return (
    <div className="flex min-h-dvh w-full">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-r border-border bg-surface px-4 py-6 md:flex">
        <div className="flex items-center gap-2.5 px-2">
          <span
            aria-hidden
            className="flex size-8 items-center justify-center rounded-xl bg-accent text-sm text-accent-text"
          >
            ✦
          </span>
          <span className="font-display text-lg leading-tight text-ink">
            High Point OS
          </span>
        </div>
        <SidebarNav />
        <div className="mt-auto px-2 text-xs text-ink-faint">
          <p>{session.user?.email}</p>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button
              type="submit"
              className="mt-1 text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur md:px-8">
          <p className="truncate text-sm text-ink-muted">
            {fmtWeekday(new Date())}
          </p>
          <div className="flex items-center gap-1">
            <NotificationBell initial={bellFeed} />
            <ThemeToggle initialDark={initialDark} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8">
          {children}
        </main>
      </div>

      <MobileTabs />
      <ShortcutsOverlay />
      {/* One global instance — Q works on every page, exactly as the ? overlay
          advertises. */}
      <QuickAdd categories={categories} />
    </div>
  );
}
