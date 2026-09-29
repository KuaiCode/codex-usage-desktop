import { browser, expect } from "@wdio/globals";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

type SpawnRecord = { pid: number; parent: number };

function records(): SpawnRecord[] {
  const path = process.env.REPRO_LOG!;
  try {
    return readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SpawnRecord);
  } catch {
    return [];
  }
}

describe("native Codex RPC child reaping", () => {
  const run = process.env.REPRO_LOG ? it : it.skip;

  run("reaps completed RPC children", async () => {
    await expect(browser).toHaveTitle("Codex Usage Desktop");
    const states: string[] = [];

    for (let i = 0; i < 5; i += 1) {
      const before = records().length;
      const result = await browser.executeAsync((done) => {
        const tauri = (window as unknown as {
          __TAURI__: { core: { invoke: (command: string) => Promise<unknown> } };
        }).__TAURI__;
        tauri.core.invoke("fetch_codex_limits").then(
          () => done("ok"),
          (error) => done(`error: ${String(error)}`),
        );
      });
      expect(result).toBe("ok");
      await browser.waitUntil(() => Promise.resolve(records().length > before), {
        timeout: 10_000,
        timeoutMsg: "mock Codex CLI did not start",
      });

      const { pid, parent } = records().at(-1)!;
      const parentStatus = execFileSync("ps", ["-o", "stat=", "-p", String(parent)], { encoding: "utf8" }).trim();
      expect(parentStatus).not.toBe("");
      let childStatus = "";
      try {
        childStatus = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim();
      } catch {
        // Reaped children are absent from ps.
      }
      states.push(`${pid}:${childStatus || "reaped"}`);
      expect(childStatus).toBe("");
    }

    console.log(`RPC child process states: ${states.join(", ")}`);
  }).timeout(90_000);
});
