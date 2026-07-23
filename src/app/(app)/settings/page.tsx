import Link from "next/link";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { NotificationsPanel } from "@/components/settings/notifications-panel";
import {
  countPushSubscriptions,
  getNotificationSettings,
} from "@/server/notifications";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await auth();
  const initialDark = (await cookies()).get("theme")?.value === "dark";
  const [notifSettings, pushDevices] = await Promise.all([
    getNotificationSettings(),
    countPushSubscriptions(),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <h1 className="font-display text-2xl text-ink">Settings</h1>

      <Card>
        <CardHeader title="Account" />
        <CardBody className="flex items-center justify-between">
          <div>
            <p className="text-sm text-ink">{session?.user?.name}</p>
            <p className="text-xs text-ink-muted">{session?.user?.email}</p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Appearance" />
        <CardBody className="flex items-center justify-between">
          <p className="text-sm text-ink-muted">Light / dark mode</p>
          <ThemeToggle initialDark={initialDark} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Courses"
          action={
            <Link href="/settings/courses" className="text-xs text-accent hover:underline">
              Manage
            </Link>
          }
        />
        <CardBody>
          <p className="text-sm text-ink-muted">
            Your classes — name, professor, location, color. Events and focus
            sessions link to them.
          </p>
        </CardBody>
      </Card>

      {notifSettings ? (
        <NotificationsPanel initial={notifSettings} pushDevices={pushDevices} />
      ) : null}

      <Card>
        <CardHeader title="Claude access" />
        <CardBody>
          <p className="text-sm text-ink-muted">
            MCP access tokens (so Claude Code and claude.ai can manage your
            calendar) arrive in Phase 6.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
