import type { CodingAgent } from '@humanlayer/schemas/coding-agent'

import { recordAgentEditToJournal } from './evidence/journal-overlap/authorship-journal'
import {
	ensureSessionHooksDir,
	gitConfigHooksEnv,
	type HookHostingMode,
	listRepoHookNames,
	supportsConfigHooks,
} from './evidence/trailer/session-hooks-dir'
import {
	SESSION_EXPIRES_ENV_VAR,
	SESSION_ID_ENV_VAR,
	SESSION_URL_ENV_VAR,
	sessionCommitUrl,
	sessionEnvExpiryEpoch,
} from './git-env'
import { resolveGitPaths } from './shared/git-paths'
import { writeStateBreadcrumb } from './shared/state-dir'

/**
 * The WRITE-side lifecycle — the whole harness integration, as two calls:
 *
 *   1. {@link armSessionAttribution} at session start: materializes the machine-local hooks dir
 *      and returns the env the session's process tree must carry — the session id, its deep-link
 *      URL, the expiry horizon, and the env-scoped git config that points the tree's git at our
 *      hooks. The env IS the entire arming: the stamper reads no state at commit time, so
 *      NOTHING is ever written into the user's repository and no per-worktree bookkeeping
 *      exists. A leaked env disarms itself at the horizon; every relaunch re-mints it.
 *      ({@link armSessionHooks} is the state-side half alone, for a process whose env is set
 *      by someone else — it hands back no env, so a tree can never be armed with an incomplete
 *      one.)
 *   2. {@link recordAgentActivity} on every tool call: journals any authored lines (the
 *      journal-overlap method's evidence) and reports when a still-active session has outlived
 *      its env horizon, so carriers can log it.
 *
 * Harnesses use these two calls to integrate attribution. The env is the ENTIRE coupling to
 * the repo: a process without it (any human shell) never invokes our code at all. Both calls are
 * best-effort by contract: they never throw, and a failure degrades to weaker attribution, never
 * a broken session. GATING stays with the caller (the org's `commit_tracking_enabled` answer
 * reaches each process differently — see ./gate), so these functions assume the gate is open.
 */

export type ArmOutcome =
	| {
			readonly armed: true
			/** Machine-local hooks dir the returned env references. */
			readonly hooksDir: string
			/** How the env hosts the stamper for this machine's git (see HookHostingMode). */
			readonly mode: HookHostingMode
	  }
	| { readonly armed: false; readonly reason: 'error'; readonly detail?: string }

export type ArmResult = {
	/**
	 * Env for the session's process tree: the session id, its deep-link URL (the trailer VALUE
	 * the stamper writes), the expiry horizon, and the `GIT_CONFIG_*` entries that host our
	 * hooks for exactly this tree. The git-config entries APPEND to any the base env already
	 * carries — callers must pass the env they will actually spread these onto as `baseEnv` when
	 * it is not process.env.
	 */
	readonly env: Record<string, string>
	/** What arming did (armed / skip reason) — for the caller's logs. */
	readonly install: ArmOutcome
}

/**
 * Machine-local breadcrumb of the LAST arm's outcome, in the state dir next to the hooks it
 * describes. "Fail safe" means attribution degrades to silently-off — this file is what makes
 * that silence diagnosable from the machine itself ("why isn't this box stamping?") without
 * hunting per-carrier logs. Last-writer-wins across concurrent arms; best-effort by nature
 * (when the state dir itself is the broken thing, the carrier's log line still has the outcome).
 */
export const ATTRIBUTION_HEALTH_FILE = 'attribution-health.json'

/**
 * Sibling breadcrumb for the OTHER diagnosable silence: a session still active past its env
 * horizon (its commits stopped stamping). Written by {@link recordAgentActivity} whenever it
 * observes that state; carriers additionally get the same fact in the return value for their
 * own logs.
 */
export const ATTRIBUTION_EXPIRED_FILE = 'attribution-expired.json'

/**
 * Arm commit attribution for a session about to run in `cwd`: ensure the machine-local hooks
 * dir and return the env to inject. Idempotent — re-arming refreshes nothing but bytes that
 * changed. The repo (when `cwd` is inside one) contributes only its hook NAMES (self-healing
 * trampoline coverage) and a cwd for the capability probe; a non-repo cwd still arms — the
 * stamper simply never fires outside a repo.
 *
 * The returned env ALWAYS carries the trailer URL. An origin the caller could not resolve is a
 * degraded link, never a missing trailer: `sessionCommitUrl('')` still yields `/sessions/<id>`,
 * which the stamper writes and the read side parses, so the commit stays `confirmed` instead of
 * falling back to the inferred tier. A carrier whose process tree is env'd elsewhere wants
 * {@link armSessionHooks}, which returns no env at all rather than a URL-less one.
 */
export async function armSessionAttribution(input: {
	readonly cwd: string
	readonly sessionId: string
	/** Which harness this session runs under (`claude`, `codelayer`, `fold`, ...). */
	readonly codingAgent: CodingAgent
	/** Origin of the app the trailer deep-links into, e.g. `https://app.humanlayer.dev`. */
	readonly appOrigin: string
	/** Env the caller will spread the result onto, for GIT_CONFIG_* index appending. */
	readonly baseEnv?: Record<string, string | undefined>
}): Promise<ArmResult> {
	const sessionEnv = {
		[SESSION_ID_ENV_VAR]: input.sessionId,
		[SESSION_URL_ENV_VAR]: sessionCommitUrl(input.appOrigin, input.sessionId),
		[SESSION_EXPIRES_ENV_VAR]: sessionEnvExpiryEpoch(Date.now()),
	}
	const { install, hooksEnv } = await ensureArmedHooks(input)
	return { env: { ...sessionEnv, ...hooksEnv }, install }
}

/**
 * The state-side HALF of an arm, for a process whose attribution env was set by its parent.
 * Same hooks dir, same breadcrumb, no env — the caller has no env to inject, so there is none
 * to get wrong.
 */
export async function armSessionHooks(input: {
	readonly cwd: string
	readonly sessionId: string
	readonly codingAgent: CodingAgent
}): Promise<ArmOutcome> {
	const { install } = await ensureArmedHooks(input)
	return install
}

async function ensureArmedHooks(input: {
	readonly cwd: string
	readonly sessionId: string
	readonly codingAgent: CodingAgent
	readonly baseEnv?: Record<string, string | undefined>
}): Promise<{ install: ArmOutcome; hooksEnv: Record<string, string> }> {
	let install: ArmOutcome
	let hooksEnv: Record<string, string> = {}
	try {
		// The repo's own hook names are the self-healing half of trampoline completeness (a repo
		// using a hook newer than the static floor gets it forwarded because arming SEES the
		// file; irrelevant in config-hooks mode, where nothing is shadowed).
		const paths = await resolveGitPaths(input.cwd)
		const [hooksDir, mode] = await Promise.all([
			ensureSessionHooksDir({
				extraHookNames: paths ? await listRepoHookNames(paths.hooksDir) : [],
			}),
			paths
				? supportsConfigHooks(input.cwd).then((yes): HookHostingMode => (yes ? 'config-hooks' : 'hooks-path'))
				: ('hooks-path' as const),
		])
		install = { armed: true, hooksDir, mode }
		hooksEnv = gitConfigHooksEnv(hooksDir, input.baseEnv ?? process.env, mode)
	} catch (error) {
		install = { armed: false, reason: 'error', detail: error instanceof Error ? error.message : String(error) }
	}

	await writeStateBreadcrumb(ATTRIBUTION_HEALTH_FILE, {
		sessionId: input.sessionId,
		codingAgent: input.codingAgent,
		...install,
	})
	return { install, hooksEnv }
}

/**
 * True when THIS process's env says the session outlived its stamp horizon. Only a process
 * that inherited session attribution env can report expiry; the daemon's own env never carries
 * a session horizon.
 */
function sessionEnvExpired(nowMs: number): boolean {
	const raw = process.env[SESSION_EXPIRES_ENV_VAR]
	if (!raw || !/^\d+$/.test(raw)) return false
	return Number(raw) * 1000 <= nowMs
}

/**
 * Record one tool call's worth of agent activity: fold any authored lines into the session's
 * on-disk journal (identical hashes no matter which harness observed the edit), and surface when
 * the session is active past its env horizon so the caller can log the only silent failure mode
 * this design has left. Never throws.
 */
export async function recordAgentActivity(input: {
	readonly cwd: string
	readonly sessionId: string
	readonly toolName: string
	readonly toolInput: unknown
}): Promise<{ journaledLines: number; sessionEnvExpired: boolean }> {
	const journaledLines = await recordAgentEditToJournal(input.sessionId, input.toolName, input.toolInput).catch(
		() => 0,
	)
	const expired = sessionEnvExpired(Date.now())
	// Idempotent last-writer-wins write, only in the rare over-horizon state — no dedupe needed
	// (the CLI carrier is a fresh process per tool call, where in-process dedupe is a no-op).
	if (expired) {
		await writeStateBreadcrumb(ATTRIBUTION_EXPIRED_FILE, {
			sessionId: input.sessionId,
			expiresAt: process.env[SESSION_EXPIRES_ENV_VAR] ?? null,
		})
	}
	return { journaledLines, sessionEnvExpired: expired }
}
