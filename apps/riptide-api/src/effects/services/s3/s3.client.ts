import { Context, Effect } from 'effect'

import { S3Service as LegacyS3Service } from '../../../lib/s3-service'
import { S3PresignError } from './s3.errors'
import type { PresignedDownloadInput, PresignedUploadInput } from './s3.schema'

export interface S3PresigningAdapterShape {
	readonly presignDownload: (input: PresignedDownloadInput) => Effect.Effect<string, S3PresignError>
	readonly presignUpload: (input: PresignedUploadInput) => Effect.Effect<string, S3PresignError>
}

export class S3PresigningAdapter extends Context.Service<S3PresigningAdapter, S3PresigningAdapterShape>()(
	'S3PresigningAdapter',
) {}

export const makeLegacyS3PresigningAdapter = (legacy: LegacyS3Service): S3PresigningAdapterShape => ({
	presignDownload: (input) =>
		Effect.tryPromise({
			try: () => legacy.getPresignedDownloadUrl(input.key, input.expiresInMinutes),
			catch: (cause) => new S3PresignError({ operation: 'download', cause }),
		}),
	presignUpload: (input) =>
		Effect.tryPromise({
			try: () => legacy.getPresignedUploadUrl(input.key, input.contentType, input.expiresInMinutes),
			catch: (cause) => new S3PresignError({ operation: 'upload', cause }),
		}),
})
