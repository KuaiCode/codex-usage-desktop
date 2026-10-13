import { $, browser, expect } from "@wdio/globals";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionReplayDetail } from "../src/lib/api";
import backgroundPolls from "./fixtures/background-polls.json";

describe("background poll batches", () => {
  const run = process.env.CODEX_USAGE_ARCHIVE_E2E === "1" ? it : it.skip;

  run("keeps failed and running process output separate through native replay", async () => {
    const sessions = join(process.env.CODEX_HOME!, "sessions", "2026", "10", "13");
    mkdirSync(sessions, { recursive: true });
    const id = "background-polls";
    const path = join(sessions, `${id}.jsonl`);
    writeFileSync(path, [
      { timestamp: backgroundPolls[0].timestamp, type: "session_meta", payload: { id, cwd: "/background-polls-test" } },
      { timestamp: backgroundPolls[0].timestamp, type: "turn_context", payload: { turn_id: "polls", model: "gpt-6" } },
      ...backgroundPolls,
    ].map((record) => JSON.stringify(record)).join("\n"));
    const previousLanguage = await browser.execute(() => localStorage.getItem("language"));
    try {
      await browser.execute(() => localStorage.setItem("language", "en"));
      const detail = await browser.execute(async (path) => {
        const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
        await runtime.invoke("scan_usage");
        return runtime.invoke<SessionReplayDetail>("fetch_session_detail", { path });
      }, path);
      const tools = detail.turns.flatMap((turn) => turn.toolCalls);
      expect(tools).toHaveLength(1);
      expect(tools[0].status).toBe("completed");
      expect(tools[0].isError).toBe(false);
      expect(JSON.parse(tools[0].output!)).toEqual(backgroundPolls[1].payload.output);
      await browser.refresh();
      const sessionsTab = $('button[role="tab"]=Sessions');
      await sessionsTab.waitForDisplayed({ timeout: 90_000 });
      await sessionsTab.click();
      const card = $(`[data-testid="session-card"]*=${id}`);
      await card.waitForDisplayed({ timeout: 15_000 });
      await card.click();
      const dialog = $('[aria-labelledby="session-detail-title"]');
      await dialog.waitForDisplayed();
      await browser.waitUntil(async () => (await dialog.$$('button*=Waited for background terminal').length) === 2);
      const waits = await dialog.$$('button*=Waited for background terminal');
      await expect(waits[0]).toHaveText(expect.stringContaining("Failed"));
      await expect(waits[0].$("..")).toHaveElementClass("border-error/40");
      await expect(waits[1]).toHaveText(expect.stringContaining("Running"));
      expect(await dialog.$$('[data-testid="token-metadata"]')).toHaveLength(1);
      expect(await dialog.$$('button*=Output #')).toHaveLength(0);
      expect(await dialog.getText()).not.toContain("write_stdin");
      expect(await dialog.getText()).not.toContain("81206");
      await browser.saveScreenshot("/tmp/codex-usage-background-polls.png");
      for (let index = 0; index < 2; index += 1) {
        const wait = waits[index];
        await expect(wait).toHaveAttribute("aria-expanded", "false");
        expect(await wait.$("..").$('pre').isExisting()).toBe(false);
        await wait.execute((element) => element.scrollIntoView({ block: "center" }));
        await wait.click();
        await expect(wait).toHaveAttribute("aria-expanded", "true");
        const output = JSON.parse(backgroundPolls[1].payload.output![index + 1].text).output;
        await expect(wait.$("..").$('pre')).toHaveText(`└ ${output.trim()}`);
      }
      expect(await waits[0].$("..").getText()).not.toContain("editor-window-drag.spec.ts");
      expect(await waits[1].$("..").getText()).not.toContain("MarkdownEditor.test.tsx");
      await browser.saveScreenshot("/tmp/codex-usage-background-polls-expanded.png");
      const raw = dialog.$('button=View raw JSONL');
      await raw.execute((element) => element.scrollIntoView({ block: "center" }));
      await raw.click();
      const rawText = await dialog.$('button=Hide raw JSONL').$("..").$("..").$('pre').getText();
      expect(rawText).toContain('"type":"custom_tool_call_output"');
      expect(rawText).toContain('"type":"token_count"');
      await browser.keys("Escape");
      await dialog.waitForExist({ reverse: true });
    } finally {
      // Remove this newer session so other specs retain their default expanded day.
      unlinkSync(path);
      await browser.execute(async () => {
        const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
        await runtime.invoke("scan_usage");
      });
      await browser.execute((language) => {
        if (language === null) localStorage.removeItem("language");
        else localStorage.setItem("language", language);
      }, previousLanguage);
    }
  }).timeout(180_000);
});
