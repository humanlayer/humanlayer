import { Data, Effect, Stream } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { hash } from 'ohash'

import { Sentry } from '../../../instrument'
import { buildS3Key } from '../../../lib/s3-key-builder'
import {
	extractFilenameFromUrl,
	extractImageUrls,
	getContentType,
	getFileExtension,
} from '../../../lib/ticket-image-utils'
import { S3 } from '../s3/s3.service'
import type { GitHubIssuePreview } from './github.issue-import'
import type { GitHubPreparedImageArtifact } from './github.schema'

export const MAX_TICKET_IMAGE_BYTES = 50 * 1024 * 1024
export const TICKET_IMAGE_IMPORT_CONCURRENCY = 4

class GitHubImageDownloadError extends Data.TaggedError('GitHubImageDownloadError')<{
	readonly sourceUrl: string
	readonly reason: 'download_failed' | 'too_large'
	readonly cause?: unknown
}> {}

export interface GitHubImageImportOutcome {
	readonly sourceUrl: string
	readonly altText: string
	readonly artifact: GitHubPreparedImageArtifact | null
	readonly failureReason: 'download_failed' | 'too_large' | 'upload_failed' | null
}

export const discoverGitHubIssueImages = (
	issue: GitHubIssuePreview,
): ReadonlyArray<{ url: string; altText: string }> => {
	const seen = new Set<string>()
	return extractImageUrls([issue.body, ...issue.comments.map((comment) => comment.body)].join('\n')).filter(
		(image) => {
			if (seen.has(image.url)) return false
			seen.add(image.url)
			return true
		},
	)
}

const safeImageFileName = (url: string, issueNumber: number, index: number): string => {
	const baseName = extractFilenameFromUrl(url)
	const extension = getFileExtension(url)
	return `img-${issueNumber}-${baseName}${index === 0 ? '' : `-${index + 1}`}.${extension}`
}

const downloadImageBytes = (input: {
	readonly sourceUrl: string
	readonly installationToken: string
}): Effect.Effect<
	{ readonly bytes: Uint8Array; readonly contentType: string },
	GitHubImageDownloadError,
	HttpClient.HttpClient
> =>
	Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient
		const sourceUrl = new URL(input.sourceUrl)
		const request = HttpClientRequest.get(input.sourceUrl).pipe(HttpClientRequest.setHeader('accept', 'image/*'))
		const authenticatedRequest =
			sourceUrl.hostname === 'github.com' || sourceUrl.hostname === 'api.github.com'
				? request.pipe(HttpClientRequest.bearerToken(input.installationToken))
				: request
		const response = yield* client.execute(authenticatedRequest).pipe(
			Effect.flatMap(HttpClientResponse.filterStatusOk),
			Effect.mapError(
				(cause) =>
					new GitHubImageDownloadError({ sourceUrl: input.sourceUrl, reason: 'download_failed', cause }),
			),
		)
		const declaredLength = Number(response.headers['content-length'] ?? 0)
		if (Number.isFinite(declaredLength) && declaredLength > MAX_TICKET_IMAGE_BYTES) {
			return yield* Effect.fail(new GitHubImageDownloadError({ sourceUrl: input.sourceUrl, reason: 'too_large' }))
		}
		const chunks = yield* response.stream.pipe(
			Stream.mapError(
				(cause) =>
					new GitHubImageDownloadError({ sourceUrl: input.sourceUrl, reason: 'download_failed', cause }),
			),
			Stream.runFoldEffect(
				() => ({ chunks: [] as Array<Uint8Array>, byteLength: 0 }),
				(accumulator, chunk) => {
					const byteLength = accumulator.byteLength + chunk.byteLength
					return byteLength > MAX_TICKET_IMAGE_BYTES
						? Effect.fail(new GitHubImageDownloadError({ sourceUrl: input.sourceUrl, reason: 'too_large' }))
						: Effect.succeed({ chunks: [...accumulator.chunks, chunk], byteLength })
				},
			),
		)
		const bytes = new Uint8Array(chunks.byteLength)
		let offset = 0
		for (const chunk of chunks.chunks) {
			bytes.set(chunk, offset)
			offset += chunk.byteLength
		}
		return {
			bytes,
			contentType: response.headers['content-type'] ?? getContentType(getFileExtension(input.sourceUrl)),
		}
	}).pipe(Effect.withSpan('github.download_issue_image'))

export const prepareGitHubIssueImages = (input: {
	readonly issue: GitHubIssuePreview
	readonly taskId: string
	readonly organizationId: string
	readonly importAttemptId: string
	readonly installationToken: string
}): Effect.Effect<ReadonlyArray<GitHubImageImportOutcome>, never, HttpClient.HttpClient | S3> => {
	const images = discoverGitHubIssueImages(input.issue)
	return Effect.forEach(
		images,
		(image, index) =>
			Effect.gen(function* () {
				const s3 = yield* S3
				const downloaded = yield* downloadImageBytes({
					sourceUrl: image.url,
					installationToken: input.installationToken,
				})
				const fileName = safeImageFileName(image.url, input.issue.issueNumber, index)
				const s3Key = buildS3Key(
					input.organizationId,
					input.taskId,
					`provider-imports/${input.importAttemptId}/${fileName}`,
				)
				yield* s3.uploadArtifactBytes({
					key: s3Key,
					contentType: downloaded.contentType,
					bytes: downloaded.bytes,
				})
				return {
					sourceUrl: image.url,
					altText: image.altText,
					artifact: {
						fileName,
						contentType: downloaded.contentType,
						fileSizeBytes: downloaded.bytes.byteLength,
						contentHash: hash(downloaded.bytes),
						s3Key,
					},
					failureReason: null,
				} satisfies GitHubImageImportOutcome
			}).pipe(
				Effect.tapError((error) =>
					Effect.logWarning('GitHub issue image import degraded', error).pipe(
						Effect.annotateLogs({ source_url: image.url, task_id: input.taskId }),
						Effect.andThen(
							Effect.sync(() =>
								Sentry.captureException(error, {
									tags: { integration: 'github', operation: 'import_issue_image' },
									extra: { task_id: input.taskId, source_url: image.url },
								}),
							),
						),
					),
				),
				Effect.catchTags({
					GitHubImageDownloadError: (error) =>
						Effect.succeed({
							sourceUrl: image.url,
							altText: image.altText,
							artifact: null,
							failureReason: error.reason,
						} satisfies GitHubImageImportOutcome),
					S3UploadError: () =>
						Effect.succeed({
							sourceUrl: image.url,
							altText: image.altText,
							artifact: null,
							failureReason: 'upload_failed',
						} satisfies GitHubImageImportOutcome),
				}),
			),
		{ concurrency: TICKET_IMAGE_IMPORT_CONCURRENCY },
	).pipe(
		Effect.withSpan('github.prepare_issue_images', {
			attributes: { task_id: input.taskId, image_count: images.length },
		}),
	)
}
