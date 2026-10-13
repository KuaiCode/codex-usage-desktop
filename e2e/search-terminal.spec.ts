import { $, browser, expect } from "@wdio/globals";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionReplayDetail } from "../src/lib/api";
import searchTerminal from "./fixtures/search-terminal.json";

describe("mixed search and terminal activities", () => {
  const run = process.env.CODEX_USAGE_ARCHIVE_E2E === "1" ? it : it.skip;

  run("separates search results from the running terminal through native replay", async () => {
    const sessions = join(process.env.CODEX_HOME!, "sessions", "2026", "10", "13");
    mkdirSync(sessions, { recursive: true });
    const id = "search-terminal";
    const path = join(sessions, `${id}.jsonl`);
    writeFileSync(path, [
      { timestamp: searchTerminal[0].timestamp, type: "session_meta", payload: { id, cwd: "/search-terminal-test" } },
      { timestamp: searchTerminal[0].timestamp, type: "turn_context", payload: { turn_id: "search-terminal", model: "gpt-6" } },
      ...searchTerminal,
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
      expect(JSON.parse(tools[0].output!)).toEqual(searchTerminal[1].payload.output);
      await browser.refresh();
      const sessionsTab = $('button[role="tab"]=Sessions');
      await sessionsTab.waitForDisplayed({ timeout: 90_000 });
      await sessionsTab.click();
      const card = $(`[data-testid="session-card"]*=${id}`);
      await card.waitForDisplayed({ timeout: 15_000 });
      await card.click();
      const dialog = $('[aria-labelledby="session-detail-title"]');
      await dialog.waitForDisplayed();
      const search = dialog.$('button*=Searched the web for');
      await search.waitForExist();
      await expect(search).toHaveText(expect.stringContaining("WKWebView performWindowDragWithEvent selection mouseDown mouseUp"));
      const wait = dialog.$('button*=Waited for background terminal');
      await expect(wait).toHaveText(expect.stringContaining("Running"));
      await expect(search).toHaveAttribute("aria-expanded", "false");
      await expect(wait).toHaveAttribute("aria-expanded", "false");
      expect(await dialog.$$('[data-testid="token-metadata"]')).toHaveLength(1);
      expect(await dialog.$$('button*=Output #')).toHaveLength(0);
      expect(await dialog.getText()).not.toContain("81206");
      expect(await dialog.getText()).not.toContain("Script completed");
      await browser.saveScreenshot("/tmp/codex-usage-search-terminal.png");
      await search.click();
      await expect(search.$("..")).toHaveText(expect.stringContaining("performWindowDragWithEvent: | Apple Developer Documentation"));
      expect(await search.$("..").getText()).not.toContain("session_id");
      await expect(wait).toHaveAttribute("aria-expanded", "false");
      await browser.saveScreenshot("/tmp/codex-usage-search-terminal-expanded.png");
      await search.click();
      await expect(wait).toBeDisabled();
      expect(await wait.$("..").$('pre').isExisting()).toBe(false);
      expect(await wait.$("..").getText()).not.toContain("Apple Developer Documentation");
      const raw = dialog.$('button=View raw JSONL');
      await raw.execute((element) => element.scrollIntoView({ block: "center" }));
      await raw.click();
      const rawText = await dialog.$('button=Hide raw JSONL').$("..").$("..").$('pre').getText();
      expect(rawText).toContain('"type":"custom_tool_call_output"');
      expect(rawText).toContain('"type":"token_count"');
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
