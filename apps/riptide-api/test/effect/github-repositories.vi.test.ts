import { describe, it } from '@effect/vitest'
import { Effect, Layer, Redacted } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import type { HttpClientRequest } from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { expect } from 'vitest'

import { listAllInstallationRepositories } from '../../src/effects/services/github/github.installation'

describe('GitHub repository discovery', () => {
	it.effect('paginates until the provider total is reached while preserving order', () => {
		const requestedPages: number[] = []
		const transport = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make((request, url) =>
				Effect.sync(() => {
					const page = Number(url.searchParams.get('page'))
					requestedPages.push(page)
					const repositoryId = page === 1 ? '90071992547409931236' : '90071992547409931237'
					return rawJsonResponse(
						request,
						`{"total_count":2,"repositories":[{"id":${repositoryId},"name":"repository-${page}","full_name":"humanlayer/repository-${page}","private":false,"default_branch":"main","archived":false,"owner":{"login":"humanlayer"}}]}`,
					)
				}),
			),
		)

		return Effect.gen(function* () {
			const repositories = yield* listAllInstallationRepositories({
				apiBaseUrl: new URL('https://api.github.test'),
				installationToken: Redacted.make('installation-token'),
			})
			expect(requestedPages).toEqual([1, 2])
			expect(repositories.map((repository) => repository.id)).toEqual([
				'90071992547409931236',
				'90071992547409931237',
			])
		}).pipe(Effect.provide(transport))
	})
})

const rawJsonResponse = (request: HttpClientRequest, body: string) =>
	HttpClientResponse.fromWeb(
		request,
		new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
	)
