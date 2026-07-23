import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Server component: a compact month grid with event-count dots. */
export function MiniMonth({
  monthDots,
  todayIso,
}: {
  monthDots: Record<string, number>;
  todayIso: string; // YYYY-MM-DD in the user's timezone
}) {
  const [y, m] = todayIso.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Monday-first column index for the 1st of the month
  const lead = (first.getUTCDay() + 6) % 7;
  const monthName = first.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <Card>
      <CardHeader
        title="Calendar"
        action={
          <Link href="/calendar" className="text-xs text-accent hover:underline">
            {monthName}
          </Link>
        }
      />
      <CardBody>
        <div className="grid grid-cols-7 gap-y-1 text-center">
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <span key={i} className="text-[10px] font-medium text-ink-faint">
              {d}
            </span>
          ))}
          {cells.map((day, i) => {
            if (day === null) return <span key={`x${i}`} />;
            const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const isToday = iso === todayIso;
            const count = monthDots[iso] ?? 0;
            return (
              <span
                key={iso}
                className={cn(
                  "mx-auto flex size-7 flex-col items-center justify-center rounded-full text-xs",
                  isToday
                    ? "bg-accent font-semibold text-accent-text"
                    : "text-ink-muted",
                )}
              >
                {day}
                <span
                  aria-hidden
                  className={cn(
                    "mt-[1px] block size-1 rounded-full",
                    count > 0
                      ? isToday
                        ? "bg-accent-text/80"
                        : "bg-accent"
                      : "bg-transparent",
                  )}
                />
              </span>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
