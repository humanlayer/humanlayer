import type { PullRequestScope } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/ensure-stream'
import {
	type CheckRowType,
	checksOnCurrentCommit,
	mergeCheckRows,
	type PullRequestRowType,
} from '@humanlayer/streams/pr-status'
import { useLiveQuery } from '@tanstack/react-db'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { createPrStatusStreamDB, type PrStatusStreamDB } from '@/collections/stream/pr-status'
import { countFailingChecks } from '@/components/github/check-groups'
import { useStreamLiveness } from '@/hooks/useStreamLiveness'
import { isGitHubChecksPermissionError } from '@/lib/github-panel-error'
import { logger } from '@/lib/logger'
import { useRiptideApi } from '@/orpc/client'

/** `recorded`: the stream has nothing yet, so the panel shows the pull request the server recorded. */
export type PrStatusStreamStatus = 'idle' | 'hydrating' | 'ready' | 'unavailable' | 'permission_required' | 'recorded'

export interface PrStatusStreamResult {
	/** Whether the panel holds status worth counting into the tab badge; a section renders either way. */
	available: boolean
	status: PrStatusStreamStatus
	pullRequest: PullRequestRowType | null
	hasPullRequest: boolean
	/** Every check on the pull request's newest commit, hydrated once and kept live by webhooks. */
	checks: CheckRowType[]
	/** Derived here so the tab badge is live whether or not the GitHub tab is selected. */
	failingCheckCount: number
	repoFullName: string | null
	branch: string | null
	/** When the state was last known current, published only while the stream cannot be reached. */
	staleSince: number | null
}

const NO_CHECKS: CheckRowType[] = []
const NO_HELD_CHECKS: ReadonlyMap<string, CheckRowType> = new Map()

const UNAVAILABLE: PrStatusStreamResult = {
	available: false,
	status: 'unavailable',
	pullRequest: null,
	hasPullRequest: false,
	checks: NO_CHECKS,
	failingCheckCount: 0,
	repoFullName: null,
	branch: null,
	staleSince: null,
}

const HYDRATING: PrStatusStreamResult = { ...UNAVAILABLE, status: 'hydrating' }
const PERMISSION_REQUIRED: PrStatusStreamResult = { ...UNAVAILABLE, available: true, status: 'permission_required' }

/** Stop an initial preload from remaining hidden in the reader's indefinite reconnect loop. */
export const PR_STATUS_PRELOAD_TIMEOUT_MS = 10_000

async function withTimeout(attempt: Promise<unknown>, timeoutMs: number): Promise<void> {
	// The loser of the race still settles; without a handler its rejection is unhandled.
	void attempt.catch(() => undefined)
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		await Promise.race([
			attempt,
			new Promise((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error('pr-status preload timed out')), timeoutMs)
			}),
		])
	} finally {
		clearTimeout(timer)
	}
}

// The stream is last-write-wins and its writes are not ordered, so the collection's value for a
// check can go backwards. Readers fold through this instead: `mergeCheckRows` keeps the later
// fact per check and is idempotent, so a render React discards cannot leave it wrong.
const heldChecksByStream = new WeakMap<PrStatusStreamDB, ReadonlyMap<string, CheckRowType>>()

const foldChecks = (stream: PrStatusStreamDB, observed: readonly CheckRowType[]): CheckRowType[] => {
	const held = heldChecksByStream.get(stream) ?? NO_HELD_CHECKS
	const folded = mergeCheckRows(held, observed)
	if (folded !== held) heldChecksByStream.set(stream, folded)
	return [...folded.values()]
}

function useStreamRows(stream: PrStatusStreamDB | null, hasSynced: boolean) {
	const pullRequestCollection = stream?.collections.pullRequest
	const { data: pullRequestRows } = useLiveQuery(
		(q) => (hasSynced && pullRequestCollection ? q.from({ pullRequest: pullRequestCollection }) : undefined),
		[pullRequestCollection, hasSynced],
	)
	const checksCollection = stream?.collections.checks
	const { data: checkRows } = useLiveQuery(
		(q) => (hasSynced && checksCollection ? q.from({ checks: checksCollection }) : undefined),
		[checksCollection, hasSynced],
	)
	const pullRequest = (pullRequestRows?.[0] as PullRequestRowType | undefined) ?? null
	const observed = (checkRows as CheckRowType[] | undefined) ?? NO_CHECKS
	const checks = stream ? foldChecks(stream, observed) : NO_CHECKS
	return { pullRequest, checks: checksOnCurrentCommit({ pullRequest, checks }) }
}

export interface UsePrStatusStreamInput {
	scope: PullRequestScope
	repoFullName: string
	branch: string
}

/** The outcomes that the stream rows cannot change; null means the panel has state to render. */
function resolveSettledResult(input: {
	ensureError: unknown
	hasEnsureData: boolean
	preloadFailed: boolean
}): PrStatusStreamResult | null {
	if (input.ensureError !== null) {
		if (isGitHubChecksPermissionError(input.ensureError)) return PERMISSION_REQUIRED
		if (!input.hasEnsureData) return UNAVAILABLE
	}
	return input.preloadFailed ? UNAVAILABLE : null
}

export function usePrStatusStream(input: UsePrStatusStreamInput): PrStatusStreamResult {
	const { scope, repoFullName, branch } = input
	const { getAccessToken, isLoading: isAuthLoading } = useAuth()
	const { queryClient } = useRiptideApi()

	const ensureQuery = useQuery({
		...queryClient.integrations.github.pullRequests.ensureStream.queryOptions({
			input: { ...scope, repoFullName, branch },
			context: { silent: true },
		}),
		enabled: !isAuthLoading,
		retry: false,
		staleTime: 30_000,
		refetchOnWindowFocus: true,
	})

	const streamPath = ensureQuery.data?.streamPath ?? null
	// Bumped when the watchdog finds the stream gone and `ensureStream` has rebuilt it; the path
	// does not change across a rebuild, so this is what makes the memo below build a new StreamDB.
	const [generation, setGeneration] = useState(0)

	// A StreamDB is single-use: a second `preload()` after `close()` never resolves.
	const stream = useMemo(
		() => (streamPath ? createPrStatusStreamDB({ streamPath, getAccessToken }) : null),
		// eslint-disable-next-line react-hooks/exhaustive-deps -- `generation` is the rebuild key
		[streamPath, getAccessToken, generation],
	)
	useEffect(() => () => stream?.close(), [stream])

	const preloadQuery = useQuery({
		queryKey: ['pr-status-preload', streamPath, generation],
		queryFn: async () => {
			if (!stream) return false
			await withTimeout(stream.preload(), PR_STATUS_PRELOAD_TIMEOUT_MS).catch((error: unknown) => {
				stream.close()
				logger.error('[pr-status] preload failed', error)
				throw error
			})
			return true
		},
		enabled: Boolean(stream),
		retry: false,
		// A cached success belongs to the StreamDB that ran it, and a remount builds a new one, so
		// this must re-run rather than report the dead instance's result.
		gcTime: 0,
	})

	const hasSynced = preloadQuery.data === true

	const { refetch: refetchEnsure } = ensureQuery
	// A failed refetch keeps the stale panel: rebuilding against a 503 would leave no tab at all.
	const handleStreamLost = useCallback(() => {
		void refetchEnsure().then((result) => {
			if (result.data) setGeneration((value) => value + 1)
		})
	}, [refetchEnsure])
	const { staleSince } = useStreamLiveness({
		db: stream,
		getAccessToken,
		enabled: hasSynced,
		onStreamLost: handleStreamLost,
	})
	const { pullRequest, checks } = useStreamRows(stream, hasSynced)

	const settled = resolveSettledResult({
		ensureError: ensureQuery.isError ? ensureQuery.error : null,
		hasEnsureData: Boolean(ensureQuery.data),
		preloadFailed: preloadQuery.isError,
	})
	if (settled) return settled
	if (!ensureQuery.data) return HYDRATING

	return {
		available: true,
		status: hasSynced ? 'ready' : 'hydrating',
		pullRequest,
		hasPullRequest: ensureQuery.data.hasPullRequest,
		checks,
		failingCheckCount: countFailingChecks(checks),
		repoFullName: ensureQuery.data.repoFullName,
		branch: ensureQuery.data.branch,
		staleSince,
	}
}
