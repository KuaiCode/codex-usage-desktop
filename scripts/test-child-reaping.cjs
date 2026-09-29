const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

if (process.platform !== "darwin") {
  throw new Error("The child reaping e2e test requires macOS.");
}

const temp = mkdtempSync(join(tmpdir(), "codex-usage-child-reaping-"));
const codexHome = join(temp, "codex-home");
mkdirSync(codexHome);

try {
  const env = {
    ...process.env,
    CODEX_HOME: codexHome,
    CODEX_CLI_PATH: resolve("e2e/fixtures/mock-codex-cli.cjs"),
    REPRO_LOG: join(temp, "spawns.jsonl"),
    REPRO_BINARY: resolve("src-tauri/target/debug/codex-usage-desktop"),
  };
  const build = spawnSync("pnpm", ["test:e2e:build"], { stdio: "inherit", env });
  if (build.error) throw build.error;
  if (build.status !== 0) process.exitCode = build.status ?? 1;
  else {
    const test = spawnSync("pnpm", ["exec", "wdio", "run", "./wdio.child-reaping.conf.ts"], {
      stdio: "inherit",
      env,
    });
    if (test.error) throw test.error;
    process.exitCode = test.status ?? 1;
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
