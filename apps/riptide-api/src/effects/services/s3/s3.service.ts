import { Config, Context, Effect, Layer, Option } from 'effect'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpClientRequest from 'effect/http/HttpClientRequest'
import * as HttpClientResponse from 'effect/http/HttpClientResponse'

import { Sentry } from '../../../instrument'
import { S3Service as LegacyS3Service } from '../../../lib/s3-service'
import { makeLegacyS3PresigningAdapter, S3PresigningAdapter } from './s3.client'
import { S3UploadError } from './s3.errors'
import type { PresignedDownloadInput, PresignedUploadInput, UploadArtifactBytesInput } from './s3.schema'

type S3Credentials = { accessKeyId: string; secretAccessKey: string }
type Mutable<T> = { -readonly [Key in keyof T]: T[Key] }

export class S3 extends Context.Service<
	S3,
	{
		readonly getPresignedDownloadUrl: (key: string, expiresInMinutes?: number) => Effect.Effect<string, Error>
		readonly getPresignedUploadUrl: (
			key: string,
			contentType: string,
			expiresInMinutes?: number,
		) => Effect.Effect<string, Error>
		readonly presignDownload: (input: PresignedDownloadInput) => Effect.Effect<string, Error>
		readonly presignUpload: (input: PresignedUploadInput) => Effect.Effect<string, Error>
		readonly uploadArtifactBytes: (input: UploadArtifactBytesInput) => Effect.Effect<void, S3UploadError>
	}
>()('S3Service') {}

export const S3LiveBase = Layer.effect(
	S3,
	Effect.gen(function* () {
		const presigner = yield* S3PresigningAdapter
		const httpClient = yield* HttpClient.HttpClient
		const capture = (error: unknown, operation: string) =>
			Effect.logError(`S3 ${operation} failed`, error).pipe(
				Effect.andThen(
					Effect.sync(() => Sentry.captureException(error, { tags: { service: 's3', operation } })),
				),
			)

		return {
			getPresignedDownloadUrl: (key: string, expiresInMinutes?: number) => {
				const input: Mutable<PresignedDownloadInput> = { key }
				if (expiresInMinutes !== undefined) input.expiresInMinutes = expiresInMinutes
				return presigner
					.presignDownload(input)
					.pipe(Effect.mapError((error) => new Error('Unable to create download URL', { cause: error })))
			},
			getPresignedUploadUrl: (key: string, contentType: string, expiresInMinutes?: number) => {
				const input: Mutable<PresignedUploadInput> = { key, contentType }
				if (expiresInMinutes !== undefined) input.expiresInMinutes = expiresInMinutes
				return presigner
					.presignUpload(input)
					.pipe(Effect.mapError((error) => new Error('Unable to create upload URL', { cause: error })))
			},
			presignDownload: (input) =>
				presigner.presignDownload(input).pipe(
					Effect.tapError((error) => capture(error, 'presign_download')),
					Effect.mapError((error) => new Error('Unable to create download URL', { cause: error })),
					Effect.withSpan('s3.presign_download'),
				),
			presignUpload: (input) =>
				presigner.presignUpload(input).pipe(
					Effect.tapError((error) => capture(error, 'presign_upload')),
					Effect.mapError((error) => new Error('Unable to create upload URL', { cause: error })),
					Effect.withSpan('s3.presign_upload'),
				),
			uploadArtifactBytes: (input) =>
				presigner.presignUpload({ key: input.key, contentType: input.contentType }).pipe(
					Effect.flatMap((url) =>
						httpClient.execute(
							HttpClientRequest.put(url).pipe(
								HttpClientRequest.bodyUint8Array(input.bytes),
								HttpClientRequest.setHeader('content-type', input.contentType),
							),
						),
					),
					Effect.flatMap(HttpClientResponse.filterStatusOk),
					Effect.asVoid,
					Effect.mapError((cause) => new S3UploadError({ status: null, cause })),
					Effect.tapError((error) => capture(error, 'upload_artifact_bytes')),
					Effect.withSpan('s3.upload_artifact_bytes', { attributes: { byte_count: input.bytes.byteLength } }),
				),
		}
	}),
)

const S3PresigningAdapterLive = Layer.effect(
	S3PresigningAdapter,
	Effect.gen(function* () {
		const bucket = yield* Config.String('S3_ARTIFACTS_BUCKET')
		const region = yield* Config.String('S3_ARTIFACTS_REGION').pipe(Config.withDefault('us-east-1'))
		const endpoint = yield* Config.option(Config.String('S3_ARTIFACTS_ENDPOINT'))
		const accessKeyId = yield* Config.option(Config.String('S3_ACCESS_KEY_ID'))
		const secretAccessKey = yield* Config.option(Config.String('S3_SECRET_ACCESS_KEY'))
		const credentials: S3Credentials | undefined =
			Option.isSome(accessKeyId) && Option.isSome(secretAccessKey)
				? { accessKeyId: accessKeyId.value, secretAccessKey: secretAccessKey.value }
				: undefined
		return makeLegacyS3PresigningAdapter(
			new LegacyS3Service(bucket, region, Option.getOrUndefined(endpoint), credentials),
		)
	}),
)

export const S3Live = S3LiveBase.pipe(
	Layer.provide(Layer.mergeAll(S3PresigningAdapterLive, FetchHttpClient.layer)),
	Layer.orDie,
)
