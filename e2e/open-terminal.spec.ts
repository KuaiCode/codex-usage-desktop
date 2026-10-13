import { $, browser, expect } from "@wdio/globals";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionReplayDetail } from "../src/lib/api";
import openTerminal from "./fixtures/open-terminal.json";

describe("mixed page open and terminal activities", () => {
  const run = process.env.CODEX_USAGE_ARCHIVE_E2E === "1" ? it : it.skip;

  run("separates opened pages, native command output and the running terminal through native replay", async () => {
    const sessions = join(process.env.CODEX_HOME!, "sessions", "2026", "10", "13");
    mkdirSync(sessions, { recursive: true });
    const id = "open-terminal";
    const path = join(sessions, `${id}.jsonl`);
    writeFileSync(path, [
      { timestamp: openTerminal[0].timestamp, type: "session_meta", payload: { id, cwd: "/open-terminal-test" } },
      { timestamp: openTerminal[0].timestamp, type: "turn_context", payload: { turn_id: "01a1342c-17b5-7252-b671-20e21113e4c7", model: "gpt-6" } },
      ...openTerminal,
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
      expect(JSON.parse(tools[0].output!)).toEqual(openTerminal[2].payload.output);
      const native = openTerminal[1].payload.item!;
      expect(tools[0].commandExecutions).toHaveLength(1);
      expect(tools[0].commandExecutions![0].callId).toBe(native.id);
      expect(JSON.parse(tools[0].commandExecutions![0].output!).output).toBe(native.aggregated_output);
      await browser.refresh();
      const sessionsTab = $('button[role="tab"]=Sessions');
      await sessionsTab.waitForDisplayed({ timeout: 90_000 });
      await sessionsTab.click();
      const card = $(`[data-testid="session-card"]*=${id}`);
      await card.waitForDisplayed({ timeout: 15_000 });
      await card.click();
      const dialog = $('[aria-labelledby="session-detail-title"]');
      await dialog.waitForDisplayed();
      const opened = dialog.$('button*=Opened https://github.com');
      await opened.waitForExist();
      await expect(opened).toHaveText(expect.stringContaining("Opened https://developer.apple.com/documentation/appkit/nswindow/performdrag%28with%3A%29?language=objc"));
      const wait = dialog.$('button*=Waited for background terminal');
      await expect(wait).toHaveText(expect.stringContaining("Running"));
      await expect(opened).toHaveAttribute("aria-expanded", "false");
      await expect(wait).toHaveAttribute("aria-expanded", "false");
      expect(await dialog.$$('[data-testid="token-metadata"]')).toHaveLength(1);
      expect(await dialog.$$('button*=Output #')).toHaveLength(0);
      expect(await dialog.getText()).not.toContain("81206");
      expect(await dialog.getText()).not.toContain("Script completed");
      const command = dialog.$('button*=Ran rtk proxy ps');
      await expect(command).toHaveAttribute("aria-expanded", "false");
      expect(await dialog.$$('button*=Ran rtk proxy ps')).toHaveLength(1);
      expect(await dialog.getText()).not.toContain("Warning: truncated output");
      await browser.saveScreenshot("/tmp/codex-usage-open-terminal.png");
      await opened.click();
      await expect(opened.$("..")).toHaveText(expect.stringContaining("performDrag(with:) | Apple Developer Documentation"));
      expect(await opened.$("..").getText()).not.toContain("session_id");
      await expect(wait).toHaveAttribute("aria-expanded", "false");
      await browser.saveScreenshot("/tmp/codex-usage-open-terminal-expanded.png");
      await opened.click();
      await expect(wait).toBeDisabled();
      expect(await wait.$("..").$('pre').isExisting()).toBe(false);
      expect(await wait.$("..").getText()).not.toContain("Apple Developer Documentation");
      await command.click();
      await expect(command.$("..").$('pre')).toHaveText(`└ ${native.aggregated_output.trim()}`);
      expect(await command.$("..").getText()).not.toContain("Apple Developer Documentation");
      const raw = dialog.$('button=View raw JSONL');
      await raw.execute((element) => element.scrollIntoView({ block: "center" }));
      await raw.click();
      const rawText = await dialog.$('button=Hide raw JSONL').$("..").$("..").$('pre').getText();
      expect(rawText).toContain('"type":"custom_tool_call_output"');
      expect(rawText).toContain('"type":"token_count"');
      expect(rawText).toContain('"type":"CommandExecution"');
      expect(rawText).toContain("Warning: truncated output");
      await browser.keys("Escape");
      await dialog.waitForExist({ reverse: true });
    } finally {
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
