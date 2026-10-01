import type { ReactNode } from "react";

const METRIC_TONES = {
  blue: "border-blue-300/60 bg-blue-50/80 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  violet: "border-violet-300/60 bg-violet-50/80 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  emerald: "border-emerald-300/60 bg-emerald-50/80 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  cyan: "border-cyan-300/60 bg-cyan-50/80 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300",
  amber: "border-amber-300/60 bg-amber-50/80 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  green: "border-green-300/60 bg-green-50/80 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300",
  red: "border-red-300/60 bg-red-50/80 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300",
} as const;

export function MetricBadge({ label, value, icon, tone }: {
  label: string;
  value: string;
  icon: ReactNode;
  tone: keyof typeof METRIC_TONES;
}) {
  return (
    <div className={`flex min-w-max items-center justify-center gap-1.5 rounded-md border px-2 py-1 ${METRIC_TONES[tone]}`}>
      <span className="shrink-0">{icon}</span>
      <span className="text-[10px] font-medium opacity-75">{label}</span>
      <span className="font-mono text-xs font-bold tabular-nums">{value}</span>
    </div>
  );
}
