import { $, browser, expect } from "@wdio/globals";
import type { OverviewResponse, ProjectAnalyticsResponse, ProjectSessionDaysResponse, SessionDetailRow } from "../src/lib/api";

describe("project session date range", () => {
  it("shows the selected range, doubles it from the bottom button and preserves dates after session detail", async () => {
    const previousLanguage = await browser.execute(() => localStorage.getItem("language"));
    try {
      await browser.execute(() => localStorage.setItem("language", "en"));
      await browser.refresh();
      await $('[data-testid="projects-nav-tab"]').waitForDisplayed({ timeout: 90_000 });
      await $('[data-testid="projects-nav-tab"]').click();
      await $('[data-testid="project-comparison"] tbody tr[role="button"]').waitForDisplayed({ timeout: 90_000 });
      const candidate = await browser.execute(async () => {
        const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string, args: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
        const overview = await runtime.invoke<OverviewResponse>("fetch_overview", { range: "30d" });
        for (const project of overview.projects) {
          const page = await runtime.invoke<ProjectSessionDaysResponse>("fetch_project_session_days", { project: project.project, range: "30d", query: "", before: null });
          const analytics = await runtime.invoke<ProjectAnalyticsResponse>("fetch_project_analytics", { project: project.project, range: "30d" });
          const activeDates = analytics.daily.filter((day) => day.totalTokens > 0).map((day) => day.date).reverse();
          if (activeDates.length <= 7) continue;
          const extendedStart = new Date(Date.parse(`${page.startDate}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
          const extendedRange = `custom:${extendedStart}_${page.endDate}`;
          const extended = await runtime.invoke<ProjectSessionDaysResponse>("fetch_project_session_days", { project: project.project, range: extendedRange, query: "", before: null });
          const olderDate = extended.days.find((day) => day.date < page.startDate)?.date;
          if (olderDate) return { project: project.project, page, analytics, activeDates, extended, extendedRange, olderDate };
        }
        throw new Error("Date-range regression needs a project with more than seven active dates in the last 30 days and sessions in the preceding 30 days");
      });
      const rowIndex = await browser.execute((path) => [...document.querySelectorAll('[data-testid="project-comparison"] tbody tr[role="button"]')].findIndex((row) => row.querySelector("td > p")?.textContent === path), candidate.project);
      expect(rowIndex).toBeGreaterThanOrEqual(0);
      const row = $(`[data-testid="project-comparison"] tbody tr[role="button"]:nth-child(${rowIndex + 1})`);
      await row.execute((element) => element.scrollIntoView({ behavior: "instant", block: "center" }));
      await row.click();
      const project = $('[aria-labelledby="modal-project-title"]');
      await project.waitForDisplayed();
      await $('[aria-labelledby="modal-project-title"] [data-testid="session-card"]').waitForExist({ timeout: 90_000 });
      const initial = await browser.execute(() => [...document.querySelectorAll('[aria-labelledby="modal-project-title"] [id^="date-group-"]')].map((group) => ({ date: group.id.slice("date-group-".length), expanded: group.querySelector("button")!.getAttribute("aria-expanded") })));
      let dates = initial.map((day) => day.date);
      expect(dates).toEqual(candidate.page.days.map((day) => day.date));
      expect(dates.length).toBeGreaterThan(7);
      for (const date of candidate.activeDates) expect(dates).toContain(date);
      expect(candidate.page.startDate).toBe(candidate.analytics.startDate);
      expect(candidate.page.endDate).toBe(candidate.analytics.endDate);
      await expect($('button=Load more days')).toBeExisting();
      expect(initial[0].expanded).toBe("true");
      expect(initial.slice(1).every((day) => day.expanded === "false")).toBe(true);
      expect(new Set(dates).size).toBe(dates.length);
      expect(dates.every((date) => date >= candidate.page.startDate && date <= candidate.page.endDate)).toBe(true);
      const firstToggle = $(`#date-group-${dates[0]} > button`);
      await firstToggle.execute((element) => element.scrollIntoView({ behavior: "instant", block: "center" }));
      await firstToggle.click();
      await expect(firstToggle).toHaveAttribute("aria-expanded", "false");
      const more = $('button=Load more days');
      await more.execute((element) => element.scrollIntoView({ behavior: "instant", block: "end" }));
      await more.waitForDisplayed();
      await more.click();
      await expect($('[data-testid="project-modal-header"]')).toHaveText(expect.stringContaining(`${candidate.extended.startDate} – ${candidate.extended.endDate}`));
      await $('[data-testid="project-daily-trend"]').execute((element) => element.scrollIntoView({ behavior: "instant", block: "center" }));
      await expect($('[data-testid="project-daily-trend"] .recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')).toHaveText(candidate.extended.startDate.slice(5));
      dates = await browser.execute(() => [...document.querySelectorAll('[aria-labelledby="modal-project-title"] [id^="date-group-"]')].map((group) => group.id.slice("date-group-".length)));
      expect(dates).toEqual(candidate.extended.days.map((day) => day.date));
      await expect(firstToggle).toHaveAttribute("aria-expanded", "false");
      const doubledAgain = await browser.execute(async ({ path, start, end }) => {
        const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string, args: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
        const nextStart = new Date(Date.parse(`${start}T00:00:00Z`) - 60 * 86_400_000).toISOString().slice(0, 10);
        const range = `custom:${nextStart}_${end}`;
        const data = await runtime.invoke<ProjectSessionDaysResponse>("fetch_project_session_days", { project: path, range, query: "", before: null });
        return { range, data };
      }, { path: candidate.project, start: candidate.extended.startDate, end: candidate.extended.endDate });
      await more.execute((element) => element.scrollIntoView({ behavior: "instant", block: "end" }));
      await more.click();
      await expect($('[data-testid="project-modal-header"]')).toHaveText(expect.stringContaining(`${doubledAgain.data.startDate} – ${doubledAgain.data.endDate}`));
      dates = await browser.execute(() => [...document.querySelectorAll('[aria-labelledby="modal-project-title"] [id^="date-group-"]')].map((group) => group.id.slice("date-group-".length)));
      expect(dates).toEqual(doubledAgain.data.days.map((day) => day.date));
      expect(new Set(dates).size).toBe(dates.length);
      await expect(firstToggle).toHaveAttribute("aria-expanded", "false");
      const olderDate = candidate.olderDate;
      const olderToggle = $(`#date-group-${olderDate} > button`);
      await olderToggle.execute((element) => element.scrollIntoView({ behavior: "instant", block: "center" }));
      await olderToggle.click();
      const card = $(`#date-group-${olderDate} [data-testid="session-card"]`);
      await card.waitForDisplayed({ timeout: 90_000 });
      await card.execute((element) => element.scrollIntoView({ behavior: "instant", block: "center" }));
      await card.click();
      await $('[aria-labelledby="session-detail-title"]').waitForDisplayed();
      await browser.keys("Escape");
      await $('[aria-labelledby="session-detail-title"]').waitForExist({ reverse: true });
      await expect(olderToggle).toHaveAttribute("aria-expanded", "true");
      expect(await browser.execute(() => document.querySelectorAll('[aria-labelledby="modal-project-title"] [id^="date-group-"]').length)).toBe(dates.length);
      const oldSessions = await browser.execute(async ({ path, date, range }) => {
        const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => Promise<SessionDetailRow[]> } }).__TAURI_INTERNALS__;
        return runtime.invoke("fetch_project_day_sessions", { project: path, range, date, query: "" });
      }, { path: candidate.project, date: olderDate, range: doubledAgain.range });
      const search = $('[aria-label="Search project sessions"]');
      const query = oldSessions[0].sessionId.replace(/\.jsonl$/, "");
      await search.setValue(query);
      await browser.waitUntil(async () => browser.execute(() => document.querySelector('[aria-labelledby="modal-project-title"]')!.textContent!.includes("matching sessions")));
      await $('[aria-labelledby="modal-project-title"] [data-testid="session-card"]').waitForDisplayed({ timeout: 90_000 });
      expect(await browser.execute((query) => document.querySelector('[aria-labelledby="modal-project-title"]')!.textContent!.includes(query), query)).toBe(true);
      await browser.keys("Escape");
      await project.waitForExist({ reverse: true });
    } finally {
      await browser.execute((language) => {
        if (language === null) localStorage.removeItem("language");
        else localStorage.setItem("language", language);
      }, previousLanguage);
    }
  }).timeout(300_000);
});
