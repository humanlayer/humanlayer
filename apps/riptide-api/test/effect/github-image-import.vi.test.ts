import { describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import type { HttpClientRequest } from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { expect } from 'vitest'

import {
	discoverGitHubIssueImages,
	MAX_TICKET_IMAGE_BYTES,
	prepareGitHubIssueImages,
} from '../../src/effects/services/github/github.images'
import { S3 } from '../../src/effects/services/s3/s3.service'

const issue = {
	repository: {
		id: '101',
		ownerLogin: 'acme',
		name: 'web',
		fullName: 'acme/web',
		private: true,
		defaultBranch: 'main',
		archived: false,
	},
	issueNumber: 482,
	title: 'Images',
	url: 'https://github.com/acme/web/issues/482',
	state: 'open' as const,
	body: '![first](https://github.com/user-attachments/assets/same)\n![duplicate](https://github.com/user-attachments/assets/same)',
	labels: [],
	assignees: [],
	authorLogin: 'mona',
	createdAt: '2026-07-17T00:00:00Z',
	updatedAt: '2026-07-17T00:00:00Z',
	comments: [
		{
			id: '1',
			url: 'https://github.com/acme/web/issues/482#issuecomment-1',
			body: '![comment](https://example.test/comment.png)',
			authorLogin: 'octocat',
			createdAt: '2026-07-17T00:00:00Z',
			updatedAt: '2026-07-17T00:00:00Z',
		},
	],
}

describe('GitHub issue image import', () => {
	it.effect('discovers body and comment images once in stable order', () =>
		Effect.sync(() => {
			expect(discoverGitHubIssueImages(issue)).toEqual([
				{ url: 'https://github.com/user-attachments/assets/same', altText: 'first' },
				{ url: 'https://example.test/comment.png', altText: 'comment' },
			])
		}),
	)

	it.effect('uploads downloaded bytes and returns persistence-ready sibling artifacts', () => {
		const uploads: Array<{ key: string; contentType: string; bytes: Uint8Array }> = []
		const requests: HttpClientRequest[] = []
		const httpLayer = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make((request) =>
				Effect.sync(() => {
					requests.push(request)
					return binaryResponse(request, new Uint8Array([1, 2, 3]), {
						'content-type': 'image/png',
						'content-length': '3',
					})
				}),
			),
		)
		const s3Layer = Layer.succeed(S3, {
			getPresignedDownloadUrl: () => Effect.die('unused'),
			getPresignedUploadUrl: () => Effect.die('unused'),
			presignDownload: () => Effect.die('unused'),
			presignUpload: () => Effect.die('unused'),
			uploadArtifactBytes: (input) => Effect.sync(() => uploads.push(input)),
		})

		return Effect.gen(function* () {
			const outcomes = yield* prepareGitHubIssueImages({
				issue,
				taskId: 'task-1',
				organizationId: 'org-1',
				importAttemptId: 'attempt-1',
				installationToken: 'secret-token',
			})
			expect(outcomes).toHaveLength(2)
			expect(outcomes.every((outcome) => outcome.artifact !== null)).toBe(true)
			expect(uploads).toHaveLength(2)
			expect(outcomes[0]?.artifact?.fileName).toBe('img-482-same.png')
			expect(outcomes[0]?.artifact?.s3Key).toBe('org-1/task-1/provider-imports/attempt-1/img-482-same.png')
			expect(requests[0]?.headers.authorization).toBe('Bearer secret-token')
			expect(requests[1]?.headers.authorization).toBeUndefined()
		}).pipe(Effect.provide(Layer.merge(httpLayer, s3Layer)))
	})

	it.effect('degrades declared oversized images without uploading them', () => {
		let uploadCount = 0
		const httpLayer = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make((request) =>
				Effect.succeed(
					binaryResponse(request, new Uint8Array([1]), {
						'content-type': 'image/png',
						'content-length': String(MAX_TICKET_IMAGE_BYTES + 1),
					}),
				),
			),
		)
		const s3Layer = Layer.succeed(S3, {
			getPresignedDownloadUrl: () => Effect.die('unused'),
			getPresignedUploadUrl: () => Effect.die('unused'),
			presignDownload: () => Effect.die('unused'),
			presignUpload: () => Effect.die('unused'),
			uploadArtifactBytes: () => Effect.sync(() => uploadCount++),
		})

		return Effect.gen(function* () {
			const outcomes = yield* prepareGitHubIssueImages({
				issue: { ...issue, comments: [] },
				taskId: 'task-1',
				organizationId: 'org-1',
				importAttemptId: 'attempt-1',
				installationToken: 'secret-token',
			})
			expect(outcomes[0]).toMatchObject({ artifact: null, failureReason: 'too_large' })
			expect(uploadCount).toBe(0)
		}).pipe(Effect.provide(Layer.merge(httpLayer, s3Layer)))
	})
})

const binaryResponse = (request: HttpClientRequest, body: Uint8Array, headers: Record<string, string>) =>
	HttpClientResponse.fromWeb(request, new Response(body, { status: 200, headers }))
