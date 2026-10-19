import { $, browser, expect } from "@wdio/globals";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionDetailRow, SessionReplayDetail } from "../src/lib/api";

describe("session list turn counts", () => {
  const run = process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;

  run("shows the session's total turns in both session and project lists", async () => {
    const sessions = join(process.env.CODEX_HOME!, "sessions");
    mkdirSync(sessions, { recursive: true });
    const path = join(sessions, "turn-count.jsonl");
    const timestamp = new Date().toISOString();
    const entries = [
      { type: "session_meta", payload: { cwd: "/turn-count-test" } },
      ...[1, 2, 3].flatMap((turn) => [
        { type: "turn_context", payload: { turn_id: `turn-${turn}`, model: "gpt-5" } },
        { type: "event_msg", payload: { type: "task_started", turn_id: `turn-${turn}` } },
        { type: "event_msg", payload: { type: "user_message", message: "Count my turns" } },
        { type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 100, output_tokens: 10 } } } },
      ]),
    ];
    writeFileSync(path, entries.map((entry) => JSON.stringify({ timestamp, ...entry })).join("\n"));
    const previousLanguage = await browser.execute(async () => {
      const previous = localStorage.getItem("language");
      localStorage.setItem("language", "en");
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
      await runtime.invoke("scan_usage");
      return previous;
    });
    try {
      const counts = await browser.execute(async (path) => {
        const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
        const sessions = await runtime.invoke<SessionDetailRow[]>("fetch_session_details");
        const detail = await runtime.invoke<SessionReplayDetail>("fetch_session_detail", { path });
        return { listed: sessions.find((session) => session.path === path)?.turnCount, detail: detail.summary.turnCount };
      }, path);
      expect(counts).toEqual({ listed: 3, detail: 3 });

      await browser.refresh();
      const sessionsTab = $('button[role="tab"]=Sessions');
      await sessionsTab.waitForDisplayed({ timeout: 90_000 });
      await sessionsTab.click();
      const card = $('[data-testid="session-card"]:has(h3[title="Count my turns"])');
      await card.waitForDisplayed();
      await expect(card.$('[data-testid="session-turn-count"]')).toHaveText("3 turns");

      await $('[data-testid="projects-nav-tab"]').click();
      const projectRow = $('//tr[@role="button" and .//p[text()="/turn-count-test"]]');
      await projectRow.waitForDisplayed();
      await projectRow.click();
      const project = $('[aria-labelledby="modal-project-title"]');
      await project.waitForDisplayed();
      const projectCard = project.$('[data-testid="session-card"]:has(h3[title="Count my turns"])');
      await projectCard.waitForDisplayed();
      await expect(projectCard.$('[data-testid="session-turn-count"]')).toHaveText("3 turns");
      await browser.saveScreenshot("/tmp/codex-usage-session-turn-count.png");
      await browser.keys("Escape");
      await project.waitForExist({ reverse: true });
    } finally {
      await browser.execute((previous) => {
        if (previous === null) localStorage.removeItem("language");
        else localStorage.setItem("language", previous);
      }, previousLanguage);
    }
  }).timeout(180_000);
});
