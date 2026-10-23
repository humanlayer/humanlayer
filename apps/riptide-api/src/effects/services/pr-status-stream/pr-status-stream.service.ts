import type { CheckRowType, PrStatusKey, PullRequestRowType } from '@humanlayer/streams/pr-status'
import { Context, Data, type Effect } from 'effect'

export class PrStatusStreamInitializationError extends Data.TaggedError('PrStatusStreamInitializationError')<{
	readonly message: string
	readonly cause: unknown
}> {}

export class PrStatusStreamAppendError extends Data.TaggedError('PrStatusStreamAppendError')<{
	readonly message: string
	readonly cause: unknown
}> {}

export interface PrStatusSnapshot {
	readonly pullRequest: PullRequestRowType | null
	readonly checks: ReadonlyArray<CheckRowType>
}

export interface PrStatusStreamShape {
	// Creates the stream when it does not exist, then writes the whole snapshot in one append.
	// A `null` pull request only creates, so the first webhook for the branch finds a watcher.
	readonly hydrate: (
		key: PrStatusKey,
		snapshot: PrStatusSnapshot,
	) => Effect.Effect<void, PrStatusStreamInitializationError | PrStatusStreamAppendError>
	// Writes only to a stream that exists: a stream lives only while somebody has the panel open.
	readonly publishChecks: (
		key: PrStatusKey,
		rows: ReadonlyArray<CheckRowType>,
	) => Effect.Effect<void, PrStatusStreamAppendError>
	// Same rule as `publishChecks`: a pull request change reaches only an open panel.
	readonly publishPullRequest: (
		key: PrStatusKey,
		row: PullRequestRowType,
	) => Effect.Effect<void, PrStatusStreamAppendError>
}

export class PrStatusStream extends Context.Service<PrStatusStream, PrStatusStreamShape>()('PrStatusStream') {}
