import { $, browser, expect } from "@wdio/globals";
import { copyFileSync, mkdirSync, readFileSync, statSync, utimesSync } from "node:fs";
import { basename, join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import type { SessionDetailRow, SessionReplayDetail } from "../src/lib/api";

// Supply a local rollout to verify real logs without checking private conversations into Git.
describe("existing compressed session", () => {
  const source = process.env.CODEX_USAGE_COMPRESSED_SESSION_E2E;
  const run = source ? it : it.skip;

  run("indexes a real compressed rollout and opens it from the project session list", async () => {
    let path = source!;
    if (process.env.CODEX_USAGE_REFRESH_E2E === "1") {
      const directory = join(process.env.CODEX_HOME!, "sessions");
      mkdirSync(directory, { recursive: true });
      path = join(directory, basename(source!));
      copyFileSync(source!, path);
      const stats = statSync(source!);
      utimesSync(path, stats.atime, stats.mtime);
    }
    const raw = zstdDecompressSync(readFileSync(path)).toString("utf8");
    const entries = raw.trim().split("\n").map((line) => JSON.parse(line));
    const meta = entries.find((entry) => entry.type === "session_meta").payload;
    const totalTokens = entries.reduce((total, entry) => total + (
      entry.type === "event_msg" && entry.payload?.type === "token_count"
        ? entry.payload.info?.last_token_usage?.total_tokens ?? 0 : 0
    ), 0);
    expect(totalTokens).toBeGreaterThan(0);
    const indexed = await browser.execute(async (path) => {
      localStorage.setItem("language", "en");
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
      const scan = await runtime.invoke("scan_usage");
      const sessions = await runtime.invoke<SessionDetailRow[]>("fetch_session_details");
      const session = sessions.find((session) => session.path === path);
      const detail = session ? await runtime.invoke<SessionReplayDetail>("fetch_session_detail", { path }) : null;
      return { scan, session, raw: detail?.rawJsonl, turns: detail?.turns.length };
    }, path);
    expect(indexed.session?.agentSessionId).toBe(meta.id);
    expect(indexed.session?.projects).toContain(meta.cwd);
    expect(indexed.session?.totalTokens).toBe(totalTokens);
    expect(indexed.raw).toBe(raw);
    expect(indexed.turns).toBeGreaterThan(0);
    console.log("[existing compressed session]", JSON.stringify({ path, id: meta.id, totalTokens, scan: indexed.scan }));

    await browser.refresh();
    await $('[data-testid="projects-nav-tab"]').waitForDisplayed({ timeout: 90_000 });
    await $('[data-testid="projects-nav-tab"]').click();
    const row = $(`//tr[@role="button" and .//p[text()=${JSON.stringify(meta.cwd)}]]`);
    await row.waitForExist({ timeout: 90_000 });
    await row.execute((element) => element.scrollIntoView({ behavior: "instant", block: "center" }));
    await row.click();
    const project = $('[aria-labelledby="modal-project-title"]');
    await project.waitForDisplayed();
    await project.$('[aria-label="Search project sessions"]').setValue(meta.id);
    const card = project.$('[data-testid="session-card"]');
    await card.waitForDisplayed({ timeout: 90_000 });
    await expect(project.$$('[data-testid="session-card"]')).toBeElementsArrayOfSize(1);
    await expect(card.$(`[title=${JSON.stringify(path)}]`)).toBeExisting();
    if (process.env.CODEX_USAGE_E2E_SCREENSHOT) await browser.saveScreenshot(process.env.CODEX_USAGE_E2E_SCREENSHOT);
    await card.click();
    const detail = $('[aria-labelledby="session-detail-title"]');
    await detail.waitForDisplayed();
    await expect(detail.$('[aria-label="Session summary"]')).toHaveText(expect.stringContaining(new Intl.NumberFormat("en-US").format(totalTokens)));
    await $('button=Raw JSONL').click();
    await detail.$("pre").waitForDisplayed();
    await expect(detail.$("pre")).toHaveText(expect.stringContaining(meta.id));
    await browser.keys("Escape");
    await detail.waitForExist({ reverse: true });
    await project.$('button=View in Sessions Tab').click();
    await project.waitForExist({ reverse: true });
    await $(`[data-testid="session-card"] [title=${JSON.stringify(path)}]`).waitForDisplayed();
  }).timeout(180_000);
});
