import { $, browser, expect } from "@wdio/globals";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

describe("model summary layout", () => {
  const run = process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;
  let previousPreferences: Record<string, string | null>;

  before(async () => {
    if (process.env.CODEX_USAGE_REFRESH_E2E !== "1") return;
    const sessions = join(process.env.CODEX_HOME!, "sessions");
    mkdirSync(sessions, { recursive: true });
    const timestamp = new Date().toISOString();
    for (const model of ["gpt-5", "gpt-5.1", "gpt-5.2", "gpt-5.3-codex", "gpt-5.4"]) {
      const entries = [
        { type: "session_meta", payload: { cwd: "/model-summary" } },
        { type: "turn_context", payload: { model } },
        { type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 190_000_000, cached_input_tokens: 180_000_000, output_tokens: 3_700_000, total_tokens: 193_700_000 } } } },
      ];
      writeFileSync(join(sessions, `${model}.jsonl`), entries.map((entry) => JSON.stringify({ timestamp, ...entry })).join("\n"));
    }
    previousPreferences = await browser.execute(async () => {
      const keys = ["language", "sidebar_width", "sidebar_collapsed"];
      const previous = Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
      localStorage.setItem("language", "en");
      localStorage.setItem("sidebar_width", "360");
      localStorage.setItem("sidebar_collapsed", "false");
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
      await runtime.invoke("scan_usage");
      return previous;
    });
    await browser.refresh();
    await $("button=Rescan local logs").waitForEnabled({ timeout: 90_000 });
    await $('[data-testid="models-nav-tab"]').click();
    await $('[data-testid="model-summary"]').waitForDisplayed();
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

  run("keeps all five metrics compact and readable with the widest sidebar", async () => {
    for (const language of ["en", "zh"]) {
      await browser.execute((language) => localStorage.setItem("language", language), language);
      await browser.refresh();
      await $('[data-testid="models-nav-tab"]').click();
      const summary = $('[data-testid="model-summary"]');
      await summary.waitForDisplayed();
      for (const width of [1100, 1440]) {
        await browser.setWindowSize(width, 960);
        const layout = await browser.execute(() => {
          const element = document.querySelector('[data-testid="model-summary"]')!;
          const values = Array.from(element.querySelectorAll("dd"));
          return {
            count: values.length,
            height: element.getBoundingClientRect().height,
            rows: new Set(values.map((value) => Math.round(value.getBoundingClientRect().bottom))).size,
            overflow: Array.from(element.querySelectorAll("dt, dd")).some((item) => item.scrollWidth > item.clientWidth || item.scrollHeight > item.clientHeight),
          };
        });
        expect(layout.count).toBe(5);
        expect(layout.height).toBeLessThanOrEqual(100);
        expect(layout.rows).toBe(1);
        expect(layout.overflow).toBe(false);
        await expect(summary.$("dd")).toHaveText("5");
        await expect(summary).toHaveText(expect.stringContaining("968.5M"));
        await browser.saveScreenshot(`/tmp/codex-model-summary-${language}-${width}.png`);
      }
    }
  });
});
