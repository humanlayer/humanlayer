import { spawn } from "node:child_process";
import { describe, expect, test } from "vitest";

const hookPath = new URL(
  "../../../.claude/hooks/block-test-output-filtering.sh",
  import.meta.url,
).pathname;

async function runHook(command: string) {
  const proc = spawn("bash", [hookPath], { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";

  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  proc.stdin.write(
    JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command },
    }),
  );
  proc.stdin.end();

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", resolve);
  });

  return { exitCode, stderr };
}

describe("Claude Bash output spooling hook", () => {
  test("blocks filtering test output before spooling can capture the full output", async () => {
    const result = await runHook("bun run test | tail -n 50");

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Do not pipe test, typecheck, or quality output");
    expect(result.stderr).toContain("<persisted_output>");
  });

  test("blocks filtering turbo typecheck output", async () => {
    const result = await runHook("bun --bun turbo run typecheck --filter @humanlayer/riptide-api | rg error");

    expect(result.exitCode).toBe(2);
  });

  test("allows unfiltered checks", async () => {
    const result = await runHook("bun --bun run typecheck --filter @humanlayer/riptide-api");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("allows filtering previously persisted output files", async () => {
    const result = await runHook("grep -n error /tmp/claude-bash-output.log");

    expect(result.exitCode).toBe(0);
  });
});
