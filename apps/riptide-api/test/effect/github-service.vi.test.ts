import { describe, it } from '@effect/vitest'
import { Cause, ConfigProvider, Effect, Exit, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import { exportPKCS8, generateKeyPair } from 'jose'

import {
	GitHubPrivateKeyImportError,
	GitHubService,
	GitHubServiceLive,
} from '../../src/effects/services/github/github.service'

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

	it.effect('fails layer construction when required configuration is missing', ({ expect }) =>
		Effect.gen(function* () {
			const privateKey = yield* makePrivateKey()
			const exit = yield* Effect.exit(
				loadGitHubService({
					GITHUB_APP_ID: '123456',
					CLOUD_ORIGIN: 'https://cloud.example.test',
					GITHUB_APP_CLIENT_ID: 'Iv1.test-client-id',
					GITHUB_APP_PRIVATE_KEY: privateKey,
					GITHUB_APP_WEBHOOK_SECRET: 'test-webhook-secret',
				}),
			)

			expect(Exit.isFailure(exit)).toBe(true)
			if (Exit.isFailure(exit)) {
				expect(Cause.pretty(exit.cause)).toContain('GITHUB_APP_SLUG')
			}
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
