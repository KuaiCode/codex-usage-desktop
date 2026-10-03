import { $, browser, expect } from "@wdio/globals";
import type { OverviewResponse, ProjectSessionDaysResponse, SessionDetailRow } from "../src/lib/api";

describe("project session pagination", () => {
  it("loads more selected-range dates through native commands and preserves them after session detail", async () => {
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
          if (page.nextBefore) return { project: project.project, page };
        }
        throw new Error("Pagination regression needs a project with more than seven active dates in the last 30 days");
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
      expect(initial.map((day) => day.date)).toEqual(candidate.page.days.map((day) => day.date));
      expect(initial[0].expanded).toBe("true");
      expect(initial.slice(1).every((day) => day.expanded === "false")).toBe(true);
      const next = await browser.execute(async ({ path, before }) => {
        const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => Promise<ProjectSessionDaysResponse> } }).__TAURI_INTERNALS__;
        return runtime.invoke("fetch_project_session_days", { project: path, range: "30d", query: "", before });
      }, { path: candidate.project, before: candidate.page.nextBefore });
      const more = $('button=Load more days');
      await more.execute((element) => element.scrollIntoView({ behavior: "instant", block: "center" }));
      await more.click();
      await $(`#date-group-${next.days[0].date}`).waitForExist();
      const dates = await browser.execute(() => [...document.querySelectorAll('[aria-labelledby="modal-project-title"] [id^="date-group-"]')].map((group) => group.id.slice("date-group-".length)));
      expect(dates).toEqual([...candidate.page.days, ...next.days].map((day) => day.date));
      expect(new Set(dates).size).toBe(dates.length);
      expect(dates.every((date) => date >= candidate.page.startDate && date <= candidate.page.endDate)).toBe(true);
      const olderToggle = $(`#date-group-${next.days[0].date} > button`);
      await olderToggle.execute((element) => element.scrollIntoView({ behavior: "instant", block: "center" }));
      await olderToggle.click();
      const card = $(`#date-group-${next.days[0].date} [data-testid="session-card"]`);
      await card.waitForDisplayed({ timeout: 90_000 });
      await card.execute((element) => element.scrollIntoView({ behavior: "instant", block: "center" }));
      await card.click();
      await $('[aria-labelledby="session-detail-title"]').waitForDisplayed();
      await browser.keys("Escape");
      await $('[aria-labelledby="session-detail-title"]').waitForExist({ reverse: true });
      await expect(olderToggle).toHaveAttribute("aria-expanded", "true");
      expect(await browser.execute(() => document.querySelectorAll('[aria-labelledby="modal-project-title"] [id^="date-group-"]').length)).toBe(dates.length);
      const oldSessions = await browser.execute(async ({ path, date }) => {
        const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: Record<string, unknown>) => Promise<SessionDetailRow[]> } }).__TAURI_INTERNALS__;
        return runtime.invoke("fetch_project_day_sessions", { project: path, range: "30d", date, query: "" });
      }, { path: candidate.project, date: next.days[0].date });
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
