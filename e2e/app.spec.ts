import { $, $$, browser, expect } from "@wdio/globals";

describe("Codex Usage Desktop page", () => {
  it("loads inside the Tauri WebView", async () => {
    await expect(browser).toHaveTitle("Codex Usage Desktop");
    await expect($("#root")).toBeDisplayed();

    const hasTauriRuntime = await browser.execute(
      () => "__TAURI_INTERNALS__" in window,
    );
    expect(hasTauriRuntime).toBe(true);
  });

  it("shows both 24-hour and 48-hour reset probabilities", async () => {
    const forecast = $('[data-testid="quota-forecast"]');
    const forecast24h = $('[data-forecast-horizon="24h"]');
    const forecast48h = $('[data-forecast-horizon="48h"]');

    await forecast.waitForDisplayed({ timeout: 10_000 });
    await expect(forecast24h).toBeDisplayed();
    await expect(forecast48h).toBeDisplayed();
    expect(await forecast24h.getText()).toMatch(/^\d+\s*24h$/);
    expect(await forecast48h.getText()).toMatch(/^\d+\s*48h$/);
  });

  it("shows five-hour and weekly consumption in daily usage", async () => {
    await $('[data-testid="daily-nav-tab"]').click();
    const fiveHour = $('[data-daily-row] [data-quota="fiveHour"]');
    const weekly = $('[data-daily-row] [data-quota="weekly"]');
    await fiveHour.waitForDisplayed({ timeout: 15_000 });
    await expect(weekly).toBeDisplayed();
    expect(await fiveHour.getText()).toMatch(/%|--/);
    expect(await weekly.getText()).toMatch(/%|--/);
  });

  it("shows a daily trend for each project in the selected range", async () => {
    const projectTab = $('[data-testid="projects-nav-tab"]');
    await projectTab.waitForDisplayed({ timeout: 90_000 });
    await projectTab.click();
    await $('[data-testid="project-comparison"]').waitForDisplayed({ timeout: 90_000 });

    const projectRows = await $$('[data-testid="project-comparison"] tbody tr[role="button"]');
    const trends = await $$('[data-project-trend]');
    const projectRowCount = await projectRows.length;
    expect(await trends.length).toBe(projectRowCount);
    if (projectRowCount > 0) {
      await expect(projectRows[0].$$('td')).toBeElementsArrayOfSize(3);
      await expect(projectRows[0].$('td:nth-child(2) [data-testid="usage-trends-card"]')).toBeDisplayed();
      const usageCell = projectRows[0].$('td:nth-child(3)');
      await expect(usageCell.$('[data-cost-tone]')).toBeExisting();
      await expect(usageCell.$('dl')).toBeDisplayed();
      await expect(usageCell.$$('dl > div')).toBeElementsArrayOfSize(3);
      await expect(trends[0].$('[data-testid="usage-trends-card"]')).toBeDisplayed();
    }
  }).timeout(180_000);

  it("opens the pricing catalog and refreshes without leaving the app unusable", async () => {
    await $('[data-testid="models-nav-tab"]').click();
    const quotaEstimates = $('[data-testid="model-quota-estimates"]');
    await quotaEstimates.waitForDisplayed({ timeout: 15_000 });
    const quotaModel = quotaEstimates.$("[data-quota-model]");
    await expect(quotaModel.$("summary")).toBeDisplayed();
    await expect(quotaModel.$$("[data-quota-metric='percent']")).toBeElementsArrayOfSize(2);
    await expect(quotaModel.$$("[data-quota-metric='percentPerMillionTokens']")).toBeElementsArrayOfSize(2);
    await quotaModel.$("summary").click();
    await expect(quotaModel.$("[data-quota-details]")).toBeDisplayed();
    await $('[data-testid="models-catalog-tab"]').click();

    const catalog = $('[data-testid="pricing-catalog"]');
    const refresh = $('[data-testid="refresh-pricing"]');
    await refresh.waitForEnabled({ timeout: 10_000 });
    await refresh.click();
    await refresh.waitForEnabled({ timeout: 15_000 });

    const search = $('[data-testid="pricing-search"]');
    await search.setValue("gpt-6-");
    const catalogText = await catalog.getText();
    expect(catalogText).toContain("gpt-6-sol");
    expect(catalogText).toContain("gpt-6-luna");
  }).timeout(240_000);
});
