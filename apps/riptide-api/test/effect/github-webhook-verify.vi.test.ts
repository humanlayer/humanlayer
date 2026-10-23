import { describe, it } from '@effect/vitest'
import { ConfigProvider, Effect, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import { exportPKCS8, generateKeyPair } from 'jose'
import { beforeAll, expect } from 'vitest'

import { GitHubService, GitHubServiceLive } from '../../src/effects/services/github/github.service'
import { computeGitHubSignature } from '../../src/effects/services/github/github.webhooks'

const WEBHOOK_SECRET = 'test-webhook-secret'

describe('GitHub webhook verification', () => {
	let privateKey: string

	beforeAll(async () => {
		const generatedKeyPair = await generateKeyPair('RS256', { extractable: true })
		privateKey = await exportPKCS8(generatedKeyPair.privateKey)
	})

	const makeLayer = () => {
		const configuration = ConfigProvider.layer(
			ConfigProvider.fromUnknown({
				GITHUB_APP_ID: '123',
				CLOUD_ORIGIN: 'https://cloud.example.test',
				GITHUB_APP_CLIENT_ID: 'Iv1.webhook-test',
				GITHUB_APP_SLUG: 'humanlayer-test',
				GITHUB_APP_PRIVATE_KEY: privateKey,
				GITHUB_APP_WEBHOOK_SECRET: WEBHOOK_SECRET,
				GITHUB_API_BASE_URL: 'https://api.github.test',
			}),
		)
		// Verification and envelope parsing must never contact GitHub.
		const transport = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make(() => Effect.die('verifyWebhook must not make an HTTP request')),
		)
		const dependencies = Layer.mergeAll(configuration, transport)
		return GitHubServiceLive.pipe(Layer.provide(dependencies))
	}

	const signedHeaders = (rawBody: string, event: string, deliveryId = 'delivery-1') =>
		new Headers({
			'X-Hub-Signature-256': computeGitHubSignature({ webhookSecret: WEBHOOK_SECRET, rawBody }),
			'X-GitHub-Event': event,
			'X-GitHub-Delivery': deliveryId,
		})

	// Build the raw body as a string so the large installation ID keeps its exact lexeme; a JS
	// number literal above Number.MAX_SAFE_INTEGER would round before the signature is computed.
	const INSTALLATION_ID = '90071992547409931234'
	const installationBody = (action: string, extraInstallationJson = '') =>
		`{"action":"${action}","installation":{"id":${INSTALLATION_ID},"account":{"id":1,"login":"acme","type":"Organization"}${extraInstallationJson}},"sender":{"id":2,"login":"octocat","type":"User"}}`

	it('matches GitHub’s published HMAC test vector', () => {
		expect(computeGitHubSignature({ webhookSecret: "It's a Secret to Everybody", rawBody: 'Hello, World!' })).toBe(
			'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17',
		)
	})

	it.effect('verifies a correctly signed installation.created event into a reconcile event', () =>
		Effect.gen(function* () {
			const github = yield* GitHubService
			const rawBody = installationBody('created')
			const event = yield* github.verifyWebhook({ rawBody, headers: signedHeaders(rawBody, 'installation') })
			expect(event).toEqual({
				type: 'reconcile',
				installationId: '90071992547409931234',
				reason: 'created',
				deliveryId: 'delivery-1',
			})
		}).pipe(Effect.provide(makeLayer())),
	)

	const reviewBody = (headRepo = 'HumanLayer/Syncopate') =>
		`{"action":"submitted","installation":{"id":${INSTALLATION_ID}},"repository":{"full_name":"HumanLayer/Syncopate"},` +
		`"review":{"state":"approved"},"pull_request":{"number":2261,"head":{"ref":"feat/pr-status","repo":{"full_name":"${headRepo}"}}}}`

	// A pull request number above MAX_SAFE_INTEGER does not exist, but the installation id does, so
	// the body is a raw string like the others.
	const headRepoJson = (headRepo: string | null | undefined) =>
		headRepo === null ? 'null' : `{"full_name":"${headRepo ?? 'HumanLayer/Syncopate'}"}`
	const pullRequestBody = (
		overrides: { state?: string; merged?: boolean; mergeable?: string; headRepo?: string | null } = {},
	) =>
		`{"action":"opened","installation":{"id":${INSTALLATION_ID}},` +
		`"repository":{"full_name":"HumanLayer/Syncopate"},` +
		`"pull_request":{"number":2261,"title":"Show status","html_url":"https://github.com/humanlayer/syncopate/pull/2261",` +
		`"state":"${overrides.state ?? 'open'}","draft":true,"merged":${overrides.merged ?? false},"mergeable":${overrides.mergeable ?? 'null'},` +
		`"head":{"ref":"feat/pr-status","sha":"a1b2c3d4","repo":${headRepoJson(overrides.headRepo)}},"base":{"ref":"main"},` +
		`"user":{"login":"octocat","id":583231,"type":"User"},` +
		`"created_at":"2026-08-30T09:00:00Z","merged_at":null,"closed_at":null,"merged_by":null}}`

	it.effect('parses a pull_request delivery into the row the panel renders, with the author and times', () =>
		Effect.gen(function* () {
			const github = yield* GitHubService
			const rawBody = pullRequestBody()
			const event = yield* github.verifyWebhook({ rawBody, headers: signedHeaders(rawBody, 'pull_request') })
			expect(event).toEqual({
				type: 'pr_changed',
				installationId: INSTALLATION_ID,
				repoFullName: 'humanlayer/syncopate',
				branch: 'feat/pr-status',
				action: 'opened',
				pullRequest: {
					id: 'humanlayer/syncopate:feat/pr-status',
					number: 2261,
					title: 'Show status',
					url: 'https://github.com/humanlayer/syncopate/pull/2261',
					state: 'open',
					isDraft: true,
					headRef: 'feat/pr-status',
					baseRef: 'main',
					headSha: 'a1b2c3d4',
					mergeable: null,
					reviewDecision: null,
					unresolvedThreadCount: null,
					resolvedThreadCount: null,
					changesRequestedReviews: null,
					merge: null,
				},
				author: { login: 'octocat', id: '583231', isBot: false },
				timestamps: {
					openedAt: Date.parse('2026-08-30T09:00:00Z'),
					mergedAt: null,
					closedAt: null,
					mergedByLogin: null,
				},
				deliveryId: 'delivery-1',
			})
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('reads a merged pull request as merged, not closed', () =>
		Effect.gen(function* () {
			const github = yield* GitHubService
			const rawBody = pullRequestBody({ state: 'closed', merged: true, mergeable: 'true' })
			const event = yield* github.verifyWebhook({ rawBody, headers: signedHeaders(rawBody, 'pull_request') })
			expect(event.type).toBe('pr_changed')
			if (event.type !== 'pr_changed') return
			expect(event.pullRequest.state).toBe('merged')
			expect(event.pullRequest.mergeable).toBe(true)
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('parses a pull_request_review delivery into a refetch of its branch', () =>
		Effect.gen(function* () {
			const github = yield* GitHubService
			const rawBody = reviewBody()
			const event = yield* github.verifyWebhook({
				rawBody,
				headers: signedHeaders(rawBody, 'pull_request_review'),
			})
			expect(event).toEqual({
				type: 'pr_reviewed',
				installationId: INSTALLATION_ID,
				repoFullName: 'humanlayer/syncopate',
				branch: 'feat/pr-status',
				deliveryId: 'delivery-1',
			})
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('ignores a pull request and a review whose head is a fork branch of the same name', () =>
		Effect.gen(function* () {
			const github = yield* GitHubService
			const forkBody = pullRequestBody({ headRepo: 'someone-else/syncopate' })
			const goneBody = pullRequestBody({ headRepo: null })
			const forkReview = reviewBody('someone-else/syncopate')
			const deliveries = [
				yield* github.verifyWebhook({ rawBody: forkBody, headers: signedHeaders(forkBody, 'pull_request') }),
				yield* github.verifyWebhook({ rawBody: goneBody, headers: signedHeaders(goneBody, 'pull_request') }),
				yield* github.verifyWebhook({
					rawBody: forkReview,
					headers: signedHeaders(forkReview, 'pull_request_review'),
				}),
			]
			expect(deliveries.map((event) => event.type)).toEqual(['ignored', 'ignored', 'ignored'])
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('classifies an authentic pull_request body with no pull request as a client error', () =>
		Effect.gen(function* () {
			const github = yield* GitHubService
			const rawBody = `{"action":"opened","installation":{"id":${INSTALLATION_ID}},"repository":{"full_name":"a/b"}}`
			const result = yield* Effect.result(
				github.verifyWebhook({ rawBody, headers: signedHeaders(rawBody, 'pull_request') }),
			)
			expect(result._tag).toBe('Failure')
			if (result._tag === 'Failure') expect(result.failure._tag).toBe('GitHubWebhookMalformedRequestError')
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('rejects a tampered body (exact-body regression) with a signature error', () =>
		Effect.gen(function* () {
			const github = yield* GitHubService
			const rawBody = installationBody('created')
			const headers = signedHeaders(rawBody, 'installation')
			// Re-serialize with an extra space: same semantic JSON, different exact bytes.
			const tamperedBody = `${rawBody} `
			const result = yield* github.verifyWebhook({ rawBody: tamperedBody, headers }).pipe(
				Effect.map(() => 'accepted' as const),
				Effect.catchTag('GitHubWebhookSignatureInvalidError', () => Effect.succeed('rejected' as const)),
			)
			expect(result).toBe('rejected')
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('rejects a missing signature header without contacting GitHub', () =>
		Effect.gen(function* () {
			const github = yield* GitHubService
			const rawBody = installationBody('created')
			const headers = new Headers({ 'X-GitHub-Event': 'installation', 'X-GitHub-Delivery': 'd' })
			const result = yield* github.verifyWebhook({ rawBody, headers }).pipe(
				Effect.map(() => 'accepted' as const),
				Effect.catchTag('GitHubWebhookSignatureInvalidError', (error) => Effect.succeed(error.reason)),
			)
			expect(result).toBe('missing_signature_header')
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('classifies an authentic but malformed installation body as a client error', () =>
		Effect.gen(function* () {
			const github = yield* GitHubService
			const rawBody = JSON.stringify({ action: 'created', installation: { account: {} } })
			const result = yield* github
				.verifyWebhook({ rawBody, headers: signedHeaders(rawBody, 'installation') })
				.pipe(
					Effect.map(() => 'accepted' as const),
					Effect.catchTag('GitHubWebhookMalformedRequestError', () => Effect.succeed('malformed' as const)),
				)
			expect(result).toBe('malformed')
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('safely ignores a valid-signature delivery for an unsupported event type', () =>
		Effect.gen(function* () {
			const github = yield* GitHubService
			const rawBody = JSON.stringify({ action: 'opened', issue: { number: 1 } })
			const event = yield* github.verifyWebhook({ rawBody, headers: signedHeaders(rawBody, 'issues') })
			expect(event).toEqual({ type: 'ignored', event: 'issues', action: null, deliveryId: 'delivery-1' })
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('parses installation_repositories deliveries into a reconcile event', () =>
		Effect.gen(function* () {
			const github = yield* GitHubService
			const rawBody = installationBody('added')
			const event = yield* github.verifyWebhook({
				rawBody,
				headers: signedHeaders(rawBody, 'installation_repositories'),
			})
			expect(event).toEqual({
				type: 'reconcile',
				installationId: '90071992547409931234',
				reason: 'repositories_changed',
				deliveryId: 'delivery-1',
			})
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('parses a suspend event with its actor and timestamp from the authenticated payload', () =>
		Effect.gen(function* () {
			const github = yield* GitHubService
			const rawBody = installationBody(
				'suspend',
				',"suspended_at":"2026-07-16T00:00:00Z","suspended_by":{"id":55,"login":"suspender","type":"User"}',
			)
			const event = yield* github.verifyWebhook({ rawBody, headers: signedHeaders(rawBody, 'installation') })
			expect(event).toEqual({
				type: 'suspend',
				installationId: '90071992547409931234',
				suspendedAt: Date.parse('2026-07-16T00:00:00Z'),
				suspendedById: '55',
				suspendedByLogin: 'suspender',
				deliveryId: 'delivery-1',
			})
		}).pipe(Effect.provide(makeLayer())),
	)

	it.effect('parses a deleted event into a terminal delete event', () =>
		Effect.gen(function* () {
			const github = yield* GitHubService
			const rawBody = installationBody('deleted')
			const event = yield* github.verifyWebhook({ rawBody, headers: signedHeaders(rawBody, 'installation') })
			expect(event).toEqual({
				type: 'delete',
				installationId: '90071992547409931234',
				deliveryId: 'delivery-1',
			})
		}).pipe(Effect.provide(makeLayer())),
	)
})
