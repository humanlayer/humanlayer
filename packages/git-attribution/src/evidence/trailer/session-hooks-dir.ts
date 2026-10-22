import { execFile } from 'node:child_process'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import {
	attributionGitConfigEntries,
	CONFIG_STAMPER_NAME,
	GIT_CAPABILITIES_FILE,
	type HookHostingMode,
	SESSION_HOOKS_DIR_NAME,
} from '../../git-env'
import { riptideStateDir, writeStateBreadcrumb } from '../../shared/state-dir'
import { FORWARDED_HOOKS, HOOK_NAME_RE } from './forwarded-hooks'
import { CONFIG_STAMPER, STAMPER, TRAMPOLINE } from './hook-scripts'

const sh = promisify(execFile)

/**
 * The ENV-HOSTED hooks directory — attribution's stamping point with ZERO files in the user's
 * repository.
 *
 * Instead of installing a `prepare-commit-msg` into each repo's `.git/hooks` (the v≤5 design),
 * the hooks live once per machine in OUR state dir, and each armed session's process tree
 * carries env-scoped git config pointing at them. Env config outranks repo config (git ≥ 2.31),
 * so EVERY git the session spawns — porcelain, merges, scripts, tools calling /usr/bin/git by
 * absolute path — resolves them, while a human's own shell (no env) never invokes our code at
 * all: not "our hook exits early", but "our hook does not exist for them".
 *
 * TWO hosting modes share this dir (probed per machine by {@link supportsConfigHooks}; entry
 * shapes in ../../git-env, sh sources in ./hook-scripts, the trampoline name floor in
 * ./forwarded-hooks):
 *
 *   - `config-hooks` (RELEASED git ≥ 2.54, 2026-04): the env registers
 *     `hook.humanlayer-attribution.event/command` pointing at ./stamp-commit-msg. Registration
 *     is ADDITIVE — git runs configured hooks first, then the repo's own hookdir hook natively
 *     (hook.c: list_hooks_add_configured before list_hooks_add_default) — so nothing is
 *     shadowed and NO trampoline is ever involved. Ordering caveats: the stamp lands BEFORE the
 *     repo's own prepare-commit-msg (hookdir is always last, git offers no reordering), so a
 *     repo hook that wholesale REWRITES the message file can drop the trailer, and even an
 *     APPENDING repo hook pushes our line out of the final trailer BLOCK — the commit keeps the
 *     line and the daemon's per-line reader still parses it, but `%(trailers)`-style git-native
 *     parsing will not. Version caveat: the `hook.*` entries are IGNORED by any git < 2.54 the
 *     armed tree happens to spawn (an IDE-bundled or /usr/bin git beside the probed PATH git),
 *     whose commits then go unstamped; hooks-path mode has no such split (honored by every
 *     git >= 2.31, our floor).
 *
 *   - `hooks-path` (every git ≤ 2.53): env-scoped `core.hooksPath` points here. hooksPath is
 *     EXCLUSIVE, so the dir speaks for every hook the repo might have via the forwarding
 *     trampolines, and the stamper entry chains the repo's own prepare-commit-msg itself. A
 *     repo that relocated hooks (husky) is COVERED rather than declined: env config shadows
 *     the repo's `core.hooksPath` for the session's processes, and the trampolines forward
 *     into it.
 *
 * The stamper is ENV-ONLY (v8): the session's identity, trailer URL and expiry horizon all ride
 * the process env, and NOTHING is read from disk at commit time. The repo keeps ZERO HumanLayer
 * bytes, and so does the state dir beyond this hooks dir itself.
 */

export function sessionHooksDir(): string {
	return join(riptideStateDir(), SESSION_HOOKS_DIR_NAME)
}

// Tmp-name uniqueness needs a per-process sequence ON TOP of the pid: concurrent
// ensureSessionHooksDir calls in ONE process (the daemon arms sessions concurrently) would
// otherwise collide on the same tmp path and fail each other's chmod/rename — first arms on a
// fresh machine all rejecting was the observed failure.
let writeSeq = 0
async function writeIfChanged(path: string, content: string): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		const existing = await readFile(path, 'utf-8').catch(() => undefined)
		if (existing === content) {
			// Same bytes still need the exec bit: a state dir restored by rsync-without-`-p`, a zip
			// extract, or a cross-filesystem copy loses it, and a non-executable stamper is skipped
			// by git (hooks-path) or hard-fails the commit (config-hooks, `sh -c` exit 126).
			await chmod(path, 0o755).catch(() => undefined)
			return
		}
		// A hook may be EXECUTING right now in some session — never truncate in place.
		const tmp = `${path}.write.${process.pid}.${writeSeq++}`
		await writeFile(tmp, content)
		await chmod(tmp, 0o755)
		try {
			await rename(tmp, path)
			return
		} catch (error) {
			// POSIX rename-over is atomic; Windows throws EPERM when another writer is renaming
			// onto the same target at this instant. Concurrent writers are installing the same
			// bytes (the loop re-reads, so "someone else won" converges to the no-op branch);
			// anything else gets two more tries before the error is real.
			await rm(tmp, { force: true }).catch(() => undefined)
			if (attempt >= 2) throw error
		}
	}
}

/**
 * Materialize the machine-local hooks dir (idempotent, byte-diff writes only). `extraHookNames`
 * (from {@link listRepoHookNames}) covers repo hooks newer than the static floor; extras
 * accumulate across arms and never need sweeping — an unused trampoline forwards to nothing and
 * exits 0. Returns the hooks dir path the env entries reference. Best-effort like everything on
 * the arm path: throws only if the state dir is unwritable.
 */
export async function ensureSessionHooksDir(options?: {
	readonly extraHookNames?: readonly string[]
}): Promise<string> {
	const hooksDir = sessionHooksDir()
	await mkdir(hooksDir, { recursive: true })
	// Names our own entries own — an extra from a repo listing must never overwrite them.
	const known = new Set<string>([...FORWARDED_HOOKS, 'prepare-commit-msg', CONFIG_STAMPER_NAME])
	const extras = (options?.extraHookNames ?? []).filter((name) => HOOK_NAME_RE.test(name) && !known.has(name))
	await Promise.all([
		writeIfChanged(join(hooksDir, 'prepare-commit-msg'), STAMPER),
		writeIfChanged(join(hooksDir, CONFIG_STAMPER_NAME), CONFIG_STAMPER),
		...FORWARDED_HOOKS.map((name) => writeIfChanged(join(hooksDir, name), TRAMPOLINE)),
		...[...new Set(extras)].map((name) => writeIfChanged(join(hooksDir, name), TRAMPOLINE)),
	])
	return hooksDir
}

/** Throwaway friendly-name the capability probe registers — never persisted anywhere. */
const PROBE_HOOK_NAME = 'humanlayer-capability-probe'

/**
 * Does this machine's git support config-based hooks (`hook.<name>.event/command`, released in
 * git 2.54)? Probed by behavior, not version, and POSITIVELY: the probe preloads a throwaway
 * registration via `-c` and requires `git hook list` to SUCCEED — a capable git lists the
 * preloaded hook and exits 0. Every other outcome fails CLOSED to hooks-path mode:
 *   - git 2.36–2.53: `git hook` exists but has no `list` subcommand — usage error, exit 129
 *   - git < 2.36: no `git hook` command at all — "not a git command", exit 1. (This is why the
 *     probe must demand success rather than "any exit but 129": reading that 1 as
 *     capability-present would silently disarm attribution on e.g. Ubuntu 22.04's git 2.34.)
 *   - not a repo (exit 128), hostile hook.* config making list die, spawn failure, timeout
 * Memoized per process — the binary does not change under a running daemon, and cold CLI hook
 * processes pay one ~10ms spawn per session start. `cwd` must be inside a repo (`git hook`
 * requires one); callers probe after resolveGitPaths succeeds. The verdict is also published to
 * {@link GIT_CAPABILITIES_FILE} for the launcher (best effort).
 */
let configHooksSupport: Promise<boolean> | undefined
export function supportsConfigHooks(cwd: string): Promise<boolean> {
	configHooksSupport ??= sh(
		'git',
		[
			'-c',
			`hook.${PROBE_HOOK_NAME}.event=prepare-commit-msg`,
			'-c',
			`hook.${PROBE_HOOK_NAME}.command=true`,
			'hook',
			'list',
			'prepare-commit-msg',
		],
		{ cwd, timeout: 10_000 },
	)
		.then(
			() => true,
			() => false,
		)
		.then(async (supported) => {
			// Cache is an optimization for the launcher; the probe verdict stands regardless.
			await writeStateBreadcrumb(GIT_CAPABILITIES_FILE, { configHooks: supported })
			return supported
		})
	return configHooksSupport
}

/** Test seam: forget the memoized capability probe. */
export function resetConfigHooksSupportForTesting(): void {
	configHooksSupport = undefined
}

/**
 * The env entries that arm a process tree's git with our stamper — thin wrapper over the shared
 * builder in ../../git-env (see there for the append semantics and the two encodings).
 */
export function gitConfigHooksEnv(
	hooksDir: string,
	baseEnv: Record<string, string | undefined>,
	mode: HookHostingMode = 'hooks-path',
): Record<string, string> {
	return attributionGitConfigEntries({ mode, hooksDir, baseEnv })
}

// Re-exports so consumers keep ONE import site for the hooks-dir vocabulary: entry shapes and
// names from the pure leaf (../../git-env), sh sources and marker from ./hook-scripts, the
// trampoline name floor from ./forwarded-hooks.
export { CONFIG_STAMPER_NAME, type HookHostingMode } from '../../git-env'
export { FORWARDED_HOOKS, listRepoHookNames } from './forwarded-hooks'
export { ENV_HOOK_MARKER } from './hook-scripts'
