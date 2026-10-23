import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

// --- Shared schemas ---

export const UpdateInfo = Schema.Struct({
	version: Schema.String,
	notes: Schema.String,
	urgency: Schema.Literals(['normal', 'critical']),
	rawJson: Schema.Record(Schema.String, Schema.Unknown),
})
export type UpdateInfo = typeof UpdateInfo.Type

export const DownloadProgress = Schema.TaggedStruct('DownloadProgress', {
	bytesPerSecond: Schema.Number,
	percent: Schema.Number,
	delta: Schema.Number,
	transferred: Schema.Number,
	total: Schema.Number,
})

export const DownloadCompleted = Schema.TaggedStruct('DownloadCompleted', {
	version: Schema.String,
})

export const DownloadFailed = Schema.TaggedStruct('DownloadFailed', {
	message: Schema.String,
})

export const UpdateEvent = Schema.Union([DownloadProgress, DownloadCompleted, DownloadFailed])
export type UpdateEvent = typeof UpdateEvent.Type

// --- Errors (Schema.TaggedError -- cross the RPC boundary) ---

export class UpdateCheckError extends Schema.TaggedError<UpdateCheckError>()('UpdateCheckError', {
	message: Schema.String,
}) {}

export class UpdateNotAvailableError extends Schema.TaggedError<UpdateNotAvailableError>()('UpdateNotAvailableError', {
	message: Schema.String,
}) {}

export class UpdateDownloadError extends Schema.TaggedError<UpdateDownloadError>()('UpdateDownloadError', {
	message: Schema.String,
}) {}

export class UpdateNotReadyError extends Schema.TaggedError<UpdateNotReadyError>()('UpdateNotReadyError', {
	message: Schema.String,
}) {}

// --- RPCs ---

export class CheckForUpdate extends Rpc.make('CheckForUpdate', {
	success: Schema.NullOr(UpdateInfo),
}) {}

export class DownloadUpdate extends Rpc.make('DownloadUpdate', {
	success: Schema.Void,
	error: Schema.Union([UpdateNotAvailableError, UpdateDownloadError]),
}) {}

export class UpdateDownloadProgress extends Rpc.make('UpdateDownloadProgress', {
	success: UpdateEvent,
	stream: true,
}) {}

export class QuitAndInstall extends Rpc.make('QuitAndInstall', {
	success: Schema.Void,
	error: UpdateNotReadyError,
}) {}
