"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import {
  savePushSubscription,
  sendTestNotification,
  updateNotificationSettings,
} from "@/server/notifications";
import { offsetLabel } from "@/lib/reminders/labels";
import { cn } from "@/lib/utils";

type Settings = {
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  channelPrefs: { inApp: boolean; push: boolean; email: boolean; sms: boolean };
  defaultReminders: Record<string, number[]>;
};

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && Boolean((navigator as { standalone?: boolean }).standalone))
  );
}

export function NotificationsPanel({
  initial,
  pushDevices,
}: {
  initial: Settings;
  pushDevices: number;
}) {
  const [settings, setSettings] = React.useState(initial);
  const [dirty, setDirty] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [pushState, setPushState] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<string | null>(null);
  const [needsInstall, setNeedsInstall] = React.useState(false);

  const patch = (p: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...p }));
    setDirty(true);
  };

  async function enablePush() {
    setPushState(null);
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      if (isIos() && !isStandalone()) {
        setNeedsInstall(true);
        return;
      }
      setPushState("This browser doesn't support push notifications.");
      return;
    }
    if (isIos() && !isStandalone()) {
      setNeedsInstall(true);
      return;
    }
    const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapid) {
      setPushState("Push isn't configured yet — add the VAPID keys in Vercel.");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushState("Permission declined — enable notifications in browser settings.");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid),
      });
      const json = sub.toJSON() as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      };
      await savePushSubscription(
        { endpoint: json.endpoint, keys: json.keys },
        navigator.userAgent,
      );
      setPushState("This device will now receive reminders. 🎉");
    } catch {
      setPushState("Couldn't enable push — try again.");
    }
  }

  return (
    <Card>
      <CardHeader title="Notifications" />
      <CardBody className="flex flex-col gap-5">
        {/* Channels */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-ink-muted">Channels</span>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["push", "Push"],
                ["email", "Email"],
                ["inApp", "In-app"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                aria-pressed={settings.channelPrefs[key]}
                onClick={() =>
                  patch({
                    channelPrefs: {
                      ...settings.channelPrefs,
                      [key]: !settings.channelPrefs[key],
                    },
                  })
                }
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  settings.channelPrefs[key]
                    ? "border-accent bg-accent-soft text-ink"
                    : "border-border text-ink-muted hover:border-border-strong",
                )}
              >
                {label}
              </button>
            ))}
            <span className="self-center text-xs text-ink-faint">
              SMS is a future option (costs per message).
            </span>
          </div>
        </div>

        {/* Push device enrollment */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-ink-muted">
            This device {pushDevices > 0 ? `· ${pushDevices} enrolled` : ""}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={enablePush}>
              Enable push on this device
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await sendTestNotification();
                  setTestResult(`Push: ${r.push} · Email: ${r.email}`);
                })
              }
            >
              Send a test
            </Button>
          </div>
          {pushState ? <p className="text-xs text-ink-muted">{pushState}</p> : null}
          {testResult ? <p className="text-xs text-ink-muted">{testResult}</p> : null}
          {needsInstall ? (
            <div className="rounded-(--radius-sm) border border-border bg-surface-raised p-3 text-xs text-ink-muted">
              <p className="font-medium text-ink">iPhone setup (one time):</p>
              <ol className="mt-1 list-decimal pl-4 leading-relaxed">
                <li>Open this site in Safari</li>
                <li>Tap the Share button</li>
                <li>Choose “Add to Home Screen”</li>
                <li>Open the new app icon, come back here, tap Enable again</li>
              </ol>
            </div>
          ) : null}
        </div>

        {/* Quiet hours */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-ink-muted">
            Quiet hours — reminders wait, never vanish
          </span>
          <div className="flex items-center gap-2">
            <Field label="From" htmlFor="qh-start" className="w-28">
              <Input
                id="qh-start"
                type="time"
                value={settings.quietHoursStart ?? ""}
                onChange={(e) => patch({ quietHoursStart: e.target.value || null })}
              />
            </Field>
            <Field label="Until" htmlFor="qh-end" className="w-28">
              <Input
                id="qh-end"
                type="time"
                value={settings.quietHoursEnd ?? ""}
                onChange={(e) => patch({ quietHoursEnd: e.target.value || null })}
              />
            </Field>
          </div>
        </div>

        {/* Per-category defaults (read-only summary; "back off" tunes these) */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-muted">
            Default reminders for new items
          </span>
          <ul className="flex flex-col gap-0.5 text-xs text-ink-muted">
            {Object.entries(settings.defaultReminders).map(([cat, offsets]) => (
              <li key={cat}>
                <span className="text-ink">{cat}:</span>{" "}
                {offsets.length > 0
                  ? offsets.map((o) => offsetLabel(o)).join(", ")
                  : "none"}
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-faint">
            Any notification&apos;s “Too much?” button thins these; per-event
            reminders live in each event&apos;s details.
          </p>
        </div>

        {dirty ? (
          <Button
            size="sm"
            className="self-end"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await updateNotificationSettings({
                  quietHoursStart: settings.quietHoursStart,
                  quietHoursEnd: settings.quietHoursEnd,
                  channelPrefs: settings.channelPrefs,
                });
                setDirty(false);
              })
            }
          >
            {pending ? "Saving…" : "Save notification settings"}
          </Button>
        ) : null}
      </CardBody>
    </Card>
  );
}
