import { $, browser, expect } from "@wdio/globals";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import type { SessionDetailRow } from "../src/lib/api";

// Reuse the isolated Codex home and application database from the refresh suite.
describe("compressed session usage", () => {
  const run = process.env.CODEX_USAGE_REFRESH_E2E === "1" ? it : it.skip;

  run("follows a compressed replacement and refreshes its conversation and totals", async () => {
    const home = process.env.CODEX_HOME!;
    const sessions = join(home, "sessions");
    mkdirSync(sessions, { recursive: true });
    const id = "01977e3d-d9f6-72b7-93cf-f3f2f83c382c";
    const plain = join(sessions, `rollout-2026-10-15T09-00-00-${id}.jsonl`);
    const compressed = `${plain}.zst`;
    const timestamp = new Date().toISOString();
    const log = (tokens: number, reply: string) => [
      { timestamp, type: "session_meta", payload: { id, cwd: "/compressed-test" } },
      { timestamp, type: "turn_context", payload: { model: "gpt-5", cwd: "/compressed-test" } },
      { timestamp, type: "event_msg", payload: { type: "task_started", turn_id: "turn-1" } },
      { timestamp, type: "event_msg", payload: { type: "user_message", message: "Compressed session prompt" } },
      { timestamp, type: "event_msg", payload: { type: "agent_message", message: reply } },
      { timestamp, type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: tokens, output_tokens: 10, total_tokens: tokens + 10 } } } },
    ].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
    writeFileSync(plain, log(100, "Before compression"));
    await browser.execute(async () => {
      localStorage.setItem("language", "en");
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
      await runtime.invoke("scan_usage");
    });
    await browser.refresh();
    await $('[data-testid="projects-nav-tab"]').waitForDisplayed({ timeout: 90_000 });
    await $('[data-testid="projects-nav-tab"]').click();
    const row = $('//tr[@role="button" and .//p[text()="/compressed-test"]]');
    await row.waitForDisplayed();
    await row.click();
    const project = $('[aria-labelledby="modal-project-title"]');
    await project.waitForDisplayed();
    const card = project.$('[data-testid="session-card"]:has(h3[title="Compressed session prompt"])');
    await card.waitForDisplayed();
    await card.click();
    const detail = $('[aria-labelledby="session-detail-title"]');
    await detail.waitForDisplayed();
    await expect(detail).toHaveText(expect.stringContaining("Before compression"));
    await expect(detail.$('[aria-label="Session summary"]')).toHaveText(expect.stringContaining("110"));

    const raw = log(500, "Reply from compressed session");
    writeFileSync(compressed, zstdCompressSync(Buffer.from(raw)));
    unlinkSync(plain);
    const refresh = detail.$('button=Refresh this session');
    await refresh.waitForEnabled();
    await refresh.click();
    await expect(detail).toHaveText(expect.stringContaining("Reply from compressed session"));
    await expect(detail.$('[aria-label="Session summary"]')).toHaveText(expect.stringContaining("510"));
    await $('button=Raw JSONL').click();
    await expect(detail.$("pre")).toHaveText(expect.stringContaining(raw.trim()));
    await browser.keys("Escape");
    await detail.waitForExist({ reverse: true });
    await expect(project.$('[data-testid="session-card"]')).toHaveText(expect.stringContaining("510"));

    writeFileSync(compressed, zstdCompressSync(Buffer.from(log(900, "Reply from project refresh"))));
    const refreshProject = project.$('button=Refresh project sessions');
    await refreshProject.waitForEnabled();
    await refreshProject.click();
    await expect(project.$('[data-testid="session-card"]')).toHaveText(expect.stringContaining("910"));
    await project.$('[data-testid="session-card"]').click();
    const reopenedDetail = $('[aria-labelledby="session-detail-title"]');
    await reopenedDetail.waitForDisplayed();
    await expect(reopenedDetail).toHaveText(expect.stringContaining("Reply from project refresh"));
    const indexed = await browser.execute(async () => {
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string) => Promise<T> } }).__TAURI_INTERNALS__;
      return runtime.invoke<SessionDetailRow[]>("fetch_session_details");
    });
    const matching = indexed.filter((session) => session.projects.includes("/compressed-test"));
    expect(matching).toHaveLength(1);
    expect(matching[0].path).toBe(compressed);
    expect(matching[0].agentSessionId).toBe(id);
  }).timeout(180_000);
});
