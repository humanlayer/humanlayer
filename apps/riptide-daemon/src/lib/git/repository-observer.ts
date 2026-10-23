import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { DaemonServices } from '@/agents/claudecode/types'
import { Sentry } from '@/instrument'
import { isWatchRelevant } from '@/lib/git/commit-watcher'
import { sessionRepoDirs, type WorkspaceSetupRows } from '@/lib/git/session-repo-dirs'
import logger from '@/logger'

const execFileAsync = promisify(execFile)

/** Periodic re-derivation of the live session set and re-probe of every session's checkouts. */
const RECONCILE_INTERVAL_MS = 30_000
/** Collapses the `observeSession` calls a run makes at its start and end into one probe. */
const OBSERVE_DEBOUNCE_MS = 1_000
const GIT_TIMEOUT_MS = 10_000
/** Matches the contract's `repositories` cap. */
const MAX_REPOSITORIES_PER_REPORT = 50

export interface ObservedRepository {
	localPath: string
	remoteUrl?: string
	branch?: string
}

export interface RepositoryObserver {
	/** Probe + report one session now; resolves once the report attempt has finished. */
	observeSession(sessionId: string): Promise<void>
	stop(): void
}

/** Seams for tests ONLY — production callers use the defaults. */
export interface RepositoryObserverOptions {
	reconcileIntervalMs?: number
	observeDebounceMs?: number
	/** Restricts reporting to the sessions this daemon runs. */
	hostId?: string
}

interface PendingObservation {
	timer: ReturnType<typeof setTimeout>
	promise: Promise<void>
	settle: () => void
}

/** Best-effort git probe; returns trimmed stdout or null on any failure. */
async function git(cwd: string, args: string[]): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync('git', args, {
			cwd,
			timeout: GIT_TIMEOUT_MS,
			encoding: 'utf8',
		})
		return stdout.trim()
	} catch {
		return null
	}
}

function snapshotSignature(repositories: ObservedRepository[]): string {
	return JSON.stringify(
		repositories
			.map((repo) => ({
				localPath: repo.localPath,
				remoteUrl: repo.remoteUrl ?? '',
				branch: repo.branch ?? '',
			}))
			.sort((left, right) => left.localPath.localeCompare(right.localPath)),
	)
}

/**
 * The daemon repository observer — the only thing on the system that can see which checkout a
 * session actually works in. For every live session it resolves each of its directories to a repo
 * root, reads the origin remote and the branch HEAD points at, and reports the snapshot to the API,
 * which is what links a session to the pull requests of those branches.
 *
 * Reports only on change (per-session in-memory signature, dropped when a session leaves the live
 * set) so a steady state is silent. Deliberately NOT gated on the commit-attribution or PR-tracking
 * opt-ins: the panel that consumes this is gated client-side and the observation is the link it
 * depends on. Best-effort throughout — a probe or report failure is logged and retried next cycle.
 */
export function startRepositoryObserver(
	services: DaemonServices,
	options: RepositoryObserverOptions = {},
): RepositoryObserver {
	const reconcileIntervalMs = options.reconcileIntervalMs ?? RECONCILE_INTERVAL_MS
	const observeDebounceMs = options.observeDebounceMs ?? OBSERVE_DEBOUNCE_MS
	const lastReported = new Map<string, string>()
	const pending = new Map<string, PendingObservation>()
	let stopped = false
	let reconciling = false

	// The API rejects a report for a session this host does not run, and a rejected report is
	// never remembered, so reporting one would retry every cycle for as long as the session lives.
	const isOwnSession = (session: { host_id: string }): boolean =>
		options.hostId === undefined || session.host_id === options.hostId

	async function probeDir(dir: string): Promise<ObservedRepository | null> {
		const root = await git(dir, ['rev-parse', '--show-toplevel'])
		if (!root) return null
		const branch = await git(root, ['symbolic-ref', '--short', '-q', 'HEAD'])
		const remoteUrl = await git(root, ['remote', 'get-url', 'origin'])
		return {
			localPath: root,
			remoteUrl: remoteUrl || undefined,
			branch: branch || undefined,
		}
	}

	async function snapshotOf(
		session: { working_directory: string; task_id: string | null; host_id: string },
		setupRows: WorkspaceSetupRows,
	): Promise<ObservedRepository[]> {
		const byRoot = new Map<string, ObservedRepository>()
		for (const dir of await sessionRepoDirs({ session, services, setupRows })) {
			const repository = await probeDir(dir)
			if (!repository) continue
			if (!byRoot.has(repository.localPath)) byRoot.set(repository.localPath, repository)
		}
		return [...byRoot.values()].slice(0, MAX_REPOSITORIES_PER_REPORT)
	}

	async function report(
		session: { id: string; working_directory: string; task_id: string | null; host_id: string },
		setupRows: WorkspaceSetupRows,
	): Promise<void> {
		try {
			const repositories = await snapshotOf(session, setupRows)
			// An empty snapshot says nothing about the session's repositories — a dir that could not
			// be probed this cycle must never look like "this session works nowhere".
			if (repositories.length === 0) return
			const signature = snapshotSignature(repositories)
			if (lastReported.get(session.id) === signature) return
			const { recorded } = await services.orpc.sessions.repositories.report({
				sessionId: session.id,
				repositories,
			})
			lastReported.set(session.id, signature)
			logger.debug(
				{ sessionId: session.id, repositories: repositories.length, recorded },
				'Reported session repositories',
			)
		} catch (error) {
			logger.error({ sessionId: session.id, error }, 'Session repository observation failed')
			Sentry.captureException(error, { tags: { error_type: 'session_repository_observe' } })
		}
	}

	async function observeNow(sessionId: string): Promise<void> {
		if (stopped) return
		const session = services.collections.sessions.toArray.find((candidate) => candidate.id === sessionId)
		if (!session || !isOwnSession(session)) return
		await report(session, services.collections.workspaceSetup.toArray)
	}

	async function reconcile(): Promise<void> {
		if (stopped || reconciling) return
		// One cycle costs three git subprocesses per repository, each with its own timeout, so a
		// hung checkout can outlast the interval. Overlapping cycles would multiply those.
		reconciling = true
		try {
			const now = Date.now()
			const sessions = services.collections.sessions.toArray.filter(
				(session) => isOwnSession(session) && isWatchRelevant(session, now),
			)
			const live = new Set(sessions.map((session) => session.id))
			// Forgetting a session that left the live set is what makes it report again if it returns.
			for (const sessionId of [...lastReported.keys()]) {
				if (!live.has(sessionId)) lastReported.delete(sessionId)
			}
			const setupRows = services.collections.workspaceSetup.toArray
			for (const session of sessions) await report(session, setupRows)
		} catch (error) {
			logger.error({ error }, 'Session repository reconcile failed')
			Sentry.captureException(error, { tags: { error_type: 'session_repository_reconcile' } })
		} finally {
			reconciling = false
		}
	}

	void reconcile()
	const interval = setInterval(() => void reconcile(), reconcileIntervalMs)

	return {
		observeSession(sessionId: string): Promise<void> {
			if (stopped) return Promise.resolve()
			// Calls arriving inside the debounce window join the scheduled probe instead of
			// restarting its timer, so a burst of calls can never postpone the report.
			const existing = pending.get(sessionId)
			if (existing) return existing.promise
			let settle: () => void = () => {}
			const promise = new Promise<void>((resolve) => {
				settle = resolve
			})
			const timer = setTimeout(() => {
				pending.delete(sessionId)
				void observeNow(sessionId).finally(settle)
			}, observeDebounceMs)
			pending.set(sessionId, { timer, promise, settle })
			return promise
		},
		stop() {
			stopped = true
			clearInterval(interval)
			for (const [sessionId, observation] of pending) {
				clearTimeout(observation.timer)
				pending.delete(sessionId)
				observation.settle()
			}
		},
	}
}
