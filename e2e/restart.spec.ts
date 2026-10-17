import { $, browser, expect } from "@wdio/globals";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type TauriWindow = Window & { __TAURI__: { core: { invoke(command: string): Promise<void> } } };

describe("macOS app restart after LaunchAgent autostart", () => {
  const run = process.env.CODEX_USAGE_RESTART_E2E === "1" ? it : it.skip;

  run("keeps the current app open when Launch Services rejects the relaunch", async () => {
    const bundle = resolve("src-tauri/target/debug/bundle/macos/Codex Usage Restart Test.app");
    await expect($("#root")).toBeDisplayed();
    renameSync(bundle, `${bundle}.unavailable`);
    try {
      const error = await browser.executeAsync((done) => {
        (window as TauriWindow).__TAURI__.core.invoke("restart_app").then(
          () => done("unexpected success"),
          (error: unknown) => done(String(error)),
        );
      });
      expect(error).toContain("Failed to relaunch app");
      await expect($("#root")).toBeDisplayed();
    } finally {
      renameSync(`${bundle}.unavailable`, bundle);
    }
  });

  run("reopens the installed bundle after an update replaces the running app", async () => {
    const bundle = resolve("src-tauri/target/debug/bundle/macos/Codex Usage Restart Test.app");
    const binary = join(bundle, "Contents/MacOS/codex-usage-desktop");
    const pids = () => execFileSync("ps", ["-axo", "pid=,comm="], { encoding: "utf8" })
      .split("\n")
      .filter((line) => line.trim().endsWith(binary))
      .map((line) => Number(line.trim().split(/\s+/)[0]));

    await expect($("#root")).toBeDisplayed();
    const before = pids();
    expect(before).toHaveLength(1);

    // Match the updater's macOS installation: move away the running bundle,
    // replace it at the original path, and delete the backup.
    const temp = mkdtempSync(join(tmpdir(), "codex-usage-update-"));
    try {
      cpSync(bundle, join(temp, "new.app"), { recursive: true });
      renameSync(bundle, join(temp, "old.app"));
      renameSync(join(temp, "new.app"), bundle);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }

    await browser.execute(() => {
      // Let WebDriver return before the native restart closes its connection.
      setTimeout(() => {
        const tauri = (window as TauriWindow).__TAURI__;
        void tauri.core.invoke("restart_app");
      }, 100);
    });

    await browser.waitUntil(() => {
      const after = pids();
      return after.length === 1 && after[0] !== before[0];
    }, { timeoutMsg: "The app closed without launching a replacement process." });

    await browser.waitUntil(async () => {
      try {
        return (await fetch("http://127.0.0.1:4445/status")).ok;
      } catch { return false; }
    }, { timeoutMsg: "The relaunched app did not initialize its native WebView driver." });
    // The old process's WebDriver session no longer exists after restarting.
    await browser.reloadSession();
    await expect($("#root")).toBeDisplayed();
    await expect(browser).toHaveTitle("Codex Usage Desktop");
  });
});
