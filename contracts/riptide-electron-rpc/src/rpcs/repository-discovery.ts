import * as Rpc from 'effect/rpc/Rpc'
import * as Schema from 'effect/Schema'

export const DiscoveredGitRemote = Schema.Struct({ name: Schema.String, url: Schema.String })
export const DiscoveredGitRepository = Schema.Struct({
	path: Schema.String,
	name: Schema.String,
	remotes: Schema.Array(DiscoveredGitRemote),
	defaultRemote: Schema.optional(Schema.String),
	defaultBranch: Schema.String,
	sourceRef: Schema.optional(Schema.String),
})
export type DiscoveredGitRepository = typeof DiscoveredGitRepository.Type

export class RepositoryDiscoveryError extends Schema.TaggedError<RepositoryDiscoveryError>()(
	'RepositoryDiscoveryError',
	{ message: Schema.String },
) {}

export class DiscoverGitRepositories extends Rpc.make('DiscoverGitRepositories', {
	payload: { directory: Schema.String },
	success: Schema.Array(DiscoveredGitRepository),
	error: RepositoryDiscoveryError,
}) {}
