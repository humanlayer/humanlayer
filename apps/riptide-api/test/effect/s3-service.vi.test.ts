import { describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import * as HttpClient from 'effect/http/HttpClient'
import type { HttpClientRequest } from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'
import { expect } from 'vitest'

import { S3PresigningAdapter } from '../../src/effects/services/s3/s3.client'
import { S3, S3LiveBase } from '../../src/effects/services/s3/s3.service'

describe('Effect S3 service', () => {
	it.effect('presigns and uploads bytes with the required content type', () => {
		const presignInputs: Array<{ key: string; contentType: string }> = []
		const requests: HttpClientRequest[] = []
		const presignerLayer = Layer.succeed(S3PresigningAdapter, {
			presignDownload: ({ key }) => Effect.succeed(`https://s3.test/download/${key}`),
			presignUpload: (input) =>
				Effect.sync(() => {
					presignInputs.push(input)
					return `https://s3.test/upload/${input.key}`
				}),
		})
		const httpLayer = Layer.succeed(
			HttpClient.HttpClient,
			HttpClient.make((request) =>
				Effect.sync(() => {
					requests.push(request)
					return HttpClientResponse.fromWeb(request, new Response(null, { status: 200 }))
				}),
			),
		)
		const serviceLayer = S3LiveBase.pipe(Layer.provide(Layer.merge(presignerLayer, httpLayer)))

		return Effect.gen(function* () {
			const s3 = yield* S3
			yield* s3.uploadArtifactBytes({
				key: 'organizations/org/tasks/task/image.png',
				contentType: 'image/png',
				bytes: new Uint8Array([1, 2, 3]),
			})

			expect(presignInputs).toEqual([{ key: 'organizations/org/tasks/task/image.png', contentType: 'image/png' }])
			expect(requests).toHaveLength(1)
			expect(requests[0]?.method).toBe('PUT')
			expect(requests[0]?.headers['content-type']).toBe('image/png')
		}).pipe(Effect.provide(serviceLayer))
	})
})
