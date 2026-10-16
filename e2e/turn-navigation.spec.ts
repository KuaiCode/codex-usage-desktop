import { $, browser, expect } from "@wdio/globals";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionReplayDetail } from "../src/lib/api";

describe("session turn navigation", () => {
  const run = process.env.CODEX_USAGE_ARCHIVE_E2E === "1" ? it : it.skip;

  run("jumps to each turn's start and end and expands a collapsed destination", async () => {
    const sessions = join(process.env.CODEX_HOME!, "sessions", "2026", "10", "16");
    mkdirSync(sessions, { recursive: true });
    const id = "01977e3d-d9f6-72b7-93cf-f3f2f83c3999";
    const name = `rollout-2026-10-16T09-00-00-${id}.jsonl`;
    const path = join(sessions, name);
    const timestamp = "2026-10-16T09:00:00Z";
    const usage = { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 300, total_tokens: 1300 };
    writeFileSync(path, [
      { type: "session_meta", payload: { id, cwd: "/turn-navigation-test" } },
      ...[1, 2, 3].flatMap((turn) => [
        { type: "turn_context", payload: { turn_id: `nav-${turn}`, model: "gpt-5" } },
        { type: "event_msg", payload: { type: "task_started", turn_id: `nav-${turn}` } },
        { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: `Navigate turn ${turn}` }] } },
        ...Array.from({ length: 14 }, (_, step) => ({
          type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: `Turn ${turn}, step ${step + 1}.\n\nChecking the replay navigation.\n\nThis content makes the turn taller than the viewport.` }] },
        })),
        { type: "event_msg", payload: { type: "task_complete", turn_id: `nav-${turn}` } },
      ]),
      { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: usage, last_token_usage: usage } } },
    ].map((entry) => JSON.stringify({ timestamp, ...entry })).join("\n"));

    const previousLanguage = await browser.execute(() => localStorage.getItem("language"));
    try {
      await browser.execute(() => localStorage.setItem("language", "en"));
      const detail = await browser.execute(async (path) => {
        const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
        await runtime.invoke("scan_usage");
        return runtime.invoke<SessionReplayDetail>("fetch_session_detail", { path });
      }, path);
      expect(detail.turns.map((turn) => turn.turnId)).toEqual(["nav-1", "nav-2", "nav-3"]);

      await browser.refresh();
      const sessionsTab = $('button[role="tab"]=Sessions');
      await sessionsTab.waitForDisplayed({ timeout: 90_000 });
      await sessionsTab.click();
      const card = $(`[data-testid="session-card"]*=${name.replace(/\.jsonl$/, "")}`);
      await card.waitForDisplayed({ timeout: 15_000 });
      await card.click();
      const dialog = $('[aria-labelledby="session-detail-title"]');
      const navigation = dialog.$('nav[aria-label="Quick navigation"]');
      await navigation.waitForDisplayed();
      await dialog.$('p=This content makes the turn taller than the viewport.').waitForExist();
      await expect(navigation.$$('button')).toBeElementsArrayOfSize(6);

      for (const turn of [1, 2, 3]) {
        const toggle = dialog.$(`button*=Turn nav-${turn}`);
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        const section = toggle.$("./parent::section");
        expect(await section.getSize("height")).toBeGreaterThan(await $('[data-testid="session-detail-scroll"]').getSize("height"));
        for (const position of ["end", "start"] as const) {
          // Pointer actions avoid the embedded driver's post-click focus cancelling smooth scrolling.
          await navigation.$(`button[aria-label^="Navigate to ${position} of turn nav-${turn}"]`).click({ button: "left" });
          await browser.waitUntil(async () => section.execute((element, position) => {
            const viewport = document.querySelector('[data-testid="session-detail-scroll"]')!.getBoundingClientRect();
            const bounds = element.getBoundingClientRect();
            // The summary collapses during scrolling, so verify the edge is visible near its destination.
            const gap = position === "start" ? bounds.top - viewport.top : viewport.bottom - bounds.bottom;
            return gap >= 0 && gap < viewport.height / 4;
          }, position), { timeoutMsg: `Turn ${turn} ${position} should be visible near the viewport edge` });
        }
        if (turn === 2) {
          await toggle.click();
          await expect(toggle).toHaveAttribute("aria-expanded", "false");
          await navigation.$('button[aria-label^="Navigate to end of turn nav-2"]').click({ button: "left" });
          await expect(toggle).toHaveAttribute("aria-expanded", "true");
          await browser.waitUntil(async () => section.execute((element) => {
            const viewport = document.querySelector('[data-testid="session-detail-scroll"]')!.getBoundingClientRect();
            const gap = viewport.bottom - element.getBoundingClientRect().bottom;
            return gap >= 0 && gap < viewport.height / 4;
          }));
        }
      }
      await browser.saveScreenshot("/tmp/codex-usage-turn-navigation.png");
      await browser.keys("Escape");
      await dialog.waitForExist({ reverse: true });
    } catch (error) {
      await browser.saveScreenshot("/tmp/codex-usage-turn-navigation-failure.png");
      throw error;
    } finally {
      await browser.execute((language) => {
        if (language === null) localStorage.removeItem("language");
        else localStorage.setItem("language", language);
      }, previousLanguage);
    }
  }).timeout(180_000);
});
