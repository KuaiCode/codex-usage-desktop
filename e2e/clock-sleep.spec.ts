import { $, browser, expect } from "@wdio/globals";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionReplayDetail } from "../src/lib/api";
import clockSleep from "./fixtures/clock-sleep.json";

describe("session clock.sleep activities", () => {
  const run = process.env.CODEX_USAGE_ARCHIVE_E2E === "1" ? it : it.skip;

  run("merges native sleep records and preserves waiting states, tokens and complete responses", async () => {
    const sessions = join(process.env.CODEX_HOME!, "sessions", "2026", "10", "11");
    mkdirSync(sessions, { recursive: true });
    const id = "clock-sleep-responses";
    const path = join(sessions, `${id}.jsonl`);
    const timestamp = "2026-10-10T18:29:00.000Z";
    const call = (callId: string, namespace = "clock") => ({ timestamp, type: "response_item", payload: {
      type: "function_call", call_id: callId, name: "sleep", namespace, arguments: '{"duration_ms":20000}',
    } });
    const completion = (callId: string) => ({ timestamp, type: "event_msg", payload: {
      type: "item_completed", item: { type: "Extension", kind: "clock.sleep", id: callId, durationMs: 20000 },
    } });
    const output = (callId: string, text: string, status = "completed") => ({ timestamp, type: "response_item", payload: {
      type: "function_call_output", call_id: callId, output: text, status,
    } });
    writeFileSync(path, [
      { timestamp: clockSleep[0].timestamp, type: "session_meta", payload: { id, cwd: "/clock-sleep-test" } },
      ...clockSleep,
      call("interrupted"), completion("interrupted"), output("interrupted", "Wall time: 3.1000 seconds\nSleep interrupted by new input."),
      completion("extension-only"), completion("extension-only"),
      call("pending"), call("failed"), output("failed", "Clock unavailable", "failed"),
      call("other", "other"), output("other", "Other namespace result"),
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
      expect(tools.filter((tool) => tool.name === "clock.sleep")).toHaveLength(5);
      const sleep = tools.find((tool) => tool.callId === "call_0Ur6F9JcuFSTucy73TEYF1qx")!;
      expect(sleep.output).toBe("Wall time: 20.0673 seconds\nSleep completed.");
      expect(sleep.commandExecutions ?? []).toHaveLength(0);
      expect(tools.find((tool) => tool.callId === "failed")!.isError).toBe(true);
      expect(tools.find((tool) => tool.callId === "other")!.name).toBe("other.sleep");

      await browser.refresh();
      const sessionsTab = $('button[role="tab"]=Sessions');
      await sessionsTab.waitForDisplayed({ timeout: 90_000 });
      await sessionsTab.click();
      await $('[id^="date-group-"] > button').waitForDisplayed({ timeout: 15_000 });
      for (const day of await browser.$$('[id^="date-group-"] > button')) {
        if (await day.getAttribute("aria-expanded") === "false") await day.click();
      }
      const card = $(`[data-testid="session-card"]*=${id}`);
      await card.waitForDisplayed({ timeout: 15_000 });
      await card.click();
      const dialog = $('[aria-labelledby="session-detail-title"]');
      await dialog.waitForDisplayed();
      const waited = dialog.$('button*=Waited 20 seconds');
      await waited.waitForExist({ timeout: 15_000 });
      expect(await dialog.$$('button*=Waited 20 seconds')).toHaveLength(1);
      await expect(waited).toHaveAttribute("aria-expanded", "false");
      await expect(waited.$('[data-testid="token-metadata"]')).toHaveText("82.3k tokens");
      expect(await dialog.$$('[data-testid="token-metadata"]')).toHaveLength(1);
      expect(await waited.$("..").getText()).not.toContain("Wall time:");
      await waited.execute((element) => element.scrollIntoView({ block: "center" }));
      await waited.click();
      await expect(waited).toHaveAttribute("aria-expanded", "true");
      await expect(waited.$("..")).toHaveText(expect.stringContaining("clock.sleep"));
      await expect(waited.$("..").$('pre')).toHaveText(sleep.output!);
      const raw = waited.$("..").$('button=View raw JSONL');
      await raw.execute((element) => element.scrollIntoView({ block: "center" }));
      await raw.click();
      const rawText = await waited.$("..").getText();
      expect(rawText).toContain('"namespace":"clock"');
      expect(rawText).toContain('"kind":"clock.sleep"');
      expect(rawText).toContain('"type":"function_call_output"');
      expect(rawText).toContain('"type":"token_count"');
      expect(rawText).not.toContain("background-test-command");
      await waited.$("..").$('button=Hide raw JSONL').click();
      await expect(dialog.$('button*=Wait interrupted by new input').$("..")).toHaveAttribute("class", expect.stringContaining("border-cyan-300/70"));
      await expect(dialog.$('button=Wait ended · Requested wait 20 seconds')).toExist();
      await expect(dialog.$('button=Requested wait 20 seconds · Incomplete')).toExist();
      await expect(dialog.$('button=Wait failed').$("..")).toHaveAttribute("class", expect.stringContaining("border-error/40"));
      await expect(dialog.$('button*=other.sleep · completed')).toExist();
      await expect(dialog.$('button*=Ran background-test-command')).toExist();
      await waited.execute((element) => element.scrollIntoView({ block: "start" }));
      await browser.saveScreenshot("/tmp/codex-usage-clock-sleep.png");
      await browser.keys("Escape");
      await dialog.waitForExist({ reverse: true });
    } finally {
      unlinkSync(path);
      await browser.execute((language) => {
        if (language === null) localStorage.removeItem("language");
        else localStorage.setItem("language", language);
      }, previousLanguage);
    }
  }).timeout(180_000);
});
