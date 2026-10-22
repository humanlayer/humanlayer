import { type PullRequest } from '@humanlayer/db/tables/pull-requests'
import { sessionRepositories } from '@humanlayer/db/tables/session-repositories'
import { sessions } from '@humanlayer/db/tables/sessions'
import { and, eq, type SQL } from 'drizzle-orm'
import { Data, Effect } from 'effect'

import { checkTaskReadPermission } from '../../../../../db/task-auth'
import { findLinkedPullRequests } from '../../../../../effects/services/github/pull-requests/persistence'
import { PostgresDb } from '../../../../../effects/services/postgres/postgres-db.service'

export class PullRequestTargetUnresolvedError extends Data.TaggedError('PullRequestTargetUnresolvedError')<{
	readonly reason: 'session_not_found' | 'task_not_found' | 'repo_not_observed' | 'no_repository'
}> {}

export interface ResolvedPullRequestTarget {
	readonly taskId: string | null
	readonly sessionId: string | null
	readonly resourceOwnerUserId: string | null
	readonly repoFullName: string
	readonly branch: string
}

export type PullRequestScope = { sessionId: string } | { taskId: string }
export interface PullRequestRepoSelection {
	readonly repoFullName?: string
	readonly branch?: string
}
export type PullRequestTargetInput = PullRequestScope & PullRequestRepoSelection

export interface ObservedRepository {
	readonly sessionId: string
	readonly localPath: string
	readonly repoFullName: string | null
	readonly branch: string | null
	readonly isHead: boolean
	readonly lastSeenAt: bigint
}

/**
 * A pull request belongs to a task and is worked on by any number of its sessions, so the list is
 * the task's: every session's observations, ranked for the one session the caller is looking at.
 */
export interface ScopeRepositories {
	readonly taskId: string | null
	/** The session the list is ranked for; null for a task-wide list. */
	readonly sessionId: string | null
	readonly resourceOwnerUserId: string | null
	readonly workingDirectory: string | null
	/** Every repository the daemon has observed for the task's sessions, or for a task-less session alone. */
	readonly repositories: readonly ObservedRepository[]
	/** The pull requests already linked to the task, or to the task-less session, newest first. */
	readonly records: readonly PullRequest[]
}

export const normalizePath = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '')

const containsWorkingDirectory = (localPath: string, workingDirectory: string | null): boolean => {
	if (!workingDirectory) return false
	const directory = normalizePath(workingDirectory)
	const root = normalizePath(localPath)
	return directory === root || directory.startsWith(`${root}/`)
}

export const loadScopeRepositories = (input: {
	readonly organizationId: string
	readonly userId: string
	readonly scope: PullRequestScope
}) =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb

		const selectObserved = (where: SQL | undefined) =>
			postgres.query(
				postgres.client
					.select({
						sessionId: sessionRepositories.session_id,
						localPath: sessionRepositories.local_path,
						repoFullName: sessionRepositories.repo_full_name,
						branch: sessionRepositories.branch,
						isHead: sessionRepositories.is_head,
						lastSeenAt: sessionRepositories.last_seen_at,
					})
					.from(sessionRepositories)
					.where(where),
			)

		if ('sessionId' in input.scope) {
			const [session] = yield* postgres.query(
				postgres.client
					.select({
						id: sessions.id,
						taskId: sessions.task_id,
						workingDirectory: sessions.working_directory,
						resourceOwnerUserId: sessions.resource_owner_user_id,
					})
					.from(sessions)
					.where(
						and(eq(sessions.id, input.scope.sessionId), eq(sessions.organization_id, input.organizationId)),
					)
					.limit(1),
			)
			if (!session)
				return yield* Effect.fail(new PullRequestTargetUnresolvedError({ reason: 'session_not_found' }))

			const sessionTaskId = session.taskId
			let resourceOwnerUserId: string | null = session.resourceOwnerUserId
			if (sessionTaskId) {
				const access = yield* postgres.run(() =>
					checkTaskReadPermission(postgres.client, sessionTaskId, input.userId, input.organizationId),
				)
				if (!access.ok) {
					return yield* Effect.fail(new PullRequestTargetUnresolvedError({ reason: 'task_not_found' }))
				}
				resourceOwnerUserId = access.task.resource_owner_user_id
			} else if (session.resourceOwnerUserId !== input.userId) {
				return yield* Effect.fail(new PullRequestTargetUnresolvedError({ reason: 'session_not_found' }))
			}

			const repositories = yield* selectObserved(
				and(
					eq(sessionRepositories.organization_id, input.organizationId),
					sessionTaskId
						? eq(sessionRepositories.task_id, sessionTaskId)
						: eq(sessionRepositories.session_id, session.id),
				),
			)
			const records = yield* findLinkedPullRequests({
				organizationId: input.organizationId,
				owner: sessionTaskId ? { taskId: sessionTaskId } : { sessionId: session.id },
			})

			return {
				taskId: sessionTaskId,
				sessionId: session.id,
				resourceOwnerUserId,
				workingDirectory: session.workingDirectory,
				repositories,
				records,
			} satisfies ScopeRepositories
		}

		const taskId = input.scope.taskId
		const access = yield* postgres.run(() =>
			checkTaskReadPermission(postgres.client, taskId, input.userId, input.organizationId),
		)
		if (!access.ok) {
			return yield* Effect.fail(new PullRequestTargetUnresolvedError({ reason: 'task_not_found' }))
		}

		const repositories = yield* selectObserved(
			and(eq(sessionRepositories.organization_id, input.organizationId), eq(sessionRepositories.task_id, taskId)),
		)
		const records = yield* findLinkedPullRequests({
			organizationId: input.organizationId,
			owner: { taskId },
		})

		return {
			taskId,
			sessionId: null,
			resourceOwnerUserId: access.task.resource_owner_user_id,
			workingDirectory: null,
			repositories,
			records,
		} satisfies ScopeRepositories
	}).pipe(
		Effect.withSpan('github.pull_requests.load_scope_repositories', {
			attributes: { organization_id: input.organizationId },
		}),
	)

export interface PullRequestCandidate {
	readonly repoFullName: string
	readonly branch: string
	/**
	 * True while HEAD points at the branch in a checkout of the session the list is ranked for;
	 * in any session's checkout for a task-wide list.
	 */
	readonly isCurrent: boolean
	/** The sessions that observed the branch, most recently first; empty for a record nobody observed. */
	readonly sessionIds: readonly string[]
	readonly rank: number
	readonly workingDirectoryDepth: number
	readonly lastSeenAt: bigint
	readonly recordIndex: number
}

/** Affinity to the session the list is ranked for, strongest first. */
const RANK_CURRENT = 0
const RANK_SEEN_BY_SESSION = 1
const RANK_SEEN_BY_TASK = 2
const RANK_RECORDED_ONLY = 3

export const candidateIdentity = (candidate: { readonly repoFullName: string; readonly branch: string }): string =>
	`${candidate.repoFullName.toLowerCase()}:${candidate.branch}`

const byAffinityThenRecency = (a: PullRequestCandidate, b: PullRequestCandidate): number =>
	a.rank - b.rank ||
	(a.rank === RANK_CURRENT ? b.workingDirectoryDepth - a.workingDirectoryDepth : 0) ||
	(a.lastSeenAt === b.lastSeenAt ? 0 : a.lastSeenAt > b.lastSeenAt ? -1 : 1) ||
	a.recordIndex - b.recordIndex

interface ObservedBranch {
	readonly repoFullName: string
	readonly branch: string
	isCurrent: boolean
	workingDirectoryDepth: number
	lastSeenAt: bigint
	readonly lastSeenBySession: Map<string, bigint>
}

const newestFirst = (seen: ReadonlyMap<string, bigint>): string[] =>
	[...seen.entries()].sort(([, a], [, b]) => (a === b ? 0 : a > b ? -1 : 1)).map(([sessionId]) => sessionId)

const collectObservedCandidates = (repositories: ScopeRepositories): PullRequestCandidate[] => {
	const rankedFor = repositories.sessionId
	const merged = new Map<string, ObservedBranch>()
	for (const repository of repositories.repositories) {
		if (!repository.repoFullName || !repository.branch) continue
		const identity = candidateIdentity({ repoFullName: repository.repoFullName, branch: repository.branch })
		const depth = containsWorkingDirectory(repository.localPath, repositories.workingDirectory)
			? normalizePath(repository.localPath).length
			: 0
		const observed = merged.get(identity) ?? {
			repoFullName: repository.repoFullName,
			branch: repository.branch,
			isCurrent: false,
			workingDirectoryDepth: 0,
			lastSeenAt: repository.lastSeenAt,
			lastSeenBySession: new Map<string, bigint>(),
		}
		observed.isCurrent ||= repository.isHead && (rankedFor === null || repository.sessionId === rankedFor)
		observed.workingDirectoryDepth = Math.max(observed.workingDirectoryDepth, depth)
		if (repository.lastSeenAt > observed.lastSeenAt) observed.lastSeenAt = repository.lastSeenAt
		const seenAt = observed.lastSeenBySession.get(repository.sessionId)
		if (seenAt === undefined || repository.lastSeenAt > seenAt) {
			observed.lastSeenBySession.set(repository.sessionId, repository.lastSeenAt)
		}
		merged.set(identity, observed)
	}
	return [...merged.values()].map((observed) => ({
		repoFullName: observed.repoFullName,
		branch: observed.branch,
		isCurrent: observed.isCurrent,
		sessionIds: newestFirst(observed.lastSeenBySession),
		rank: observed.isCurrent
			? RANK_CURRENT
			: rankedFor !== null && observed.lastSeenBySession.has(rankedFor)
				? RANK_SEEN_BY_SESSION
				: RANK_SEEN_BY_TASK,
		workingDirectoryDepth: observed.workingDirectoryDepth,
		lastSeenAt: observed.lastSeenAt,
		recordIndex: 0,
	}))
}

/** Records on branches nobody observed: the daemon captured them before the observer existed. */
const collectRecordedCandidates = (
	repositories: ScopeRepositories,
	observed: readonly PullRequestCandidate[],
): PullRequestCandidate[] => {
	const known = new Set(observed.map(candidateIdentity))
	const candidates: PullRequestCandidate[] = []
	repositories.records.forEach((record, index) => {
		const identity = candidateIdentity({ repoFullName: record.repo_full_name, branch: record.head_ref })
		if (known.has(identity)) return
		known.add(identity)
		candidates.push({
			repoFullName: record.repo_full_name,
			branch: record.head_ref,
			isCurrent: false,
			sessionIds: record.session_id ? [record.session_id] : [],
			rank: RANK_RECORDED_ONLY,
			workingDirectoryDepth: 0,
			lastSeenAt: 0n,
			recordIndex: index,
		})
	})
	return candidates
}

/**
 * The session's current checkouts first, the one holding its working directory ahead of them, then
 * the branches it observed, then the rest of the task's, each group by recency.
 */
export const collectPullRequestCandidates = (repositories: ScopeRepositories): readonly PullRequestCandidate[] => {
	const observed = collectObservedCandidates(repositories)
	return [...observed, ...collectRecordedCandidates(repositories, observed)].sort(byAffinityThenRecency)
}

/** The session a record on the branch is written for: the one looked at when it observed the branch, else the newest observer. */
export const attributedSessionId = (candidate: PullRequestCandidate, rankedFor: string | null): string | null =>
	rankedFor !== null && candidate.sessionIds.includes(rankedFor) ? rankedFor : (candidate.sessionIds[0] ?? rankedFor)

export const resolvePullRequestTarget = (input: {
	readonly organizationId: string
	readonly userId: string
	readonly scope: PullRequestTargetInput
}) =>
	Effect.gen(function* () {
		const repositories = yield* loadScopeRepositories(input)
		const candidates = collectPullRequestCandidates(repositories)
		const { repoFullName: requestedRepo, branch: requestedBranch } = input.scope

		const selected =
			requestedRepo && requestedBranch
				? candidates.find(
						(candidate) =>
							candidateIdentity(candidate) ===
							candidateIdentity({ repoFullName: requestedRepo, branch: requestedBranch }),
					)
				: candidates[0]

		if (!selected) {
			return yield* Effect.fail(
				new PullRequestTargetUnresolvedError({
					reason: requestedRepo && requestedBranch ? 'repo_not_observed' : 'no_repository',
				}),
			)
		}

		return {
			taskId: repositories.taskId,
			sessionId: attributedSessionId(selected, repositories.sessionId),
			resourceOwnerUserId: repositories.resourceOwnerUserId,
			repoFullName: selected.repoFullName,
			branch: selected.branch,
		} satisfies ResolvedPullRequestTarget
	}).pipe(
		Effect.withSpan('github.pull_requests.resolve_target', {
			attributes: { organization_id: input.organizationId },
		}),
	)
