import { $, browser, expect } from "@wdio/globals";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CodexLimitsResponse } from "../src/lib/api";

describe("dashboard layout", () => {
  const run = process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;
  let previousPreferences: Record<string, string | null>;

  before(async () => {
    if (process.env.CODEX_USAGE_REFRESH_E2E !== "1") return;
    const sessions = join(process.env.CODEX_HOME!, "sessions");
    mkdirSync(sessions, { recursive: true });
    const timestamp = new Date().toISOString();
    const entries = [
      { type: "session_meta", payload: { cwd: "/dashboard-layout" } },
      { type: "turn_context", payload: { model: "gpt-5" } },
      { type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1234567, cached_input_tokens: 123456, output_tokens: 12345, total_tokens: 1246912 } } } },
    ];
    writeFileSync(join(sessions, "dashboard.jsonl"), entries.map((entry) => JSON.stringify({ timestamp, ...entry })).join("\n"));
    previousPreferences = await browser.execute(async () => {
      const keys = ["language", "sidebar_width", "sidebar_collapsed"];
      const previous = Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
      localStorage.setItem("language", "en");
      localStorage.setItem("sidebar_width", "160");
      localStorage.setItem("sidebar_collapsed", "false");
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
      await runtime.invoke("scan_usage");
      return previous;
    });
    await browser.refresh();
    await $("button=Rescan local logs").waitForEnabled({ timeout: 90_000 });
    // Only the remote account response is mocked; usage loads through native commands.
    const limits: CodexLimitsResponse = {
      session: { usedPercent: 25, remainingPercent: 75, windowMinutes: 300, resetsAt: null },
      weekly: { usedPercent: 40, remainingPercent: 60, windowMinutes: 10080, resetsAt: null },
      membershipLevel: "plus",
      updatedAt: timestamp,
      source: "dashboard-layout-e2e",
    };
    // Tauri's invoke is read-only; stub only this command's IPC response.
    await browser.execute((limits) => {
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (path: string, protocol: string) => string } }).__TAURI_INTERNALS__;
      const url = runtime.convertFileSrc("fetch_codex_limits", "ipc");
      const fetch = window.fetch.bind(window);
      window.fetch = (input, options) => String(input) === url
        ? Promise.resolve(new Response(JSON.stringify(limits), { headers: { "Content-Type": "application/json", "Tauri-Response": "ok" } }))
        : fetch(input, options);
    }, limits);
    await $("button=Check limits").waitForEnabled();
    await $("button=Check limits").click();
    await $('[data-testid="limit-row-5-hour"]').waitForDisplayed();
  });

  after(async () => {
    if (!previousPreferences) return;
    await browser.execute((preferences) => {
      for (const [key, value] of Object.entries(preferences)) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    }, previousPreferences);
    await browser.setWindowSize(1440, 960);
    await browser.refresh();
  });

  run("keeps the hero and quota modules side by side at the minimum window width", async () => {
    await browser.setWindowSize(1100, 760);
    const readLayout = () => browser.execute(() => {
      const trends = document.querySelector('[data-testid="usage-trends-card"]')!;
      const hero = trends.parentElement!.parentElement!;
      const header = document.querySelector("h1")!.parentElement!.parentElement!.parentElement!;
      const limits = document.querySelector('[data-testid="limit-row-5-hour"]')!.parentElement!;
      return {
        heroColumns: getComputedStyle(hero).gridTemplateColumns.split(" ").length,
        headerDirection: getComputedStyle(header).flexDirection,
        quotaColumns: getComputedStyle(limits).gridTemplateColumns.split(" ").length,
      };
    });
    const expected = { heroColumns: 2, headerDirection: "row", quotaColumns: 3 };
    expect(await readLayout()).toEqual(expected);
    await $('button[aria-label="Collapse sidebar"]').click();
    await expect($('button[aria-label="Expand sidebar"]')).toHaveAttribute("aria-expanded", "false");
    expect(await readLayout()).toEqual(expected);
    await browser.saveScreenshot("/tmp/codex-dashboard-layout-1100-collapsed.png");
    await $('button[aria-label="Expand sidebar"]').click();
    expect(await readLayout()).toEqual(expected);
    await browser.saveScreenshot("/tmp/codex-dashboard-layout-1100.png");
  });

  run("keeps all four trend metrics in one row beside the cost summary", async () => {
    for (const width of [1280, 1440]) {
      await browser.setWindowSize(width, 960);
      const metrics = $(".trend-metrics");
      await metrics.scrollIntoView({ block: "center" });
      const layout = await metrics.execute((element) => ({
        columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
        rows: getComputedStyle(element).gridTemplateRows.split(" ").length,
        count: element.children.length,
      }));
      expect(layout).toEqual({ columns: 4, rows: 1, count: 4 });
      await browser.saveScreenshot(`/tmp/codex-dashboard-layout-${width}.png`);
    }
  });
});
