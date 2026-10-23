/**
 * `@humanlayer/git-attribution/git-env` — the ONE authority for how attribution's env-scoped git
 * config entries are shaped, importable from EVERY carrier.
 *
 * PURE LEAF by contract: no node imports, no platform sniffing, no I/O — because one of the
 * carriers is the riptide UI's PTY launcher, a webview that cannot load the package's main
 * entry (node builtins). Node carriers reach these same functions through the arm path
 * (session-hooks-dir delegates here); the webview imports this subpath directly. One
 * implementation means the two encodings below cannot drift between carriers — the scattered
 * per-call-site `replaceAll` string munging this module replaces is exactly how a quoting
 * divergence becomes a vulnerability.
 *
 * The two encodings, and why each is principled rather than ad-hoc:
 *
 *   1. {@link toGitHookPath} — PATH FORM. Values consumed by git's hook machinery on Windows
 *      pass through MSYS2 sh, whose path translation is reliable for `C:/forward/slash` and
 *      shaky for `C:\back\slash`. The transform is gated on the path's own shape (drive-letter
 *      or UNC prefix), never on the runtime platform: a POSIX path containing a literal
 *      backslash is left untouched, and the function is deterministic for any input anywhere.
 *
 *   2. {@link shellQuoteHookCommand} — WORD QUOTING. git runs a configured hook command via
 *      `sh -c '<command> "$@"'`, so the command string is a shell WORD we must quote or a
 *      spaced path word-splits (verified against a git master build). POSIX single-quoting with
 *      the `'\''` escape is the standard total encoding: every byte except the single quote is
 *      literal inside single quotes, and the escape handles that one.
 */

/**
 * How the env hosts the stamper for a machine's git:
 *   - `config-hooks`: additive `hook.<name>.event/command` registration (RELEASED git since
 *     v2.54.0, 2026-04) — nothing shadowed. git runs configured hooks first and the repo's own
 *     hookdir hook after, natively (hook.c: list_hooks_add_configured, then
 *     list_hooks_add_default), which is why this mode points at the CHAIN-FREE stamper entry
 *     ({@link CONFIG_STAMPER_NAME}): chaining the repo hook ourselves here would run it twice.
 *   - `hooks-path`: exclusive `core.hooksPath` shadowing (every git ≤ 2.53), made safe by the
 *     forwarding trampolines in the hooks dir and the chaining stamper.
 */
export type HookHostingMode = 'config-hooks' | 'hooks-path'

/** The friendly-name our config-mode hook registers under (must never equal an event name). */
const CONFIG_HOOK_NAME = 'humanlayer-attribution'

/**
 * Filename of the config-mode stamper entry in the hooks dir. Deliberately NOT a git hook name:
 * git must never resolve it from the hookdir on its own — only `hook.<name>.command` names it.
 */
export const CONFIG_STAMPER_NAME = 'stamp-commit-msg'

/**
 * The env vars through which a session's identity travels into every process a harness spawns —
 * written by the arm path (../session-attribution) and read by the stamper and the CLI hooks.
 * Here in the pure leaf so the webview launcher, which cannot load the node entry, names
 * them identically to the node carriers.
 */
export const SESSION_ID_ENV_VAR = 'HUMANLAYER_SESSION_ID'
export const SESSION_URL_ENV_VAR = 'HUMANLAYER_SESSION_URL'

/**
 * Epoch SECONDS after which the session env no longer stamps — the stamper's whole liveness
 * gate. Env is frozen at process spawn and cannot be revoked, so a var leaked into a long-lived
 * process (a tmux server born inside a session) would otherwise stamp forever; the horizon
 * bounds that. It only needs to outlive ONE process tree, not a workstream: every relaunch
 * (resume, app restart, new session) re-mints it. Malformed or absent values fail closed in the
 * stamper (no stamp).
 */
export const SESSION_EXPIRES_ENV_VAR = 'HUMANLAYER_SESSION_EXPIRES'

/**
 * How far ahead {@link sessionEnvExpiryEpoch} sets the horizon. A week comfortably outlives any
 * continuously-running session (the silent-loss direction), while still bounding a leaked env to
 * days instead of "until reboot" (and a mis-stamp is VISIBLE — the stray trailer sits in the
 * commit message). Carriers log when an active session outlives it (see recordAgentActivity).
 */
export const SESSION_ENV_HORIZON_MS = 7 * 24 * 60 * 60 * 1000

/** The {@link SESSION_EXPIRES_ENV_VAR} value for a session spawned now. */
export function sessionEnvExpiryEpoch(nowMs: number): string {
	return String(Math.floor((nowMs + SESSION_ENV_HORIZON_MS) / 1000))
}

/**
 * The session deep-link that becomes the trailer VALUE ({@link SESSION_URL_ENV_VAR}). Here in
 * the pure leaf because the webview PTY launcher mints it too; the trailer module re-exports it
 * for the node side.
 */
export function sessionCommitUrl(appOrigin: string, sessionId: string): string {
	return `${appOrigin.replace(/\/+$/, '')}/sessions/${sessionId}`
}

/** Basename of the machine-local hooks dir under the state dir (`<state>/git-hooks`). */
export const SESSION_HOOKS_DIR_NAME = 'git-hooks'

/**
 * Basename of the state-dir cache of the capability probe, for the ONE carrier that cannot run
 * git: the riptide UI's PTY launcher builds env in the webview, so it reads this file (written on
 * every arm by the processes that CAN probe) to pick the hosting mode. A fresh machine has no
 * file and the launcher fails safe to hooks-path; the first arm writes it and the next launch
 * converges.
 */
export const GIT_CAPABILITIES_FILE = 'git-capabilities.json'

/** Windows-shaped paths: a drive-letter prefix (`C:\` / `C:/`) or a UNC prefix (`\\server\...`). */
const WINDOWS_PATH_RE = /^(?:[A-Za-z]:[\\/]|\\\\)/

/** Path form for values git's hook machinery consumes — see the module doc, encoding (1). */
export function toGitHookPath(path: string): string {
	return WINDOWS_PATH_RE.test(path) ? path.replaceAll('\\', '/') : path
}

/** POSIX single-quote a shell word for git's configured-hook invocation — encoding (2). */
export function shellQuoteHookCommand(word: string): string {
	return `'${word.replaceAll("'", `'\\''`)}'`
}

/**
 * A ready-to-spread env fragment of `GIT_CONFIG_COUNT` + `GIT_CONFIG_KEY_<n>`/`_VALUE_<n>`
 * triples — the caller merges it into the process env verbatim and never reads the numbered
 * keys individually. Opaque by design: which keys exist and how many is this module's concern.
 */
export type AttributionGitConfigEnv = Record<string, string> & {
	GIT_CONFIG_COUNT?: string
	[key: `GIT_CONFIG_KEY_${number}`]: string
	[key: `GIT_CONFIG_VALUE_${number}`]: string
}

/**
 * The `GIT_CONFIG_*` entries that host the attribution stamper for a process tree, in the given
 * mode — APPENDED after any entries the target env already carries (clobbering index 0 would
 * eat e.g. a CI container's `safe.directory`). `baseEnv` must be the env the caller will
 * actually spread these onto; pass `{}` when building a fresh env (the PTY launcher).
 */
export function attributionGitConfigEntries(input: {
	readonly mode: HookHostingMode
	/** Absolute machine-local hooks dir (`<state>/git-hooks`), in the caller's native form. */
	readonly hooksDir: string
	readonly baseEnv: Record<string, string | undefined>
}): AttributionGitConfigEnv {
	const existing = Number.parseInt(input.baseEnv.GIT_CONFIG_COUNT ?? '0', 10)
	const base = Number.isFinite(existing) && existing > 0 ? existing : 0
	const hooksDir = toGitHookPath(input.hooksDir)
	if (input.mode === 'config-hooks') {
		return {
			GIT_CONFIG_COUNT: String(base + 2),
			[`GIT_CONFIG_KEY_${base}`]: `hook.${CONFIG_HOOK_NAME}.event`,
			[`GIT_CONFIG_VALUE_${base}`]: 'prepare-commit-msg',
			[`GIT_CONFIG_KEY_${base + 1}`]: `hook.${CONFIG_HOOK_NAME}.command`,
			[`GIT_CONFIG_VALUE_${base + 1}`]: shellQuoteHookCommand(`${hooksDir}/${CONFIG_STAMPER_NAME}`),
		}
	}
	return {
		GIT_CONFIG_COUNT: String(base + 1),
		[`GIT_CONFIG_KEY_${base}`]: 'core.hooksPath',
		[`GIT_CONFIG_VALUE_${base}`]: hooksDir,
	}
}
