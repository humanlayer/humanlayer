import { describe, it } from '@effect/vitest'
import { Effect, Layer, Redacted } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import type { HttpClientRequest } from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { expect } from 'vitest'

import { checkGitHubCapability, deriveGitHubCapabilities } from '../../src/effects/services/github/github.permissions'
import { fetchPullRequest } from '../../src/effects/services/github/procedures/fetch-pull-request'
import {
	countReviewThreads,
	type GitHubPullRequestWire,
	type GitHubReviewWire,
	type GitHubStatusCheckRollupContextWireType,
	pullRequestRowId,
	selectPanelPullRequest,
	toChangesRequestedReviews,
	toCheckRows,
	toPullRequestRow,
} from '../../src/effects/services/github/pull-requests/github-api'
import { splitRepoFullName } from '../../src/effects/services/github/repo-name'

const input = {
	apiBaseUrl: new URL('https://api.github.test'),
	installationToken: Redacted.make('installation-token'),
	repoFullName: 'humanlayer/syncopate',
	branch: 'feat/pr-status',
}

const jsonResponse = (request: HttpClientRequest, body: string) =>
	HttpClientResponse.fromWeb(
		request,
		new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
	)

const forbiddenTransport = Layer.succeed(
	HttpClient.HttpClient,
	HttpClient.make(() => Effect.die('The capability guard must fire before any GitHub request')),
)

const checkRunNode: GitHubStatusCheckRollupContextWireType = {
	__typename: 'CheckRun',
	name: 'typecheck',
	status: 'COMPLETED',
	conclusion: 'FAILURE',
	startedAt: '2026-08-30T09:00:00Z',
	completedAt: '2026-08-30T09:01:12Z',
	detailsUrl: 'https://github.com/humanlayer/syncopate/actions/runs/1/job/2',
}

const statusContextNode: GitHubStatusCheckRollupContextWireType = {
	__typename: 'StatusContext',
	context: 'ci/legacy',
	state: 'SUCCESS',
	targetUrl: 'https://ci.example.test/build/9',
	createdAt: '2026-08-30T09:02:00Z',
}

const HEAD_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
const REVIEW_URL = 'https://github.com/humanlayer/syncopate/pull/2261#pullrequestreview-1'

const rollup = (nodes: ReadonlyArray<GitHubStatusCheckRollupContextWireType | null>) => ({
	totalCount: 3,
	nodes: [{ commit: { oid: HEAD_SHA, message: '', statusCheckRollup: { contexts: { nodes } } } }],
})

const mergeStateNode = {
	mergeStateStatus: 'CLEAN',
	autoMergeRequest: null,
	viewerCanEnableAutoMerge: false,
	viewerCanDisableAutoMerge: false,
	viewerCanUpdateBranch: false,
	mergeHeadline: 'Merge pull request #2261 from humanlayer/feat/pr-status',
	mergeBody: 'Show GitHub pull request status in the session sidebar',
	squashHeadline: 'Show GitHub pull request status in the session sidebar (#2261)',
	squashBody: '* first\n\n* second\n\n* third',
} as const

const repositorySettings = {
	mergeCommitAllowed: true,
	squashMergeAllowed: true,
	rebaseMergeAllowed: false,
	viewerDefaultMergeMethod: 'SQUASH',
} as const

const wireNode = {
	number: 2261,
	title: 'Show GitHub pull request status in the session sidebar',
	url: 'https://github.com/humanlayer/syncopate/pull/2261',
	state: 'OPEN',
	isDraft: false,
	mergeable: 'MERGEABLE',
	reviewDecision: 'REVIEW_REQUIRED',
	headRefName: 'feat/pr-status',
	baseRefName: 'main',
	headRepository: { nameWithOwner: 'HumanLayer/Syncopate' },
	reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
	latestReviews: { nodes: [] },
	...mergeStateNode,
	commits: rollup([checkRunNode, statusContextNode]),
}

const recordingTransport = (body: unknown, requests: { url: string; body: string }[]) =>
	Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request, url) =>
			Effect.gen(function* () {
				const text = yield* Effect.promise(async () =>
					request.body._tag === 'Uint8Array' ? new TextDecoder().decode(request.body.body) : '',
				)
				requests.push({ url: `${url.pathname}${url.search}`, body: text })
				return jsonResponse(request, JSON.stringify(body))
			}),
		),
	)

describe('GitHub pull request boundaries', () => {
	it.effect('decodes one pull request from the panel query and posts it to /graphql', () => {
		const requests: { url: string; body: string }[] = []
		return Effect.gen(function* () {
			const fetched = yield* fetchPullRequest(input)
			expect(fetched?.wire).toMatchObject({ number: 2261, headRefName: 'feat/pr-status' })
			expect(fetched?.moreReviewThreads).toEqual([])
			expect(fetched?.repository).toEqual(repositorySettings)
			expect(requests).toHaveLength(1)
			expect(requests[0]?.url).toBe('/graphql')
			expect(JSON.parse(requests[0]?.body ?? '{}').variables).toEqual({
				owner: 'humanlayer',
				repo: 'syncopate',
				branch: 'feat/pr-status',
			})
		}).pipe(
			Effect.provide(
				recordingTransport(
					{ data: { repository: { ...repositorySettings, pullRequests: { nodes: [wireNode] } } } },
					requests,
				),
			),
		)
	})

	it.effect('follows the thread cursor until the last page, one query per page', () => {
		const requests: { url: string; body: string }[] = []
		const page = (isResolved: boolean, endCursor: string | null) => ({
			pageInfo: { hasNextPage: endCursor !== null, endCursor },
			nodes: [{ isResolved }],
		})
		const responses = [
			{
				data: {
					repository: {
						...repositorySettings,
						pullRequests: { nodes: [{ ...wireNode, reviewThreads: page(false, 'c1') }] },
					},
				},
			},
			{ data: { repository: { pullRequest: { reviewThreads: page(true, 'c2') } } } },
			{ data: { repository: { pullRequest: { reviewThreads: page(false, null) } } } },
		]
		const pagingTransport = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make((request) =>
				Effect.gen(function* () {
					const text = yield* Effect.promise(async () =>
						request.body._tag === 'Uint8Array' ? new TextDecoder().decode(request.body.body) : '',
					)
					requests.push({ url: '/graphql', body: text })
					return jsonResponse(request, JSON.stringify(responses[requests.length - 1]))
				}),
			),
		)
		return Effect.gen(function* () {
			const fetched = yield* fetchPullRequest(input)
			expect(fetched?.moreReviewThreads).toHaveLength(2)
			expect(requests.map((request) => JSON.parse(request.body).variables.after)).toEqual([undefined, 'c1', 'c2'])
			expect(JSON.parse(requests[1]?.body ?? '{}').variables).toMatchObject({ number: 2261 })
			const row = toPullRequestRow({ repoFullName: input.repoFullName, branch: input.branch, ...fetched! })
			expect(row).toMatchObject({ unresolvedThreadCount: 2, resolvedThreadCount: 1 })
		}).pipe(Effect.provide(pagingTransport))
	})

	it.effect('reports the pre-PR state as null rather than as a failure', () => {
		const requests: { url: string; body: string }[] = []
		return Effect.gen(function* () {
			expect(yield* fetchPullRequest(input)).toBeNull()
		}).pipe(
			Effect.provide(
				recordingTransport(
					{ data: { repository: { ...repositorySettings, pullRequests: { nodes: [] } } } },
					requests,
				),
			),
		)
	})

	it.effect('reports an installation that no longer covers the repository as null', () => {
		const requests: { url: string; body: string }[] = []
		return Effect.gen(function* () {
			expect(yield* fetchPullRequest(input)).toBeNull()
		}).pipe(Effect.provide(recordingTransport({ data: { repository: null } }, requests)))
	})

	it.effect('fails on a 200 response carrying GraphQL errors', () => {
		const requests: { url: string; body: string }[] = []
		return Effect.gen(function* () {
			const error = yield* Effect.flip(fetchPullRequest(input))
			expect(error._tag).toBe('GitHubProviderDecodeError')
			expect(error.cause).toMatchObject({
				kind: 'graphql_errors',
				messages: 'Something went wrong',
				types: ['INTERNAL'],
			})
		}).pipe(
			Effect.provide(
				recordingTransport(
					{ data: null, errors: [{ type: 'INTERNAL', message: 'Something went wrong' }] },
					requests,
				),
			),
		)
	})

	// A refusal is GitHub answering with what the grant covers and denying the rest, reported per
	// denied node. It is the connection's permission state, not a failed document.
	it.effect('reports a refusal apart from a failed document, carrying the refused paths', () => {
		const requests: { url: string; body: string }[] = []
		return Effect.gen(function* () {
			const error = yield* Effect.flip(fetchPullRequest(input))
			expect(error._tag).toBe('GitHubProviderForbiddenError')
			expect(error).toMatchObject({
				paths: ['repository.pullRequests.nodes.0.commits', 'repository.pullRequests.nodes.1.commits'],
				messages: 'Resource not accessible by integration; Resource not accessible by integration',
			})
		}).pipe(
			Effect.provide(
				recordingTransport(
					{
						data: { repository: { pullRequests: { nodes: [null, null] } } },
						errors: [
							{
								type: 'FORBIDDEN',
								message: 'Resource not accessible by integration',
								path: ['repository', 'pullRequests', 'nodes', 0, 'commits'],
							},
							{
								type: 'FORBIDDEN',
								message: 'Resource not accessible by integration',
								path: ['repository', 'pullRequests', 'nodes', 1, 'commits'],
							},
						],
					},
					requests,
				),
			),
		)
	})

	// Every installation holds metadata:read, so a refusal of the root is never the grant; it is the
	// organization's IP allow list or SAML policy, and no refresh of the grant would change it.
	it.effect('reports a refusal at the root as the repository being blocked, not the grant', () => {
		const requests: { url: string; body: string }[] = []
		return Effect.gen(function* () {
			const error = yield* Effect.flip(fetchPullRequest(input))
			expect(error._tag).toBe('GitHubProviderAccessBlockedError')
			expect(error).toMatchObject({ paths: ['repository'] })
			expect(String((error as { messages: string }).messages)).toContain('IP allow list')
		}).pipe(
			Effect.provide(
				recordingTransport(
					{
						data: { repository: null },
						errors: [
							{
								type: 'FORBIDDEN',
								message:
									'Although you appear to have the correct authorization credentials, the humanlayer organization has an IP allow list enabled, and your IP address is not permitted to access this resource.',
								path: ['repository'],
							},
						],
					},
					requests,
				),
			),
		)
	})

	// A refusal mixed with another failure is still the installation's grant: that is the one
	// thing the reader can act on, and acting on it is what makes the rest reachable.
	it.effect('reports a refusal mixed with another error as a refusal', () => {
		const requests: { url: string; body: string }[] = []
		return Effect.gen(function* () {
			const error = yield* Effect.flip(fetchPullRequest(input))
			expect(error._tag).toBe('GitHubProviderForbiddenError')
		}).pipe(
			Effect.provide(
				recordingTransport(
					{
						data: null,
						errors: [
							{ type: 'FORBIDDEN', message: 'Resource not accessible by integration', path: ['a'] },
							{ type: 'INTERNAL', message: 'Something went wrong', path: ['b'] },
						],
					},
					requests,
				),
			),
		)
	})

	it.effect('rejects a repository name that is not owner/repo before any request', () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(fetchPullRequest({ ...input, repoFullName: 'syncopate' }))
			expect(error._tag).toBe('GitHubProviderDecodeError')
			expect(error.cause).toBe('invalid_repo_full_name')
		}).pipe(Effect.provide(forbiddenTransport)),
	)

	it('gates the panel on Checks read before any provider call', () => {
		const legacyGrant = { metadata: 'read', issues: 'write', pull_requests: 'write' } as const
		expect(deriveGitHubCapabilities(legacyGrant).readChecks).toBe(false)
		expect(deriveGitHubCapabilities(legacyGrant).readCommitStatuses).toBe(false)
		expect(checkGitHubCapability(legacyGrant, 'readChecks')).toEqual({
			capability: 'readChecks',
			requiredPermission: 'checks',
			requiredLevel: 'read',
			grantedLevel: null,
		})
		expect(checkGitHubCapability({ ...legacyGrant, checks: 'read' }, 'readChecks')).toBeNull()
	})

	it('splits owner/repo and rejects anything else', () => {
		expect(splitRepoFullName('humanlayer/syncopate')).toEqual({ owner: 'humanlayer', repo: 'syncopate' })
		expect(splitRepoFullName('syncopate')).toBeNull()
		expect(splitRepoFullName('a/b/c')).toBeNull()
		expect(splitRepoFullName('/syncopate')).toBeNull()
	})

	it('maps the wire pull request onto the stream row', () => {
		const row = toPullRequestRow({
			repoFullName: 'HumanLayer/Syncopate',
			branch: 'feat/pr-status',
			wire: { ...wireNode, state: 'OPEN', mergeable: 'MERGEABLE', reviewDecision: 'REVIEW_REQUIRED' },
			repository: repositorySettings,
		})
		expect(row.id).toBe(pullRequestRowId({ repoFullName: 'HumanLayer/Syncopate', branch: 'feat/pr-status' }))
		expect(row.id).toBe('humanlayer/syncopate:feat/pr-status')
		expect(row).toMatchObject({ number: 2261, mergeable: true, headRef: 'feat/pr-status', baseRef: 'main' })
		expect(row).toMatchObject({ unresolvedThreadCount: 0, resolvedThreadCount: 0, changesRequestedReviews: [] })
	})

	it('counts threads across pages and skips the holes GitHub leaves for deleted ones', () => {
		expect(
			countReviewThreads([
				{
					pageInfo: { hasNextPage: true, endCursor: 'c1' },
					nodes: [{ isResolved: false }, null, { isResolved: true }],
				},
				{ pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ isResolved: false }] },
			]),
		).toEqual({ unresolved: 2, resolved: 1 })
	})

	it('quotes only reviewers standing on changes with something to say, newest first', () => {
		const review = (overrides: Partial<GitHubReviewWire>): GitHubReviewWire => ({
			state: 'CHANGES_REQUESTED',
			body: 'Please split this.',
			submittedAt: '2026-09-01T10:00:00Z',
			url: REVIEW_URL,
			author: { login: 'reviewer' },
			...overrides,
		})
		expect(
			toChangesRequestedReviews([
				review({ author: { login: 'older' }, submittedAt: '2026-08-30T10:00:00Z' }),
				null,
				review({ state: 'APPROVED', author: { login: 'approver' } }),
				review({ body: '   ', author: { login: 'silent' } }),
				review({ state: 'COMMENTED', author: { login: 'commenter' } }),
				review({ author: null, body: 'Rename the flag.', submittedAt: '2026-09-02T10:00:00Z' }),
				review({ author: { login: 'newer' } }),
			]),
		).toEqual([
			{ login: null, body: 'Rename the flag.', submittedAt: '2026-09-02T10:00:00Z', url: REVIEW_URL },
			{ login: 'newer', body: 'Please split this.', submittedAt: '2026-09-01T10:00:00Z', url: REVIEW_URL },
			{ login: 'older', body: 'Please split this.', submittedAt: '2026-08-30T10:00:00Z', url: REVIEW_URL },
		])
	})

	it("carries GitHub's merge state and the repository's merge settings onto the row", () => {
		const row = toPullRequestRow({
			repoFullName: 'HumanLayer/Syncopate',
			branch: 'feat/pr-status',
			wire: {
				...wireNode,
				state: 'OPEN',
				mergeable: 'MERGEABLE',
				reviewDecision: null,
				mergeStateStatus: 'BLOCKED',
				autoMergeRequest: { enabledBy: { login: 'pepijn' }, mergeMethod: 'SQUASH' },
				viewerCanDisableAutoMerge: true,
			},
			repository: repositorySettings,
		})
		expect(row.merge).toEqual({
			...mergeStateNode,
			...repositorySettings,
			mergeStateStatus: 'BLOCKED',
			autoMergeRequest: { enabledBy: { login: 'pepijn' }, mergeMethod: 'SQUASH' },
			viewerCanDisableAutoMerge: true,
			commitCount: 3,
		})
	})

	it('maps both halves of the rollup onto one check vocabulary', () => {
		const rows = toCheckRows({ ...wireNode, state: 'OPEN', mergeable: 'MERGEABLE', reviewDecision: null })
		expect(rows).toEqual([
			{
				id: 'check_run:typecheck',
				name: 'typecheck',
				headSha: HEAD_SHA,
				status: 'COMPLETED',
				conclusion: 'FAILURE',
				detailsUrl: 'https://github.com/humanlayer/syncopate/actions/runs/1/job/2',
				startedAt: '2026-08-30T09:00:00Z',
				completedAt: '2026-08-30T09:01:12Z',
			},
			{
				id: 'status_context:ci/legacy',
				name: 'ci/legacy',
				headSha: HEAD_SHA,
				status: 'COMPLETED',
				conclusion: 'SUCCESS',
				detailsUrl: 'https://ci.example.test/build/9',
				startedAt: '2026-08-30T09:02:00Z',
				completedAt: '2026-08-30T09:02:00Z',
			},
		])
	})

	it('keeps a check run and a commit status of the same name apart', () => {
		const rows = toCheckRows({
			...wireNode,
			state: 'OPEN',
			mergeable: 'MERGEABLE',
			reviewDecision: null,
			commits: rollup([
				{ ...checkRunNode, name: 'build' },
				{ ...statusContextNode, context: 'build' },
			]),
		})
		expect(rows.map((row) => row.id)).toEqual(['check_run:build', 'status_context:build'])
	})

	it.each([
		['SUCCESS', 'COMPLETED', 'SUCCESS'],
		['FAILURE', 'COMPLETED', 'FAILURE'],
		['ERROR', 'COMPLETED', 'FAILURE'],
		['PENDING', 'IN_PROGRESS', null],
		['EXPECTED', 'PENDING', null],
	] as const)('maps commit status %s to %s / %s', (state, status, conclusion) => {
		const rows = toCheckRows({
			...wireNode,
			state: 'OPEN',
			mergeable: 'MERGEABLE',
			reviewDecision: null,
			commits: rollup([{ ...statusContextNode, state }]),
		})
		expect(rows[0]).toMatchObject({ status, conclusion })
		expect(rows[0]?.completedAt).toBe(status === 'COMPLETED' ? statusContextNode.createdAt : null)
	})

	it.each([
		[
			'a repository with no CI configured',
			{ totalCount: 1, nodes: [{ commit: { oid: HEAD_SHA, message: '', statusCheckRollup: null } }] },
		],
		['a pull request GitHub reports no commits for', { totalCount: 0, nodes: [] }],
		['a rollup entry of a union member the query did not select', rollup([null])],
	] as const)('reports %s as no checks rather than as a failure', (_label, commits) => {
		expect(
			toCheckRows({ ...wireNode, state: 'OPEN', mergeable: 'MERGEABLE', reviewDecision: null, commits }),
		).toEqual([])
	})

	it.each([
		['MERGEABLE', true],
		['CONFLICTING', false],
		['UNKNOWN', null],
	] as const)('maps mergeable %s to %s', (mergeable, expected) => {
		const row = toPullRequestRow({
			repoFullName: 'humanlayer/syncopate',
			branch: 'feat/pr-status',
			wire: { ...wireNode, state: 'OPEN', reviewDecision: null, mergeable },
			repository: repositorySettings,
		})
		expect(row.mergeable).toBe(expected)
	})
})

describe('selectPanelPullRequest', () => {
	const REPO = 'humanlayer/syncopate'

	const wire = (
		number: number,
		state: 'OPEN' | 'CLOSED' | 'MERGED',
		headRepository: { nameWithOwner: string } | null = { nameWithOwner: 'HumanLayer/Syncopate' },
	): GitHubPullRequestWire => ({
		number,
		title: `PR ${number}`,
		url: `https://github.com/humanlayer/syncopate/pull/${number}`,
		state,
		isDraft: false,
		mergeable: 'MERGEABLE',
		reviewDecision: null,
		headRefName: 'feat/pr-status',
		baseRefName: 'main',
		headRepository,
		reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
		latestReviews: { nodes: [] },
		...mergeStateNode,
		commits: { totalCount: 0, nodes: [] },
	})

	const select = (nodes: ReadonlyArray<GitHubPullRequestWire | null>) =>
		selectPanelPullRequest({ nodes, repoFullName: REPO })

	it.effect('prefers the open pull request over a newer closed one', () =>
		Effect.sync(() => {
			expect(select([wire(200, 'CLOSED'), wire(100, 'OPEN')])?.number).toBe(100)
		}),
	)

	it.effect('falls back to the newest when none is open, so a merged branch still reports', () =>
		Effect.sync(() => {
			expect(select([wire(200, 'MERGED'), wire(100, 'CLOSED')])?.number).toBe(200)
		}),
	)

	it.effect('treats an empty page as the pre-PR state', () =>
		Effect.sync(() => {
			expect(select([])).toBeNull()
			expect(select([null])).toBeNull()
		}),
	)

	it.effect('ignores a fork whose branch happens to share the name', () =>
		Effect.sync(() => {
			const fork = wire(300, 'OPEN', { nameWithOwner: 'someone-else/syncopate' })
			expect(select([fork])).toBeNull()
			expect(select([fork, wire(100, 'CLOSED')])?.number).toBe(100)
		}),
	)

	it.effect('ignores a pull request whose head repository is gone', () =>
		Effect.sync(() => {
			expect(select([wire(400, 'OPEN', null)])).toBeNull()
		}),
	)
})
