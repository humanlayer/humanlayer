import { armSessionAttribution, recordAgentActivity } from '@humanlayer/git-attribution'
import type { CodingAgent } from '@humanlayer/schemas/coding-agent'

import { Sentry } from '@/instrument'
import { APP_ORIGIN } from '@/lib/macros'
import { orgTelemetryCache } from '@/lib/org-telemetry-settings'
import { normalizePath } from '@/lib/utils'
import logger from '@/logger'

/**
 * Commit attribution for daemon-driven sessions (Claude SDK, CodeLayer, and Fold): the daemon-side
 * POLICY adapter over @humanlayer/git-attribution's mechanism.
 *
 * The HEAD-watch scan (./commit-watcher) records every commit in a watched repo — which sweeps
 * in unrelated commits a human makes in the same working directory during a session. This module
 * makes the agent's own commits self-identify with a `HumanLayer-Session` trailer so capture can
 * attribute precisely instead of by time window.
 *
 * Mechanism (shared with every other agent path — see @humanlayer/git-attribution):
 *   1. At session preparation the daemon materializes the machine-local env-hosted hooks dir
 *      (nothing is written into the user's repository).
 *   2. The agent process env carries `HUMANLAYER_SESSION_ID` + `HUMANLAYER_SESSION_URL` +
 *      `HUMANLAYER_SESSION_EXPIRES`; every subprocess (including any `git commit`, however
 *      invoked — porcelain, `--amend`, a script that commits internally) inherits it, and the
 *      env-only stamper appends the trailer. The AUTHOR, COMMITTER, message content, and
 *      signing are all left untouched. Env leaked into long-lived child processes goes inert at
 *      the expiry horizon; every relaunch re-mints it.
 *   3. The HEAD-watch (./commit-watcher) reads the trailer back to attribute the commit as
 *      `confirmed`; trailer-less agent commits still attribute via the content-match INFERRED
 *      tier (attributeCommit in @humanlayer/git-attribution).
 *
 * This replaces the earlier PATH-shadowed `git` shim: the shim only covered processes that
 * resolved git through the injected PATH and only the `git commit` argv shape, which measurably
 * missed merge/porcelain commits (5 of 24 ground-truth agent commits in the branded-committer
 * era). The hook fires at the moment git creates ANY commit in the repo.
 *
 * Durability: the trailer rides the commit MESSAGE, so it survives amend/rebase (which mint new
 * SHAs and carry the message forward). A squash merge is forge-dependent — GitHub re-derives
 * squash co-authors from commit AUTHORS and does not promote trailers — which is why the ledger
 * records branch commits BEFORE they are squashed and PR linkage carries attribution across.
 */

export function isCommitAttributionEnabled(): boolean {
	return orgTelemetryCache.commitTrackingEnabled()
}

/**
 * Prepare commit attribution for a session about to run in `cwd`, and return the env vars its
 * process tree must carry.
 *
 * Returns `{}` when the feature is disabled. The env is returned even when arming declines
 * (unwritable state dir): the session id in the env costs nothing and keeps the inferred-tier
 * correlation intact. The env IS the whole repo coupling — the hooks live in the machine-local
 * state dir (env-hosted `core.hooksPath` / `hook.*`), never in the user's repository.
 */
export async function commitAttributionEnv(
	sessionId: string,
	opts: { cwd: string; codingAgent?: CodingAgent },
): Promise<Record<string, string>> {
	if (!isCommitAttributionEnabled()) return {}
	// The installed hook is self-contained sh — the daemon binary contributes no stamper (its
	// entrypoint is untouched by attribution), it just writes the same hook bytes every other
	// installer writes.
	const { env } = await armSessionAttribution({
		cwd: opts.cwd,
		sessionId,
		codingAgent: opts.codingAgent ?? 'claude',
		appOrigin: resolveAppOrigin(),
	})
	return env
}

/**
 * The one place the daemon decides the trailer's deep-link host: riptide-ui's origin, baked at
 * build time (`RIPTIDE_DAEMON_APP_ORIGIN`) and overridable at runtime (`RIPTIDE_APP_ORIGIN`).
 *
 * Never throws and never returns "no origin at all": an unresolvable one degrades to `''`, which
 * still mints `/sessions/<id>` — a trailer the stamper writes and capture parses, so the commit
 * keeps its `confirmed` tier and only the human-clickable link is lost. Both builds that bake this
 * module refuse to produce that state (../../../build.ts, apps/cli/build.ts), so reaching it means
 * a broken build: report it once, a bundler-time fact cannot change while the process runs.
 */
let missingAppOriginReported = false
function resolveAppOrigin(): string {
	if (APP_ORIGIN) return APP_ORIGIN
	if (!missingAppOriginReported) {
		missingAppOriginReported = true
		const error = new Error('APP_ORIGIN macro not set - RIPTIDE_DAEMON_APP_ORIGIN env var missing at build time')
		logger.error({ err: error }, 'APP_ORIGIN not set, commit trailers will carry a relative session link')
		Sentry.captureException(error)
	}
	return ''
}

/**
 * Record one tool call's worth of agent activity, with the daemon's policy applied: the gate
 * re-checked per call (it can flip mid-session), the session row's raw `working_directory`
 * normalized (`~`-prefixed dirs are real, and a raw one makes journal writes silently
 * fail), and fired without awaiting — attribution must never stall event processing. Every
 * daemon capture site (SDK event stream, CodeLayer hook, Fold hook) calls THIS, so the recipe cannot be
 * re-derived slightly differently per harness.
 */
export function recordAttributedAgentActivity(input: {
	workingDirectory: string
	sessionId: string
	toolName: string
	toolInput: unknown
}): void {
	if (!isCommitAttributionEnabled()) return
	void recordAgentActivity({
		cwd: normalizePath(input.workingDirectory),
		sessionId: input.sessionId,
		toolName: input.toolName,
		toolInput: input.toolInput,
	})
}
