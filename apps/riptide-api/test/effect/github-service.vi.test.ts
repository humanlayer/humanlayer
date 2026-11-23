import { describe, it } from '@effect/vitest'
import { Cause, ConfigProvider, Effect, Exit, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import { exportPKCS8, generateKeyPair } from 'jose'

import { db } from '../../src/db/db'
import {
	GitHubPrivateKeyImportError,
	GitHubService,
	GitHubServiceLive,
} from '../../src/effects/services/github/github.service'
import { PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { S3 } from '../../src/effects/services/s3/s3.service'
import { makeCapturedEffectLogs } from '../utils/captured-effect-logs'

const fakeHttpClientLayer = Layer.succeed(
	HttpClient.HttpClient,
	HttpClient.make(() => Effect.die('GitHub configuration loading must not make an HTTP request')),
)

const makePrivateKey = () =>
	Effect.promise(async () => {
		const { privateKey } = await generateKeyPair('RS256', { extractable: true })
		return exportPKCS8(privateKey)
	})

const makeLayer = (configuration: Record<string, unknown>) =>
	GitHubServiceLive.pipe(
		Layer.provide(
			Layer.mergeAll(ConfigProvider.layer(ConfigProvider.fromUnknown(configuration)), fakeHttpClientLayer),
		),
	)

/** What stand-in methods declare in R. Each one dies if used: a stand-in never touches them. */
const standInDependencies = Layer.mergeAll(PostgresDbLive(db), fakeHttpClientLayer, Layer.mock(S3, {}))

const loadGitHubService = (configuration: Record<string, unknown>) =>
	GitHubService.pipe(Effect.asVoid, Effect.provide(makeLayer(configuration)))

describe('GitHubService configuration', () => {
	it.effect('loads required configuration and defaults the GitHub API origin', () =>
		Effect.gen(function* () {
			const privateKey = yield* makePrivateKey()

			yield* loadGitHubService({
				GITHUB_APP_ID: '123456',
				CLOUD_ORIGIN: 'https://cloud.example.test',
				GITHUB_APP_CLIENT_ID: 'Iv1.test-client-id',
				GITHUB_APP_SLUG: 'codelayer-integration-dev',
				GITHUB_APP_PRIVATE_KEY: privateKey,
				GITHUB_APP_WEBHOOK_SECRET: 'test-webhook-secret',
			})
		}),
	)

	it.effect('loads the real service as configured when every GitHub key is set', ({ expect }) =>
		Effect.gen(function* () {
			const privateKey = yield* makePrivateKey()
			const github = yield* GitHubService.pipe(
				Effect.provide(
					makeLayer({
						GITHUB_APP_ID: '123456',
						CLOUD_ORIGIN: 'https://cloud.example.test',
						GITHUB_APP_CLIENT_ID: 'Iv1.test-client-id',
						GITHUB_APP_SLUG: 'codelayer-integration-dev',
						GITHUB_APP_PRIVATE_KEY: privateKey,
						GITHUB_APP_WEBHOOK_SECRET: 'test-webhook-secret',
					}),
				),
			)
			expect(github.configured).toBe(true)
		}),
	)

	it.effect('starts the stand-in and warns naming the missing key when some GitHub keys are set', ({ expect }) =>
		Effect.gen(function* () {
			const privateKey = yield* makePrivateKey()
			const captured = makeCapturedEffectLogs()
			const github = yield* GitHubService.pipe(
				Effect.provide(
					makeLayer({
						GITHUB_APP_ID: '123456',
						CLOUD_ORIGIN: 'https://cloud.example.test',
						GITHUB_APP_CLIENT_ID: 'Iv1.test-client-id',
						GITHUB_APP_PRIVATE_KEY: privateKey,
						GITHUB_APP_WEBHOOK_SECRET: 'test-webhook-secret',
					}),
				),
				Effect.provide(captured.layer),
			)

			expect(github.configured).toBe(false)
			expect(captured.logs).toContainEqual({
				level: 'Warn',
				message: 'GitHub is not set up: missing GITHUB_APP_SLUG',
			})
			const failure = yield* github
				.createInstallUrl({ organizationId: 'org-1', requestedByUserId: 'user-1' })
				.pipe(Effect.flip, Effect.provide(standInDependencies))
			expect(failure).toMatchObject({ _tag: 'GitHubIntegrationNotConfiguredError' })
		}),
	)

	it.effect('starts the stand-in without CLOUD_ORIGIN or any GitHub key', ({ expect }) =>
		Effect.gen(function* () {
			const captured = makeCapturedEffectLogs()
			const github = yield* GitHubService.pipe(Effect.provide(makeLayer({})), Effect.provide(captured.layer))

			expect(github.configured).toBe(false)
			expect(captured.logs).toContainEqual({
				level: 'Info',
				message: 'GitHub is not set up: no GITHUB_APP_* keys are set',
			})
			expect(
				yield* github.listConnections({ organizationId: 'org-1' }).pipe(Effect.provide(standInDependencies)),
			).toEqual({
				enabled: false,
				connections: [],
			})
			const issueImportFailure = yield* github
				.prepareIssueImport({
					organizationId: 'org-1',
					taskId: 'task-1',
					importAttemptId: 'attempt-1',
					connectionId: 'connection-1',
					repositoryId: 'repository-1',
					issueInput: '42',
				})
				.pipe(Effect.flip, Effect.provide(standInDependencies))
			expect(issueImportFailure).toMatchObject({ _tag: 'GitHubIntegrationNotConfiguredError' })
		}),
	)

	it.effect('rejects malformed PKCS8 without exposing secret configuration', ({ expect }) =>
		Effect.gen(function* () {
			const malformedPrivateKey = 'private-key-plaintext-must-not-leak'
			const webhookSecret = 'webhook-secret-plaintext-must-not-leak'
			const exit = yield* Effect.exit(
				loadGitHubService({
					GITHUB_APP_ID: '123456',
					CLOUD_ORIGIN: 'https://cloud.example.test',
					GITHUB_APP_CLIENT_ID: 'Iv1.test-client-id',
					GITHUB_APP_SLUG: 'codelayer-integration-dev',
					GITHUB_API_BASE_URL: 'https://github.example.test/api/v3',
					GITHUB_APP_PRIVATE_KEY: malformedPrivateKey,
					GITHUB_APP_WEBHOOK_SECRET: webhookSecret,
				}),
			)

			expect(Exit.isFailure(exit)).toBe(true)
			if (Exit.isFailure(exit)) {
				const renderedFailure = Cause.pretty(exit.cause)
				expect(renderedFailure).toContain(GitHubPrivateKeyImportError.name)
				expect(renderedFailure).not.toContain(malformedPrivateKey)
				expect(renderedFailure).not.toContain(webhookSecret)
				expect(JSON.stringify(exit)).not.toContain(malformedPrivateKey)
				expect(JSON.stringify(exit)).not.toContain(webhookSecret)
			}
		}),
	)

	it.effect('refuses to start without CLOUD_ORIGIN instead of defaulting to localhost', ({ expect }) =>
		Effect.gen(function* () {
			const privateKey = yield* makePrivateKey()
			const exit = yield* Effect.exit(
				loadGitHubService({
					GITHUB_APP_ID: '123456',
					GITHUB_APP_CLIENT_ID: 'Iv1.test-client-id',
					GITHUB_APP_SLUG: 'codelayer-integration-dev',
					GITHUB_APP_PRIVATE_KEY: privateKey,
					GITHUB_APP_WEBHOOK_SECRET: 'test-webhook-secret',
				}),
			)

			expect(Exit.isFailure(exit)).toBe(true)
			if (Exit.isFailure(exit)) {
				const renderedFailure = Cause.pretty(exit.cause)
				expect(renderedFailure).toContain('CLOUD_ORIGIN')
				expect(renderedFailure).not.toContain('localhost')
			}
		}),
	)
})
