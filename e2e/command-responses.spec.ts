import { $, browser, expect } from "@wdio/globals";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { SessionReplayDetail } from "../src/lib/api";
import mixedOrchestration from "./fixtures/mixed-orchestration.json";

describe("session command responses", () => {
  const run = process.env.CODEX_USAGE_ARCHIVE_E2E === "1" ? it : it.skip;

  run("decodes mapped commands and polls from the reported session through native replay", async () => {
    const sessions = join(process.env.CODEX_HOME!, "sessions", "2026", "10", "10");
    mkdirSync(sessions, { recursive: true });
    const id = "01a12575-ca0f-7e81-b256-7fa9f45be72e";
    const name = `rollout-2026-10-10T18-57-18-${id}`;
    const path = join(sessions, `${name}.jsonl`);
    writeFileSync(path, [
      { timestamp: mixedOrchestration[0].timestamp, type: "session_meta", payload: { id, cwd: "/mixed-orchestration-test" } },
      { timestamp: mixedOrchestration[0].timestamp, type: "turn_context", payload: { turn_id: "mixed-turn", model: "gpt-6" } },
      { timestamp: mixedOrchestration[0].timestamp, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Inspect mapped command results" }] } },
      ...mixedOrchestration,
    ].map((record) => JSON.stringify(record)).join("\n"));
    const previousLanguage = await browser.execute(() => localStorage.getItem("language"));
    try {
      await browser.execute(() => localStorage.setItem("language", "en"));
      const detail = await browser.execute(async (path) => {
        const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
        await runtime.invoke("scan_usage");
        return runtime.invoke<SessionReplayDetail>("fetch_session_detail", { path });
      }, path);
      const tool = detail.turns.flatMap((turn) => turn.toolCalls)[0];
      expect(tool.status).toBe("completed");
      expect(JSON.parse(tool.output!)).toEqual(mixedOrchestration[1].payload.output);
      await browser.refresh();
      const sessionsTab = $('button[role="tab"]=Sessions');
      await sessionsTab.waitForDisplayed({ timeout: 90_000 });
      await sessionsTab.click();
      const card = $(`[data-testid="session-card"]*=${name}`);
      await card.waitForDisplayed({ timeout: 15_000 });
      await card.click();
      const dialog = $('[aria-labelledby="session-detail-title"]');
      await dialog.waitForDisplayed();
      const outer = dialog.$('button*=exec · completed');
      await outer.waitForExist({ timeout: 15_000 });
      expect(await dialog.$$('button*=Output #')).toHaveLength(5);
      expect(await dialog.$$('button*=write_stdin · completed')).toHaveLength(0);
      const first = dialog.$('button=Output #1');
      await first.execute((element) => element.scrollIntoView({ block: "center" }));
      await expect(first).toHaveAttribute("aria-expanded", "false");
      expect(await first.$("..").getText()).not.toContain('"chunk_id"');
      await first.click();
      await expect(first).toHaveAttribute("aria-expanded", "true");
      const result = JSON.parse(mixedOrchestration[1].payload.output![1].text);
      await expect(first.$("..").$('pre')).toHaveText(expect.stringContaining(result.output.trim()));
      const failed = dialog.$('button=Output #4');
      await expect(failed.$("..")).toHaveText(expect.stringContaining("Exit code: 101"));
      await expect(dialog.$('button=Output #5').$("..")).toHaveText(expect.stringContaining("Process session: 99948"));
      await outer.execute((element) => element.scrollIntoView({ block: "center" }));
      await outer.click();
      await expect(outer.$("..").$('pre')).toHaveText(expect.stringContaining(mixedOrchestration[0].payload.input!.trim()));
      expect(await outer.$("..").$$('[data-testid="token-metadata"]')).toHaveLength(1);
      await outer.click();
      await first.click();
      await outer.execute((element) => element.scrollIntoView({ block: "start" }));
      await browser.saveScreenshot("/tmp/codex-usage-mixed-replay.png");
      await browser.keys("Escape");
      await dialog.waitForExist({ reverse: true });
    } finally {
      await browser.execute((language) => {
        if (language === null) localStorage.removeItem("language");
        else localStorage.setItem("language", language);
      }, previousLanguage);
    }
  }).timeout(180_000);

  run("preserves partial batch responses and expands all retained output through native replay", async () => {
    const sessions = join(process.env.CODEX_HOME!, "sessions", "2026", "10", "09");
    mkdirSync(sessions, { recursive: true });
    const id = "01a120e4-5060-7271-b288-7985cbfa0900";
    const name = `rollout-2026-10-09T21-39-58-${id}.jsonl`;
    const path = join(sessions, name);
    const lines = Array.from({ length: 8 }, (_, index) => `response line ${index + 1}`).join("\n");
    const output = [
      { type: "input_text", text: "Script completed\nWall time 0.3 seconds\nOutput:\n" },
      { type: "input_text", text: JSON.stringify({ i: 0, status: "fulfilled", value: { exit_code: 0, output: lines } }) },
      { type: "input_text", text: 'Warning: truncated output\n{"i":1,"status":"fulfilled","value":{"output":"retained response fragment…' },
      { type: "input_text", text: JSON.stringify({ i: 2, status: "fulfilled", value: { session_id: 42, output: "third command started" } }) },
    ];
    const timestamp = "2026-10-09T13:39:58.000Z";
    const usage = { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 300, total_tokens: 1300 };
    writeFileSync(path, [
      { type: "session_meta", payload: { id, cwd: "/command-response-test" } },
      { type: "turn_context", payload: { turn_id: "response-turn", model: "gpt-5" } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Check command responses" }] } },
      { type: "response_item", payload: { type: "custom_tool_call", name: "exec", call_id: "batch", input: 'text(await tools.exec_command({cmd:"first-command"})); text(await tools.exec_command({cmd:"second-command"})); text(await tools.exec_command({cmd:"third-command"}));' } },
      { type: "response_item", payload: { type: "custom_tool_call_output", call_id: "batch", output } },
      { type: "response_item", payload: { type: "custom_tool_call", name: "exec", call_id: "poll", input: 'text(await tools.write_stdin({session_id:42,chars:""}));' } },
      { type: "response_item", payload: { type: "custom_tool_call_output", call_id: "poll", output: [{ type: "input_text", text: JSON.stringify({ exit_code: 0, output: "third command finished" }) }] } },
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
      expect(JSON.parse(detail.turns.flatMap((turn) => turn.toolCalls).find((tool) => tool.callId === "batch")!.output!)).toEqual(output);

      await browser.refresh();
      const sessionsTab = $('button[role="tab"]=Sessions');
      await sessionsTab.waitForDisplayed({ timeout: 90_000 });
      await sessionsTab.click();
      const day = $('#date-group-2026-10-09 > button');
      await day.waitForDisplayed({ timeout: 15_000 });
      if (await day.getAttribute("aria-expanded") === "false") await day.click();
      const card = $(`[data-testid="session-card"]*=${name.replace(/\.jsonl$/, "")}`);
      await card.waitForDisplayed({ timeout: 15_000 });
      await card.click();
      const dialog = $('[aria-labelledby="session-detail-title"]');
      await dialog.waitForDisplayed();
      const command = dialog.$('button*=first-command');
      await command.waitForExist({ timeout: 15_000 });
      await command.execute((element) => element.scrollIntoView({ block: "center" }));
      await expect(command).toHaveAttribute("aria-expanded", "false");
      const commandCard = command.$("..");
      await expect(commandCard.$('pre')).toHaveText(expect.stringContaining("response line 1"));
      expect(await commandCard.getText()).not.toContain("response line 4");
      await command.click();
      await expect(command).toHaveAttribute("aria-expanded", "true");
      await expect(commandCard.$('pre')).toHaveText(expect.stringContaining(lines));
      const third = dialog.$('button*=third-command');
      await expect(third.$("..").$('pre')).toHaveText(expect.stringContaining("third command started"));
      expect(await dialog.$('button*=second-command').$("..").getText()).not.toContain("third command started");

      const response = dialog.$('button*=Output');
      await response.execute((element) => element.scrollIntoView({ block: "center" }));
      await expect(response).toHaveAttribute("aria-expanded", "false");
      await response.click();
      await expect(response).toHaveAttribute("aria-expanded", "true");
      await expect(response.$("..").$('pre')).toHaveText(expect.stringContaining("retained response fragment"));
      const poll = dialog.$('button*=Waited for background terminal');
      await poll.execute((element) => element.scrollIntoView({ block: "center" }));
      await expect(poll).toHaveAttribute("aria-expanded", "false");
      await poll.click();
      await expect(poll.$("..").$('pre')).toHaveText(expect.stringContaining("third command finished"));
      await browser.keys("Escape");
      await dialog.waitForExist({ reverse: true });
    } finally {
      await browser.execute((language) => {
        if (language === null) localStorage.removeItem("language");
        else localStorage.setItem("language", language);
      }, previousLanguage);
    }
  }).timeout(180_000);

  const localRun = process.env.CODEX_USAGE_ARCHIVE_E2E === "1" && process.env.CODEX_USAGE_RESPONSE_SESSION ? it : it.skip;
  localRun("displays retained command output from a provided local session", async () => {
    const source = process.env.CODEX_USAGE_RESPONSE_SESSION!;
    const sessions = join(process.env.CODEX_HOME!, "sessions", "2026", "10", "09");
    mkdirSync(sessions, { recursive: true });
    const path = join(sessions, basename(source));
    copyFileSync(source, path);
    const records = readFileSync(source, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line).payload);
    // Exercise a truncated batch with just one fully retained command result.
    const call = records.find((record) => {
      if (record?.type !== "custom_tool_call" || record.input?.split("tools.exec_command(").length < 3) return false;
      const response = records.find((item) => item?.type === "custom_tool_call_output" && item.call_id === record.call_id);
      return response?.output.some((block: { text?: string }) => block.text?.includes("Warning: truncated output"))
        && response.output.flatMap((block: { text?: string }) => (block.text ?? "").split("\n")).filter((line: string) => {
          try { return typeof JSON.parse(line).value?.exit_code === "number"; } catch { return false; }
        }).length === 1;
    });
    expect(call).toBeDefined();
    const response = records.find((record) => record?.type === "custom_tool_call_output" && record.call_id === call.call_id);
    const retained = response.output.flatMap((block: { text?: string }) => (block.text ?? "").split("\n")).map((line: string) => {
      try { return JSON.parse(line).value; } catch { return null; }
    }).find((value: { output?: string } | null) => value?.output);
    const commandText = JSON.parse(call.input.match(/cmd\s*:\s*("(?:\\.|[^"\\])*")/)[1]);
    const detail = await browser.execute(async (path) => {
      const runtime = (window as unknown as { __TAURI_INTERNALS__: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> } }).__TAURI_INTERNALS__;
      await runtime.invoke("scan_usage");
      return runtime.invoke<SessionReplayDetail>("fetch_session_detail", { path });
    }, path);
    const replay = detail.turns.flatMap((turn) => turn.toolCalls).find((tool) => tool.callId === call.call_id);
    expect(JSON.parse(replay!.output!)).toEqual(response.output);
    await browser.execute(() => localStorage.setItem("language", "en"));
    await browser.refresh();
    const sessionsTab = $('button[role="tab"]=Sessions');
    await sessionsTab.waitForDisplayed({ timeout: 90_000 });
    await sessionsTab.click();
    const card = $(`[data-testid="session-card"]*=${basename(source, ".jsonl")}`);
    await card.waitForDisplayed({ timeout: 15_000 });
    await card.click();
    const dialog = $('[aria-labelledby="session-detail-title"]');
    await dialog.waitForDisplayed();
    const command = dialog.$(`button*=${commandText.slice(0, 120)}`);
    await command.waitForExist({ timeout: 30_000 });
    await command.execute((element) => element.scrollIntoView({ block: "center" }));
    await expect(command).toHaveAttribute("aria-expanded", "false");
    await command.click();
    await expect(command.$("..").$('pre')).toHaveText(expect.stringContaining(retained.output.trim()));
    const responseDisclosure = command.$('./ancestor::div[contains(@class,"rounded-lg")][1]').$('button=Output');
    await responseDisclosure.execute((element) => element.scrollIntoView({ block: "center" }));
    await responseDisclosure.click();
    await expect(responseDisclosure.$("..").$('pre')).toHaveText(expect.stringContaining("Warning: truncated output"));
    await browser.keys("Escape");
    await dialog.waitForExist({ reverse: true });
  }).timeout(180_000);
});
