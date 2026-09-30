import { $, browser, expect } from "@wdio/globals";
import type { MonthlyUsageResponse } from "../src/lib/api";

describe("monthly quota consumption", () => {
  it("shows native monthly quota totals after opening the monthly tab", async () => {
    const dailyTab = $('[data-testid="daily-nav-tab"]');
    await dailyTab.waitForDisplayed({ timeout: 90_000 });
    await dailyTab.click();
    await $('[data-daily-row]').waitForDisplayed({ timeout: 15_000 });
    await expect($('[data-monthly-row]')).not.toBeExisting();

    await $('[data-testid="monthly-nav-tab"]').click();
    await $('[data-monthly-row]').waitForDisplayed({ timeout: 15_000 });
    const data = await browser.execute(async () => {
      const runtime = (window as unknown as {
        __TAURI_INTERNALS__: { invoke: (command: string) => Promise<MonthlyUsageResponse> };
      }).__TAURI_INTERNALS__;
      return runtime.invoke("fetch_monthly_usage");
    });
    const rows = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>("[data-monthly-row]")].map((row) => ({
        month: row.dataset.monthlyRow,
        fiveHour: row.querySelector('[data-quota="fiveHour"]')?.textContent,
        weekly: row.querySelector('[data-quota="weekly"]')?.textContent,
      })),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const month = data.monthly.find((month) => month.month === row.month)!;
      for (const [key, percent] of [
        ["fiveHour", month.fiveHourPercent],
        ["weekly", month.weeklyPercent],
      ] as const) {
        // The current month can change while this test generates new Codex usage.
        if (row.month === data.endMonth) {
          expect(row[key]).toMatch(/\d+%|--/);
          continue;
        }
        expect(row[key]).toContain(percent == null ? "--" : percent < 0.5 ? "<1%" : `${Math.round(percent)}%`);
      }
    }
  }).timeout(180_000);
});
