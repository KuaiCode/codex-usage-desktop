import { createTauriCapabilities } from "@wdio/tauri-service";

const appBinaryPath = process.env.REPRO_BINARY!;

export const config: WebdriverIO.Config = {
  runner: "local",
  tsConfigPath: "./tsconfig.e2e.json",
  specs: ["./e2e/child-reaping.spec.ts"],
  maxInstances: 1,
  capabilities: [createTauriCapabilities(appBinaryPath)],
  services: [["@wdio/tauri-service", { appBinaryPath, driverProvider: "embedded", logLevel: "error" }]],
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "error",
  waitforTimeout: 10_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 1,
  mochaOpts: { ui: "bdd", timeout: 90_000 },
};
