import { describe, expect, it } from "vitest";
import { buildConversation, buildSessionConversation, classifyExploration, parseToolContentBlocks, summarizeOutput, type ReplayItem } from "./session-conversation";
import type { SessionReplayDetail } from "./api";
import mixedOrchestration from "../../e2e/fixtures/mixed-orchestration.json";

function replayTurn(items: ReplayItem[]): SessionReplayDetail["turns"][number] {
  return { turnId: "1", startedAt: null, completedAt: null, durationMs: null, systemMessages: [], userMessages: [], assistantMessages: [], reasoningSummaries: [], toolCalls: [], patchResults: [], tokenEvents: [], errors: [], items };
}
function command(cmd: string, overrides: Partial<Extract<ReplayItem, { kind: "toolCall" }>> = {}): ReplayItem {
  return { kind: "toolCall", callId: cmd, name: "exec_command", arguments: JSON.stringify({ cmd }), output: JSON.stringify({ exit_code: 0, output: "result" }), stderr: null, startedAt: null, completedAt: "2026-09-09", durationMs: 100, status: "completed", isError: false, ...overrides };
}
function usage(totalTokens: number): ReplayItem {
  return { kind: "tokenUsage", timestamp: null, model: "gpt-5", inputTokens: totalTokens - 10, cachedInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 0, totalTokens };
}

describe("conversation projection", () => {
  it("retains all results of mapped commands and terminal polls without borrowing a poll's arguments", () => {
    const [call, response] = mixedOrchestration;
    const block = buildConversation(replayTurn([command("", {
      name: "exec", arguments: call.payload.input!, output: JSON.stringify(response.payload.output),
    })]))[0];
    if (block.kind !== "item") throw new Error("Expected tool activity");
    const activity = block.entry.activity!;
    expect(activity.displayToolName).toBe("exec");
    expect(activity.argumentEntries).toEqual([]);
    expect(activity.argumentsText).toBe(call.payload.input);
    expect(activity.nestedActivities).toMatchObject([
      { kind: "command", command: "rtk proxy rg -n 'unparsedOutputText' src/components/session-detail-modal.tsx src/lib/session-conversation.ts", output: null },
      { kind: "command", command: "rtk proxy pnpm exec vitest run src/lib/session-conversation.test.ts src/components/session-conversation.test.tsx", output: null },
      { kind: "command", command: "rtk proxy pnpm typecheck", output: null },
      { kind: "terminal", sessionId: 78347 },
      { kind: "terminal", sessionId: 99948 },
    ]);
    expect(activity.unpairedOutputs).toHaveLength(5);
    expect(activity.unpairedOutputs[0].stdout).toContain("unparsedOutputText");
    expect(activity.unpairedOutputs[1].sessionId).toBe(85274);
    expect(activity.unpairedOutputs[3].exitCode).toBe(101);
    expect(activity.unpairedOutputs[4].sessionId).toBe(99948);
    expect(activity.outputText).toBeNull();
  });

  it("projects literal allSettled calls and pairs only indexed parallel results", () => {
    const block = buildConversation(replayTurn([command("", {
      name: "exec", arguments: 'const results = await Promise.allSettled([tools.exec_command({cmd:"first"}), tools.exec_command({cmd:"second"})]); results.forEach((r,i)=>text({i,...r}));',
      output: JSON.stringify([
        { type: "input_text", text: JSON.stringify({ i: 1, status: "rejected", reason: "unavailable" }) },
        { type: "input_text", text: JSON.stringify({ i: 0, status: "fulfilled", value: { exit_code: 0, output: "first response" } }) },
      ]),
    })]))[0];
    if (block.kind !== "item") throw new Error("Expected tool activity");
    expect(block.entry.activity?.nestedActivities).toMatchObject([
      { command: "first", output: { stdout: "first response" } },
      { command: "second", output: { rejected: true, stderr: "unavailable" } },
    ]);
    expect(block.entry.activity?.unpairedOutputs).toEqual([]);
  });

  it("projects each literal terminal poll in an allSettled array", () => {
    const block = buildConversation(replayTurn([command("", {
      name: "exec", arguments: 'await Promise.allSettled([tools.write_stdin({session_id:42,chars:""}),tools.write_stdin({session_id:43,chars:""})].map(async p=>text(await p)));',
      output: JSON.stringify([{ type: "input_text", text: JSON.stringify({ exit_code: 0, output: "unindexed response" }) }]),
    })]))[0];
    if (block.kind !== "item") throw new Error("Expected tool activity");
    expect(block.entry.activity?.nestedActivities).toMatchObject([
      { kind: "terminal", sessionId: 42, output: null },
      { kind: "terminal", sessionId: 43, output: null },
    ]);
    expect(block.entry.activity?.unpairedOutputs[0].stdout).toBe("unindexed response");
  });

  it.each([
    'await Promise.allSettled([enabled && tools.exec_command({cmd:"first"}),tools.exec_command({cmd:"second"})]);',
    'await Promise.allSettled([["first",1]].map(async ([cmd,max_output_tokens])=>{if(enabled)text(await tools.exec_command({cmd,max_output_tokens}));}));',
    'if(enabled) await Promise.allSettled([tools.exec_command({cmd:"first"}),tools.exec_command({cmd:"second"})]);',
    'await Promise.allSettled([tools.exec_command(options),tools.exec_command({cmd:"second"})]);',
  ])("retains unsupported allSettled scripts: %s", (argumentsJson) => {
    const block = buildConversation(replayTurn([command("", { name: "exec", arguments: argumentsJson })]))[0];
    if (block.kind !== "item") throw new Error("Expected tool activity");
    expect(block.entry.activity?.nestedActivities).toBeNull();
    expect(block.entry.activity?.argumentsText).toBe(argumentsJson);
  });

  it("does not infer source ordering from unindexed concurrent results", () => {
    const block = buildConversation(replayTurn([command("", {
      name: "exec", arguments: 'await Promise.all([tools.exec_command({cmd:"first"}),tools.exec_command({cmd:"second"})].map(async p=>text(await p)));',
      output: JSON.stringify([{ type: "input_text", text: JSON.stringify({ exit_code: 0, output: "second finished first" }) }]),
    })]))[0];
    if (block.kind !== "item") throw new Error("Expected tool activity");
    expect(block.entry.activity?.nestedActivities).toBeNull();
    expect(block.entry.activity?.execArguments).toBeNull();
    expect(block.entry.activity?.unpairedOutputs[0].stdout).toBe("second finished first");
  });

  it("ignores quoted and commented calls and never reads another call's object as an argument", () => {
    const script = '// tools.write_stdin({session_id:99})\nconst note="tools.exec_command({cmd:\\"fake\\"})";\ntext(await tools.exec_command(options)); text(await tools.write_stdin({session_id:42,chars:""}));';
    const block = buildConversation(replayTurn([command("", { name: "exec", arguments: script })]))[0];
    if (block.kind !== "item") throw new Error("Expected tool activity");
    expect(block.entry.activity?.displayToolName).toBe("exec");
    expect(block.entry.activity?.argumentEntries).toEqual([]);
    expect(block.entry.activity?.argumentsText).toBe(script);
    expect(block.entry.activity?.nestedActivities).toBeNull();
  });

  it("does not project calls mentioned inside a regular expression", () => {
    const script = 'const pattern=/tools.write_stdin({session_id:42})/; text(await tools.exec_command({cmd:"pnpm test"}));';
    const block = buildConversation(replayTurn([command("", { name: "exec", arguments: script })]))[0];
    if (block.kind !== "item") throw new Error("Expected tool activity");
    expect(block.entry.activity?.backgroundTerminalInput).toBeNull();
    expect(block.entry.activity?.nestedActivities).toBeNull();
    expect(block.entry.activity?.execArguments).toBeNull();
    expect(block.entry.activity?.argumentsText).toBe(script);
  });

  it("preserves mixed search and command output as one orchestration", () => {
    const script = 'text(await tools.web__run({search_query:[{q:"example"}]})); text(await tools.exec_command({cmd:"pnpm test"}));';
    const block = buildConversation(replayTurn([command("", { name: "exec", arguments: script })]))[0];
    if (block.kind !== "item") throw new Error("Expected tool activity");
    expect(block.entry.activity?.webSearchQueries).toBeNull();
    expect(block.entry.activity?.argumentsText).toBe(script);
    expect(block.entry.activity?.nestedActivities).toBeNull();
  });

  it("groups adjacent exploration without losing calls, raw provenance or token attribution", () => {
    const blocks = buildConversation(replayTurn([
      command("rg -n shimmer src", { rawJsonlLineNumbers: [1, 2] }), usage(100),
      command("cat src/a.rs"), usage(200), command("cat src/a.rs src/b.rs"), usage(300),
      { kind: "message", role: "assistant", text: "Next", source: "message", timestamp: null },
      command("ls src"), usage(400),
    ]));
    expect(blocks.map((block) => block.kind)).toEqual(["exploration", "item", "exploration"]);
    const first = blocks[0];
    if (first.kind !== "exploration") throw new Error("Expected exploration");
    expect(first.entries.map((entry) => entry.tokenUsage?.totalTokens)).toEqual([100, 200, 300]);
    expect(first.entries.map((entry) => entry.tokenUsage?.deltaTokens)).toEqual([undefined, 100, 100]);
    expect(first.entries[0].item.rawJsonlLineNumbers).toEqual([1, 2]);
    expect(first.actions[0]).toEqual([{ label: "Search", text: "shimmer in src" }]);
  });

  it("keeps token deltas continuous across turns", () => {
    const conversations = buildSessionConversation([
      replayTurn([command("cat a"), usage(100)]),
      replayTurn([command("cat b"), usage(130)]),
    ]);

    expect(conversations[0][0].kind === "exploration" && conversations[0][0].entries[0].tokenUsage?.deltaTokens).toBeUndefined();
    expect(conversations[1][0].kind === "exploration" && conversations[1][0].entries[0].tokenUsage?.deltaTokens).toBe(30);
  });

  it("keeps failures, running commands, writes and ambiguous shell scripts visible", () => {
    const blocks = buildConversation(replayTurn([
      command("cat a", { isError: true }), command("cat a", { status: "running" }),
      command("cat a", { output: JSON.stringify({ exit_code: 2, output: "no file" }) }),
      command("cat a && pnpm test"), command("cat a&&pnpm test"), command("cat a > b"),
      command("cat a | sh"), command("cat $(touch x)"), command("cat a &"), command("cat 'unterminated"),
    ]));
    expect(blocks.every((block) => block.kind === "item")).toBe(true);
  });

  it("does not present the first command of an unpaired batch as exploration", () => {
    const blocks = buildConversation(replayTurn([command("", {
      name: "exec", arguments: 'text(await tools.exec_command({cmd:"cat a"})); text(await tools.exec_command({cmd:"pnpm test"}));',
    }), usage(500)]));
    expect(blocks[0].kind).toBe("item");
  });

  it("projects nested commands, patches and images in source order", () => {
    const patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-tools.view_image({path: 'not a call'})\n+fixed\n*** End Patch";
    const argumentsJson = [
      'text(await tools.exec_command({cmd:"pnpm test", workdir:"/repo"}));',
      `const patch = ${JSON.stringify(patch)}; text(await tools.apply_patch(patch));`,
      'const image = await tools.view_image({path:"/tmp/result.png"}); image(image.image_url);',
      'text(await tools.exec_command({cmd:"git status --short"}));',
    ].join("\n");
    const output = JSON.stringify([
      { type: "input_text", text: JSON.stringify({ exit_code: 0, output: "tests passed", wall_time_seconds: 1.2 }) },
      { type: "input_text", text: "Done!" },
      { type: "image", image_url: "data:image/png;base64,AA==" },
      { type: "input_text", text: JSON.stringify({ exit_code: 0, output: "M src/a.ts", wall_time_seconds: 0.1 }) },
    ]);
    const block = buildConversation(replayTurn([command("", { name: "exec", arguments: argumentsJson, output })]))[0];
    if (block.kind !== "item" || block.entry.item.kind !== "toolCall") throw new Error("Expected tool activity");
    expect(block.entry.activity?.nestedActivities).toEqual([
      { kind: "command", command: "pnpm test", workdir: "/repo", output: { stdout: "tests passed", stderr: null, exitCode: 0, wallTimeSeconds: 1.2, sessionId: null } },
      { kind: "patch", patch },
      { kind: "image", path: "/tmp/result.png", imageUrl: "data:image/png;base64,AA==" },
      { kind: "command", command: "git status --short", workdir: null, output: { stdout: "M src/a.ts", stderr: null, exitCode: 0, wallTimeSeconds: 0.1, sessionId: null } },
    ]);
  });

  it("recognizes literal RTK read, search and list commands", () => {
    expect(classifyExploration("rtk proxy cat 'src/a b.rs'")).toEqual([{ label: "Read", text: "src/a b.rs" }]);
    expect(classifyExploration("rtk sed -n '1,20p' src/a.rs")).toEqual([{ label: "Read", text: "src/a.rs" }]);
    expect(classifyExploration("rg --files src")?.[0].label).toBe("List");
    expect(classifyExploration("rtk proxy sh -c 'cat src/a.rs && ls src'")).toEqual([
      { label: "Read", text: "src/a.rs" }, { label: "List", text: "src" },
    ]);
    expect(classifyExploration("rg '(shimmer|status)' src")?.[0].label).toBe("Search");
    expect(classifyExploration("sed -i 's/a/b/' src/a.rs")).toBeNull();
  });

  it("keeps indexed responses aligned when a batch response is truncated", () => {
    const output = JSON.stringify([
      { type: "input_text", text: "Script completed\nOutput:\n" },
      { type: "input_text", text: 'Warning: truncated output\n{"i":0,"status":"fulfilled","value":{"exit_code":0,"output":"first response"}}\n{"i":1,"status":"fulfilled","value":{"output":"retained fragment…\n{"i":2,"status":"fulfilled","value":{"exit_code":2,"output":"third response"}}' },
    ]);
    const block = buildConversation(replayTurn([command("", {
      name: "exec", arguments: 'text(await tools.exec_command({cmd:"first"})); text(await tools.exec_command({cmd:"second"})); text(await tools.exec_command({cmd:"third"}));', output,
    })]))[0];
    if (block.kind !== "item") throw new Error("Expected tool activity");
    const activities = block.entry.activity?.nestedActivities;
    expect(activities?.[0]).toMatchObject({ command: "first", output: { stdout: "first response" } });
    expect(activities?.[1]).toMatchObject({ command: "second", output: null });
    expect(activities?.[2]).toMatchObject({ command: "third", output: { stdout: "third response", exitCode: 2 } });
    expect(block.entry.activity?.unparsedOutputText).toContain("retained fragment");
  });

  it("does not attach polling or rejected responses to the next command", () => {
    const block = buildConversation(replayTurn([command("", {
      name: "exec", arguments: 'text(await tools.write_stdin({session_id:42})); text(await tools.exec_command({cmd:"first"})); text(await tools.exec_command({cmd:"second"}));',
      output: JSON.stringify([
        { type: "input_text", text: JSON.stringify({ exit_code: 0, output: "poll response" }) },
        { type: "input_text", text: JSON.stringify({ status: "rejected", reason: "command unavailable" }) },
        { type: "input_text", text: JSON.stringify({ session_id: 43, output: "second response" }) },
      ]),
    })]))[0];
    if (block.kind !== "item") throw new Error("Expected tool activity");
    expect(block.entry.activity?.nestedActivities).toMatchObject([
      { kind: "terminal", sessionId: 42, input: "", output: { stdout: "poll response" } },
      { command: "first", output: { stderr: "command unavailable", exitCode: null } },
      { command: "second", output: { stdout: "second response", sessionId: 43 } },
    ]);
  });

  it("retains plain batch output for expansion when it cannot be paired", () => {
    const block = buildConversation(replayTurn([command("", {
      name: "exec", arguments: 'text(await tools.exec_command({cmd:"first"})); text(await tools.exec_command({cmd:"second"}));',
      output: "first response\nsecond response\nProcess exited with code 0",
    })]))[0];
    if (block.kind !== "item") throw new Error("Expected tool activity");
    expect(block.entry.activity?.unparsedOutputText).toContain("second response");
  });

  it("keeps an incomplete unindexed response unpaired instead of assigning it to the first command", () => {
    const block = buildConversation(replayTurn([command("", {
      name: "exec", arguments: 'text(await tools.exec_command({cmd:"first"})); text(await tools.exec_command({cmd:"second"}));',
      output: JSON.stringify([{ type: "input_text", text: JSON.stringify({ exit_code: 0, output: "possibly second" }) }]),
    })]))[0];
    if (block.kind !== "item") throw new Error("Expected tool activity");
    expect(block.entry.activity?.nestedActivities).toMatchObject([{ command: "first", output: null }, { command: "second", output: null }]);
    expect(block.entry.activity?.unpairedOutputs[0].stdout).toBe("possibly second");
  });

  it("retains duplicate indexed outputs without overwriting either result", () => {
    const block = buildConversation(replayTurn([command("", {
      name: "exec", arguments: 'text(await tools.exec_command({cmd:"first"})); text(await tools.exec_command({cmd:"second"}));',
      output: JSON.stringify(["first chunk", "second chunk"].map((output) => ({ type: "input_text", text: JSON.stringify({ i: 0, exit_code: 0, output }) }))),
    })]))[0];
    if (block.kind !== "item") throw new Error("Expected tool activity");
    expect(block.entry.activity?.nestedActivities).toMatchObject([{ output: null }, { output: null }]);
    expect(block.entry.activity?.unpairedOutputs.map((output) => output.stdout)).toEqual(["first chunk", "second chunk"]);
  });

  it("does not assume indices in a mixed batch count only process calls", () => {
    const block = buildConversation(replayTurn([command("", {
      name: "exec", arguments: 'text(await tools.exec_command({cmd:"first"})); text(await tools.apply_patch("patch")); text(await tools.exec_command({cmd:"second"}));',
      output: JSON.stringify(["first response", "patch response", "second response"].map((output, i) => ({ type: "input_text", text: JSON.stringify({ i, output, wall_time_seconds: 1 }) }))),
    })]))[0];
    if (block.kind !== "item") throw new Error("Expected tool activity");
    expect(block.entry.activity?.nestedActivities).toMatchObject([{ command: "first", output: null }, { kind: "patch" }, { command: "second", output: null }]);
    expect(block.entry.activity?.unpairedOutputs.map((output) => output.stdout)).toEqual(["first response", "patch response", "second response"]);
  });

  it("keeps returned variables unpaired when their print order differs from call order", () => {
    const block = buildConversation(replayTurn([command("", {
      name: "exec", arguments: 'const a=await tools.exec_command({cmd:"first"}); const b=await tools.exec_command({cmd:"second"}); text(b); text(a);',
      output: JSON.stringify(["second response", "first response"].map((output) => ({ type: "input_text", text: JSON.stringify({ exit_code: 0, output }) }))),
    })]))[0];
    if (block.kind !== "item") throw new Error("Expected tool activity");
    expect(block.entry.activity?.nestedActivities).toMatchObject([{ command: "first", output: null }, { command: "second", output: null }]);
    expect(block.entry.activity?.unpairedOutputs.map((output) => output.stdout)).toEqual(["second response", "first response"]);
  });

  it("preserves boundaries between separate text content blocks", () => {
    expect(parseToolContentBlocks(JSON.stringify([{ type: "input_text", text: "first" }, { type: "input_text", text: "second" }]))?.text).toBe("first\nsecond");
  });

  it("keeps the head and tail with an exact omitted line count", () => {
    expect(summarizeOutput("1\n2\n3\n4\n5\n6\n7\n8")).toEqual({ head: ["1", "2", "3"], tail: ["7", "8"], omitted: 3 });
    expect(summarizeOutput("1\n2")).toEqual({ head: ["1", "2"], tail: [], omitted: 0 });
  });
});
