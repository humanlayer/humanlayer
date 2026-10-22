#!/usr/bin/env bun

const GREEN = "\x1b[0;32m";
const RED = "\x1b[0;31m";
const NC = "\x1b[0m";

const VERBOSE = process.env.VERBOSE === "1";

async function runCheck(name: string, script: string): Promise<number> {
    if (VERBOSE) {
        console.log(`  → Running: bun run ${script}`);
        const proc = Bun.spawn(["bun", "run", script], {
            stdout: "inherit",
            stderr: "inherit",
        });
        return proc.exited;
    }

    const proc = Bun.spawn(["bun", "run", script], {
        stdout: "pipe",
        stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;

    if (exitCode === 0) {
        console.log(`  ${GREEN}✓${NC} ${name}`);
    } else {
        console.log(`  ${RED}✗${NC} ${name}`);
        console.log(stdout + stderr);
    }

    return exitCode;
}

const [typecheckResult, qualityResult] = await Promise.allSettled([
    runCheck("typecheck", "hook:typecheck"),
    runCheck("quality", "hook:quality"),
]);

const typecheckCode = typecheckResult.status === "fulfilled" ? typecheckResult.value : 1;
const qualityCode = qualityResult.status === "fulfilled" ? qualityResult.value : 1;

if (typecheckCode !== 0 || qualityCode !== 0) {
    process.exit(1);
}
