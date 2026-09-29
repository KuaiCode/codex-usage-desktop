#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
const { createInterface } = require("node:readline");

appendFileSync(process.env.REPRO_LOG, `${JSON.stringify({ pid: process.pid, parent: process.ppid })}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  const result = request.method === "account/rateLimits/read" ? { rateLimits: {} } : {};
  console.log(JSON.stringify({ id: request.id, result }));
});
