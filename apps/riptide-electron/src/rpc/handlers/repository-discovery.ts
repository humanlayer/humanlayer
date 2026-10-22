import * as Effect from 'effect/Effect'

import { discoverGitRepositories } from '../../repository-discovery/repository-discovery.layer'

export const discoverGitRepositoriesHandler = Effect.fn('rpc.discover_git_repositories')(function* (input: {
	readonly directory: string
}) {
	return yield* discoverGitRepositories(input)
})
