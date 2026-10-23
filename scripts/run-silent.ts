#!/usr/bin/env bun

const GREEN = "\x1b[0;32m";
const RED = "\x1b[0;31m";
const NC = "\x1b[0m";

const VERBOSE = process.env.VERBOSE === "1";

// Usage: bun run scripts/run-silent.ts "description" command [args...]
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("Usage: bun run scripts/run-silent.ts <description> <command> [args...]");
  process.exit(1);
}

const description = args[0];
const command = args.slice(1);

if (VERBOSE) {
  console.log(`  → Running: ${command.join(" ")}`);
  const proc = Bun.spawn(command, {
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await proc.exited);
}

const proc = Bun.spawn(command, {
  stdout: "pipe",
  stderr: "pipe",
});

const [stdout, stderr] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
]);

const exitCode = await proc.exited;

if (exitCode === 0) {
  console.log(`  ${GREEN}✓${NC} ${description}`);
} else {
  console.log(`  ${RED}✗${NC} ${description}`);
  console.log(`${RED}Command failed: ${command.join(" ")}${NC}`);
  console.log(stdout + stderr);
}

process.exit(exitCode);
