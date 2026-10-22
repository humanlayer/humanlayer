import { describe, it } from '@effect/vitest'
import { Effect, Layer, Redacted } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import type { HttpClientRequest } from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { expect } from 'vitest'

import { checkGitHubCapability } from '../../src/effects/services/github/github.permissions'
import type { GitHubInstallationPermissions } from '../../src/effects/services/github/github.schema'
import {
	mutatePullRequestOnGitHub,
	toMutationRequest,
} from '../../src/effects/services/github/procedures/mutate-pull-request'
import { PULL_REQUEST_PANEL_CAPABILITIES } from '../../src/effects/services/github/pull-requests/github-api'
import { PULL_REQUEST_WRITE_CAPABILITIES } from '../../src/effects/services/github/pull-requests/mutation'

const NODE_ID = 'PR_kwDOQB5GJc8AAAABCU4B6w'
const HEAD_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

const jsonResponse = (request: HttpClientRequest, body: unknown) =>
	HttpClientResponse.fromWeb(
		request,
		new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
	)

/** Answers the node-id lookup, then the mutation with whatever the test wants GitHub to say. */
const transport = (mutationResponse: unknown, requests: { query: string; variables: Record<string, unknown> }[]) =>
	Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request) =>
			Effect.gen(function* () {
				const text = yield* Effect.promise(async () =>
					request.body._tag === 'Uint8Array' ? new TextDecoder().decode(request.body.body) : '',
				)
				const body = JSON.parse(text) as { query: string; variables: Record<string, unknown> }
				requests.push(body)
				if (body.query.includes('RiptidePullRequestNodeId')) {
					return jsonResponse(request, { data: { repository: { pullRequest: { id: NODE_ID } } } })
				}
				return jsonResponse(request, mutationResponse)
			}),
		),
	)

const input = {
	apiBaseUrl: new URL('https://api.github.test'),
	installationToken: Redacted.make('installation-token'),
	repoFullName: 'humanlayer/syncopate',
	number: 2489,
}

describe('mutatePullRequestOnGitHub', () => {
	it.effect('looks the node id up, then sends the mutation for the action with its input', () => {
		const requests: { query: string; variables: Record<string, unknown> }[] = []
		return Effect.gen(function* () {
			yield* mutatePullRequestOnGitHub({
				...input,
				mutation: {
					type: 'merge',
					method: 'SQUASH',
					expectedHeadSha: HEAD_SHA,
					commitHeadline: 'Add the tray (#2489)',
					commitBody: '* one',
				},
			})
			expect(requests).toHaveLength(2)
			expect(requests[0]?.variables).toEqual({ owner: 'humanlayer', repo: 'syncopate', number: 2489 })
			expect(requests[1]?.query).toContain('mergePullRequest(input: $input)')
			expect(requests[1]?.variables).toEqual({
				input: {
					pullRequestId: NODE_ID,
					mergeMethod: 'SQUASH',
					expectedHeadOid: HEAD_SHA,
					commitHeadline: 'Add the tray (#2489)',
					commitBody: '* one',
				},
			})
		}).pipe(Effect.provide(transport({ data: { mergePullRequest: { pullRequest: { number: 2489 } } } }, requests)))
	})

	it.effect('surfaces GitHub’s sentence when the mutation is declined on a 200', () => {
		const requests: { query: string; variables: Record<string, unknown> }[] = []
		return Effect.gen(function* () {
			const error = yield* Effect.flip(
				mutatePullRequestOnGitHub({
					...input,
					mutation: { type: 'merge', method: 'MERGE', expectedHeadSha: HEAD_SHA },
				}),
			)
			expect(error).toMatchObject({
				_tag: 'GitHubPullRequestMutationRejectedError',
				mutation: 'merge',
				message: 'Head branch was modified. Review and try the merge again.',
			})
		}).pipe(
			Effect.provide(
				transport(
					{ data: null, errors: [{ message: 'Head branch was modified. Review and try the merge again.' }] },
					requests,
				),
			),
		)
	})

	it.effect('reports a pull request GitHub does not have as not found, before any mutation', () => {
		const requests: { query: string; variables: Record<string, unknown> }[] = []
		const missing = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make((request) =>
				Effect.sync(() => {
					requests.push({ query: '', variables: {} })
					return jsonResponse(request, { data: { repository: { pullRequest: null } } })
				}),
			),
		)
		return Effect.gen(function* () {
			const error = yield* Effect.flip(mutatePullRequestOnGitHub({ ...input, mutation: { type: 'close' } }))
			expect(error).toMatchObject({ _tag: 'GitHubPullRequestNotFoundError', number: 2489 })
			expect(requests).toHaveLength(1)
		}).pipe(Effect.provide(missing))
	})
})

describe('toMutationRequest', () => {
	it('sends the head guard and the message only where GitHub takes them', () => {
		expect(
			toMutationRequest(NODE_ID, { type: 'merge', method: 'REBASE', expectedHeadSha: HEAD_SHA }).input,
		).toEqual({ pullRequestId: NODE_ID, mergeMethod: 'REBASE', expectedHeadOid: HEAD_SHA })
		expect(
			toMutationRequest(NODE_ID, { type: 'enable_auto_merge', method: 'SQUASH', commitHeadline: 'T' }).input,
		).toEqual({ pullRequestId: NODE_ID, mergeMethod: 'SQUASH', commitHeadline: 'T' })
		expect(toMutationRequest(NODE_ID, { type: 'update_branch', expectedHeadSha: HEAD_SHA }).input).toEqual({
			pullRequestId: NODE_ID,
			updateMethod: 'MERGE',
			expectedHeadOid: HEAD_SHA,
		})
		expect(toMutationRequest(NODE_ID, { type: 'ready_for_review' }).input).toEqual({ pullRequestId: NODE_ID })
	})

	it('drops an empty headline so GitHub keeps its own default', () => {
		expect(
			toMutationRequest(NODE_ID, {
				type: 'merge',
				method: 'MERGE',
				expectedHeadSha: HEAD_SHA,
				commitHeadline: '',
			}).input,
		).toEqual({ pullRequestId: NODE_ID, mergeMethod: 'MERGE', expectedHeadOid: HEAD_SHA })
	})

	it('asks GitHub for the field that action writes', () => {
		expect(toMutationRequest(NODE_ID, { type: 'convert_to_draft' }).query).toContain(
			'convertPullRequestToDraft(input: $input)',
		)
		expect(toMutationRequest(NODE_ID, { type: 'reopen' }).query).toContain('reopenPullRequest(input: $input)')
	})
})

describe('the grant each write requires', () => {
	const READ_ONLY: GitHubInstallationPermissions = {
		metadata: 'read',
		pull_requests: 'read',
		contents: 'read',
		checks: 'read',
		statuses: 'read',
	}
	const FULL: GitHubInstallationPermissions = {
		metadata: 'read',
		pull_requests: 'write',
		contents: 'write',
		checks: 'read',
		statuses: 'read',
	}

	const missingFor = (permissions: GitHubInstallationPermissions) =>
		PULL_REQUEST_WRITE_CAPABILITIES.map((capability) => checkGitHubCapability(permissions, capability)).filter(
			(detail) => detail !== null,
		)

	it('refuses a write on a read-only installation, naming the grant it wants', () => {
		expect(missingFor(READ_ONLY)[0]).toMatchObject({
			requiredPermission: 'pull_requests',
			requiredLevel: 'write',
			grantedLevel: 'read',
		})
	})

	it('allows a write on an installation granted all of it', () => {
		expect(missingFor(FULL)).toEqual([])
	})

	it('asks for what the panel query reads, because every write is confirmed with it', () => {
		for (const capability of PULL_REQUEST_PANEL_CAPABILITIES) {
			expect(PULL_REQUEST_WRITE_CAPABILITIES).toContain(capability)
		}
	})
})
