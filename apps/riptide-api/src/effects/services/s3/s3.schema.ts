import * as Schema from 'effect/Schema'

export const S3ObjectKey = Schema.NonEmptyString

export const UploadArtifactBytesInput = Schema.Struct({
	key: S3ObjectKey,
	contentType: Schema.NonEmptyString,
	bytes: Schema.Uint8Array,
})
export interface UploadArtifactBytesInput extends Schema.Schema.Type<typeof UploadArtifactBytesInput> {}

export const PresignedUploadInput = Schema.Struct({
	key: S3ObjectKey,
	contentType: Schema.NonEmptyString,
	expiresInMinutes: Schema.optionalKey(Schema.Number),
})
export interface PresignedUploadInput extends Schema.Schema.Type<typeof PresignedUploadInput> {}

export const PresignedDownloadInput = Schema.Struct({
	key: S3ObjectKey,
	expiresInMinutes: Schema.optionalKey(Schema.Number),
})
export interface PresignedDownloadInput extends Schema.Schema.Type<typeof PresignedDownloadInput> {}
