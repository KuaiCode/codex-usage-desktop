import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Coins, Database, Folder, Search, Terminal, X } from "lucide-react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  fetchProjectAnalytics,
  fetchSessionDetails,
  type OverviewResponse,
  type ProjectAnalyticsResponse,
  type RangeKey,
  type SessionDetailRow,
} from "@/lib/api";
import { formatCompactNumber, formatCurrency, formatCurrencyShort, formatNumber, formatPercent } from "@/lib/formatters";
import { formatTrendDateLabel, getYAxisWidth } from "@/lib/usage-dashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "react-i18next";
import { projectLabel, sessionProjectReferences } from "@/lib/project-reference";
import { projectTokenBreakdown } from "@/lib/project-analytics";
import { MetricBadge } from "./metric-badge";
import { SessionUsageTable } from "./session-usage-table";
import { useModalFocus } from "@/hooks/use-modal-focus";

type ProjectSessionsModalProps = {
  project: Pick<OverviewResponse["projects"][number], "project" | "displayName" | "codexProjectId" | "codexProjectName" | "codexProjectRoot" | "totalTokens" | "costUSD">;
  range: RangeKey;
  onClose: () => void;
  onSessionClick?: (session: SessionDetailRow) => void;
  isActive?: boolean;
  onGoToSessions: (projectPath: string) => void;
};

function cleanSessionId(sessionId: string) {
  return sessionId.replace(/\.jsonl$/, "");
}

function TrendTooltip({ active, payload, label, t }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as ProjectAnalyticsResponse["daily"][number] & { nonCachedInputTokens: number };
  return <div className="min-w-[220px] select-none rounded-lg border border-border/70 bg-surface p-3.5 text-xs shadow-xl">
    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
    <div className="space-y-1.5">
      <p className="mb-1.5 flex items-center justify-between gap-4 border-b border-border/60 pb-1.5 font-semibold text-foreground"><span>{t("project_modal.total_tokens")}</span><span>{formatNumber(row.totalTokens)}</span></p>
      <p className="flex items-center justify-between gap-4"><span className="flex items-center gap-1.5 text-muted-foreground"><i className="h-2 w-2 rounded-full bg-blue-600/75" />{t("project_modal.input")}</span><span className="font-mono font-medium text-foreground">{formatNumber(row.nonCachedInputTokens)}</span></p>
      <p className="flex items-center justify-between gap-4"><span className="flex items-center gap-1.5 text-muted-foreground"><i className="h-2 w-2 rounded-full bg-success/80" />{t("project_modal.cached")}</span><span className="font-mono font-medium text-foreground">{formatNumber(row.cachedInputTokens)}</span></p>
      <p className="flex items-center justify-between gap-4"><span className="flex items-center gap-1.5 text-muted-foreground"><i className="h-2 w-2 rounded-full bg-violet-600/70" />{t("project_modal.output")}</span><span className="font-mono font-medium text-foreground">{formatNumber(row.outputTokens)}</span></p>
      <p className="mt-1.5 flex items-center justify-between gap-4 border-t border-border/60 pt-1.5 font-semibold text-primary"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-primary" />{t("common.cost")}</span><span className="font-mono">{formatCurrencyShort(row.costUSD)}</span></p>
    </div>
  </div>;
}

export function ProjectSessionsModal({ project, range, onClose, onGoToSessions, onSessionClick, isActive = true }: ProjectSessionsModalProps) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<SessionDetailRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<ProjectAnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useModalFocus(dialogRef, closeButtonRef, onClose, isActive);

  useEffect(() => {
    let active = true;
    setAnalytics(null);
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    void fetchProjectAnalytics(project.project, range).then((data) => {
      if (active) setAnalytics(data);
    }).catch((error) => {
      if (active) setAnalyticsError(error instanceof Error ? error.message : String(error));
    }).finally(() => { if (active) setAnalyticsLoading(false); });
    return () => { active = false; };
  }, [project.project, range]);

  useEffect(() => {
    let active = true;
    setSessionsLoading(true);
    setSessionsError(null);
    void fetchSessionDetails().then((data) => {
      if (active) setSessions(data.filter((session) => session.projects?.includes(project.project)));
    }).catch((error) => {
      if (active) setSessionsError(error instanceof Error ? error.message : t("project_modal.no_sessions"));
    }).finally(() => { if (active) setSessionsLoading(false); });
    return () => { active = false; };
  }, [project.project, t]);

  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sessions;
    return sessions.filter((session) => session.threadName?.toLowerCase().includes(query)
      || cleanSessionId(session.sessionId).toLowerCase().includes(query)
      || session.models?.some((model) => model.toLowerCase().includes(query))
      || sessionProjectReferences(session).some((reference) => [reference.codexProjectName, reference.displayName, reference.path]
        .some((value) => value?.toLowerCase().includes(query))));
  }, [searchQuery, sessions]);

  const trendData = useMemo(() => analytics?.daily.map((day) => ({ ...day, shortDate: formatTrendDateLabel(day.date), nonCachedInputTokens: Math.max(day.inputTokens - day.cachedInputTokens, 0) })) ?? [], [analytics]);
  const summary = analytics?.summary;
  const summaryParts = summary ? projectTokenBreakdown(summary) : null;
  const cacheHitRate = summary && summary.inputTokens > 0 ? summary.cachedInputTokens / summary.inputTokens : 0;
  const maxDailyTokens = Math.max(...trendData.map((day) => day.totalTokens), 1);
  const maxDailyCost = Math.max(...trendData.map((day) => day.costUSD), 0);
  const tokenAxisWidth = getYAxisWidth(maxDailyTokens, formatCompactNumber, 64);
  const costAxisWidth = getYAxisWidth(maxDailyCost, formatCurrencyShort, 72);

  const rangeSessionCount = analytics ? new Set(sessions.filter((session) => {
    const dates = session.totalTokens > 0 && session.dailyUsage.length > 0
      ? session.dailyUsage.filter((day) => day.projects.includes(project.project)).map((day) => day.date)
      : [new Intl.DateTimeFormat("en-CA", { timeZone: analytics.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(session.modifiedAtMs)];
    return dates.some((date) => date >= analytics.startDate && date <= analytics.endDate);
  }).map((session) => session.path)).size : 0;

  return <div ref={dialogRef} className="fixed inset-0 z-50 flex flex-col overflow-hidden overscroll-contain bg-background text-foreground" role="dialog" aria-modal={isActive ? "true" : undefined} aria-labelledby="modal-project-title" aria-hidden={!isActive} inert={!isActive}>
    <header className="shrink-0 border-b border-border/70 bg-surface px-4 py-1.5 shadow-sm" data-testid="project-modal-header">
      <div className="flex min-h-8 items-center gap-2">
        <Folder className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <h2 id="modal-project-title" className="truncate text-base font-bold tracking-tight">{projectLabel(analytics ?? project)}</h2>
            {(analytics?.codexProjectName ?? project.codexProjectName) ? <span className="shrink-0 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-500">{t("projects.codex_project")}</span> : null}
          </div>
          <p className="truncate font-mono text-[10px] text-muted-foreground" title={project.project}>{project.project}</p>
        </div>
        <Button variant="secondary" size="sm" className="shrink-0 text-xs" onClick={() => onGoToSessions(project.project)}>{t("project_modal.view_in_sessions_tab")}<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button>
        <Button ref={closeButtonRef} variant="secondary" size="sm" className="h-8 w-8 shrink-0 p-0" onClick={onClose} aria-label={t("project_modal.close_aria")}><X className="h-4 w-4" /></Button>
      </div>
      {analytics && summary && summaryParts ? <>
        <p className="mt-1 text-[10px] text-muted-foreground">{t("project_modal.analytics_range", { start: analytics.startDate, end: analytics.endDate, timezone: analytics.timezone })}</p>
        <div className="flex flex-wrap gap-1.5 pt-1 pb-0.5" aria-label={t("project_modal.analytics_title")}>
          <MetricBadge label={t("project_modal.total_tokens")} value={formatNumber(summary.totalTokens)} icon={<Database className="h-3.5 w-3.5" />} tone="violet" />
          <MetricBadge label={t("project_modal.input_total")} value={formatNumber(summary.inputTokens)} icon={<Database className="h-3.5 w-3.5" />} tone="blue" />
          <MetricBadge label={t("projects.values.uncached")} value={formatNumber(summaryParts.nonCachedInput)} icon={<Database className="h-3.5 w-3.5" />} tone="blue" />
          <MetricBadge label={t("project_modal.cached")} value={formatNumber(summaryParts.cachedInput)} icon={<Database className="h-3.5 w-3.5" />} tone="cyan" />
          <MetricBadge label={t("project_modal.output")} value={formatNumber(summaryParts.output)} icon={<Database className="h-3.5 w-3.5" />} tone="green" />
          <MetricBadge label={t("project_modal.estimated_cost")} value={formatCurrency(summary.costUSD)} icon={<Coins className="h-3.5 w-3.5" />} tone="emerald" />
          <MetricBadge label={t("project_modal.cache_hit")} value={formatPercent(cacheHitRate)} icon={<Database className="h-3.5 w-3.5" />} tone="cyan" />
          <MetricBadge label={t("common.sessions")} value={sessionsLoading || sessionsError ? "—" : formatNumber(rangeSessionCount)} icon={<Terminal className="h-3.5 w-3.5" />} tone="amber" />
        </div>
      </> : null}
    </header>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 [overflow-anchor:none]" data-testid="project-modal-scroll">
      {analyticsLoading ? <div className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">{t("project_modal.analytics_loading")}</div>
        : analyticsError ? <div className="rounded-xl border border-error/20 bg-error/5 p-4 text-sm text-error">{t("project_modal.analytics_error")}: {analyticsError}</div>
          : analytics ? (
          <Card className="overflow-hidden" data-testid="project-daily-trend">
            <CardHeader className="flex flex-row items-start justify-between gap-3 border-b border-border/80">
              <div><CardTitle>{t("project_modal.daily_trend")}</CardTitle><CardDescription>{t("project_modal.daily_trend_desc")}</CardDescription></div>
              <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground" aria-label={t("project_modal.daily_trend")}>
                <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-blue-600/75" />{t("project_modal.input")}</span>
                <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-success/80" />{t("project_modal.cached")}</span>
                <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-violet-600/70" />{t("project_modal.output")}</span>
                <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-primary" />{t("common.cost")}</span>
              </div>
            </CardHeader>
            <CardContent className="p-3.5">
              {trendData.every((day) => day.totalTokens === 0 && day.costUSD === 0) ? <p className="py-16 text-center text-sm text-muted-foreground">{t("project_modal.no_trend_data")}</p> : <div className="h-64 min-w-0"><ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}><ComposedChart data={trendData} barGap={4} barCategoryGap="32%" margin={{ top: 18, right: 10, left: 4, bottom: 6 }}>
                <defs><linearGradient id="projectCostGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgb(var(--primary))" stopOpacity={0.1} /><stop offset="80%" stopColor="rgb(var(--primary))" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="rgb(var(--border) / 0.45)" strokeDasharray="3 8" vertical={false} />
                <XAxis dataKey="shortDate" dy={10} interval="preserveStartEnd" minTickGap={12} tickLine={false} axisLine={false} tick={{ fill: "rgb(var(--muted-foreground) / 0.72)", fontSize: 11 }} />
                <YAxis yAxisId="tokens" width={tokenAxisWidth} tickLine={false} axisLine={false} tick={{ fill: "rgb(var(--muted-foreground) / 0.7)", fontSize: 11 }} tickFormatter={(value) => formatCompactNumber(Number(value))} />
                <YAxis yAxisId="cost" orientation="right" width={costAxisWidth} tickLine={false} axisLine={false} tick={{ fill: "rgb(var(--primary) / 0.78)", fontSize: 11 }} tickFormatter={(value) => formatCurrencyShort(Number(value))} />
                <Tooltip content={<TrendTooltip t={t} />} cursor={{ stroke: "rgb(var(--primary) / 0.22)", strokeDasharray: "4 4", strokeWidth: 1 }} />
                <Area yAxisId="cost" type="monotone" dataKey="costUSD" fill="url(#projectCostGradient)" stroke="none" activeDot={false} isAnimationActive={false} />
                <Bar yAxisId="tokens" dataKey="nonCachedInputTokens" stackId="tokens" fill="rgb(37 99 235 / 0.72)" maxBarSize={24} isAnimationActive={false} />
                <Bar yAxisId="tokens" dataKey="cachedInputTokens" stackId="tokens" fill="rgb(var(--success) / 0.78)" maxBarSize={24} isAnimationActive={false} />
                <Bar yAxisId="tokens" dataKey="outputTokens" stackId="tokens" fill="rgb(124 58 237 / 0.72)" maxBarSize={24} radius={[5, 5, 0, 0]} isAnimationActive={false} />
                <Line yAxisId="cost" type="monotone" dataKey="costUSD" stroke="rgb(var(--primary))" strokeWidth={2.75} dot={{ r: 2.8, strokeWidth: 1.5, fill: "rgb(var(--surface))" }} activeDot={{ r: 5.5, strokeWidth: 2.25, fill: "rgb(var(--surface))" }} isAnimationActive={false} />
              </ComposedChart></ResponsiveContainer></div>}
            </CardContent>
          </Card>
          ) : <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t("project_modal.no_analytics")}</div>}
      <section aria-labelledby="project-sessions-title" className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 id="project-sessions-title" className="text-sm font-bold">{t("project_modal.sessions_list")}</h3>
            <p className="text-xs text-muted-foreground">{t("project_modal.subtitle_desc")}</p>
            {searchQuery ? <p className="text-xs text-muted-foreground">{t("project_modal.showing_filtered", { filtered: new Set(filteredSessions.map((session) => session.path)).size })}</p> : null}
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input aria-label={t("project_modal.search_aria")} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t("project_modal.search_placeholder")} className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-xs outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
        </div>
        {sessionsLoading ? <div className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">{t("loading.loading_sessions")}</div>
          : sessionsError ? <div className="rounded-xl border border-error/20 bg-error/5 p-4 text-sm text-error">{sessionsError}</div>
            : filteredSessions.length === 0 ? <div className="rounded-xl border border-dashed border-border p-8 text-center"><Terminal className="mx-auto h-6 w-6 text-muted-foreground" /><p className="mt-2 text-sm font-medium">{searchQuery ? t("project_modal.no_matching_sessions") : t("project_modal.no_sessions")}</p></div>
              : <SessionUsageTable sessions={filteredSessions} selectedProject={project.project} onSessionClick={onSessionClick} embedded />}
      </section>
    </div>
  </div>;
}
