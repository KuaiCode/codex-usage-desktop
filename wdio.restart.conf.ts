import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const bundle = resolve("src-tauri/target/debug/bundle/macos/Codex Usage Restart Test.app");
const launchAgent = `gui/${process.getuid?.()}/com.codexusage.desktop.e2e.restart`;
let codexHome: string;

function appPids() {
  return execFileSync("ps", ["-axo", "pid=,comm="], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.includes(`${bundle}/Contents/MacOS/`))
    .map((line) => Number(line.trim().split(/\s+/)[0]));
}

export const config: WebdriverIO.Config = {
  async onPrepare() {
    if (process.platform !== "darwin") throw new Error("The restart test requires macOS.");
    const build = spawnSync("pnpm", [
      "tauri", "build", "--debug", "--features", "e2e", "--bundles", "app",
      "--config", "src-tauri/tauri.e2e.conf.json",
      "--config", JSON.stringify({
        identifier: "com.codexusage.desktop.e2e.restart",
        productName: "Codex Usage Restart Test",
        bundle: { createUpdaterArtifacts: false },
      }),
    ], { stdio: "inherit" });
    if (build.status !== 0) throw build.error ?? new Error(`Build failed: ${build.status}`);

    codexHome = mkdtempSync(join(tmpdir(), "codex-usage-restart-"));
    process.env.CODEX_USAGE_RESTART_E2E = "1";
    const plist = join(codexHome, "launch-agent.plist");
    writeFileSync(plist, JSON.stringify({
      Label: "com.codexusage.desktop.e2e.restart",
      ProgramArguments: [join(bundle, "Contents/MacOS/codex-usage-desktop")],
      RunAtLoad: true,
      EnvironmentVariables: { CODEX_HOME: codexHome },
    }));
    execFileSync("/usr/bin/plutil", ["-convert", "xml1", plist]);
    execFileSync("/bin/launchctl", ["bootstrap", `gui/${process.getuid!()}`, plist]);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch("http://127.0.0.1:4445/status")).ok) return;
      } catch { /* The native driver is still starting. */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("The native restart test app did not start.");
  },
  onComplete() {
    spawnSync("/bin/launchctl", ["bootout", launchAgent]);
    for (const pid of appPids()) process.kill(pid, "SIGTERM");
    if (codexHome) rmSync(codexHome, { recursive: true, force: true });
  },
  runner: "local",
  hostname: "127.0.0.1",
  port: 4445,
  tsConfigPath: "./tsconfig.e2e.json",
  specs: ["./e2e/restart.spec.ts"],
  maxInstances: 1,
  capabilities: [{ browserName: "tauri" }],
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "error",
  waitforTimeout: 30_000,
  connectionRetryTimeout: 5_000,
  connectionRetryCount: 0,
  mochaOpts: { ui: "bdd", timeout: 60_000 },
};
