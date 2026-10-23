import { describe, it } from '@effect/vitest'
import { Effect, Layer, Redacted } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import type { HttpClientRequest } from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { expect } from 'vitest'

import { parseGitHubIssueInput } from '../../src/effects/services/github/github.issue-input'
import { getIssue } from '../../src/effects/services/github/procedures/get-issue'
import { listIssueCommentsPage } from '../../src/effects/services/github/procedures/list-issue-comments'

describe('GitHub issue preview boundaries', () => {
	it.effect('parses issue numbers and canonical GitHub issue URLs', () =>
		Effect.gen(function* () {
			expect(yield* parseGitHubIssueInput('482')).toEqual({ issueNumber: 482, repositoryFullName: null })
			expect(yield* parseGitHubIssueInput('https://github.com/acme/web/issues/482')).toEqual({
				issueNumber: 482,
				repositoryFullName: 'acme/web',
			})
		}),
	)

	it.effect('rejects malformed, zero, query-string, and non-GitHub inputs', () =>
		Effect.gen(function* () {
			for (const input of [
				'',
				'0',
				'-1',
				'owner/repo#1',
				'http://github.com/acme/web/issues/1',
				'https://github.com/acme/web/issues/1?x=1',
			]) {
				const error = yield* Effect.flip(parseGitHubIssueInput(input))
				expect(error.reason).toBe('invalid_format')
			}
		}),
	)

	it.effect('decodes issue and comment responses while preserving large GitHub IDs', () => {
		const requestedPaths: string[] = []
		const transport = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make((request, url) =>
				Effect.sync(() => {
					requestedPaths.push(`${url.pathname}${url.search}`)
					if (url.pathname.endsWith('/comments')) {
						return rawJsonResponse(
							request,
							'[{' +
								'"id":90071992547409931236,' +
								'"html_url":"https://github.com/acme/web/issues/482#issuecomment-1",' +
								'"body":"A comment",' +
								'"user":{"login":"octocat"},' +
								'"created_at":"2026-07-17T00:00:00Z",' +
								'"updated_at":"2026-07-17T00:00:00Z"' +
								'}]',
						)
					}
					return rawJsonResponse(
						request,
						JSON.stringify({
							number: 482,
							title: 'Preview me',
							html_url: 'https://github.com/acme/web/issues/482',
							state: 'open',
							body: 'Issue body',
							labels: [{ name: 'integration' }],
							assignees: [{ login: 'octocat' }],
							user: { login: 'mona' },
							created_at: '2026-07-17T00:00:00Z',
							updated_at: '2026-07-17T00:00:00Z',
						}),
					)
				}),
			),
		)

		return Effect.gen(function* () {
			const commonInput = {
				apiBaseUrl: new URL('https://api.github.test'),
				installationToken: Redacted.make('installation-token'),
				repositoryFullName: 'acme/web',
				issueNumber: 482,
			}
			const issue = yield* getIssue(commonInput)
			const comments = yield* listIssueCommentsPage({ ...commonInput, page: 1 })

			expect(issue).toMatchObject({ number: 482, title: 'Preview me', labels: [{ name: 'integration' }] })
			expect(comments[0]?.id).toBe('90071992547409931236')
			expect(requestedPaths).toEqual([
				'/repos/acme/web/issues/482',
				'/repos/acme/web/issues/482/comments?page=1&per_page=100',
			])
		}).pipe(Effect.provide(transport))
	})
})

const rawJsonResponse = (request: HttpClientRequest, body: string) =>
	HttpClientResponse.fromWeb(
		request,
		new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
	)
