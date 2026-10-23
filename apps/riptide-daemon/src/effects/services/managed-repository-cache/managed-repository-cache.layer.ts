import { Effect, Layer, RcMap, Semaphore, type PlatformError } from 'effect'

import { ManagedRepositoryCache, ManagedRepositoryCacheError } from './managed-repository-cache.service'
import { RepositorySourceContext } from './repository-source-context'
import { observeRepositorySourceFailure } from './repository-source-git'
import {
	materializeRepositorySource,
	publishRepositoryBranch,
	refreshRepositorySource,
} from './repository-source-mutations'
import { prepareRepositorySource, repositoryPath } from './repository-source-preparation'

interface RepositoryPermitInput {
	readonly repositoryIdentity: string
}

interface RepositoryOperationBoundaryInput extends RepositoryPermitInput {
	readonly path: string
}

const observeAndMapRepositoryFailure =
	(input: RepositoryOperationBoundaryInput) =>
	<A, R>(operation: Effect.Effect<A, ManagedRepositoryCacheError | PlatformError.PlatformError, R>) =>
		operation.pipe(
			observeRepositorySourceFailure,
			Effect.catchTag('PlatformError', (error) =>
				Effect.fail(
					new ManagedRepositoryCacheError({
						message: error.message,
						repositoryIdentity: input.repositoryIdentity,
						path: input.path,
					}),
				),
			),
		)

export const ManagedRepositoryCacheLive = Layer.effect(
	ManagedRepositoryCache,
	Effect.gen(function* () {
		const semaphores = yield* RcMap.make({
			lookup: (_identity: string) => Semaphore.make(1),
			idleTimeToLive: '1 minute',
		})
		const withRepositoryPermit = <A, E, R>(input: RepositoryPermitInput, operation: Effect.Effect<A, E, R>) =>
			Effect.scoped(
				Effect.flatMap(RcMap.get(semaphores, input.repositoryIdentity), (semaphore) =>
					semaphore.withPermit(operation),
				),
			)
		return ManagedRepositoryCache.of({
			repositoryPath,
			prepare: Effect.fn('managed_repository_cache.prepare')(function* (input) {
				const { root } = yield* RepositorySourceContext
				return yield* withRepositoryPermit(input, prepareRepositorySource(input)).pipe(
					observeAndMapRepositoryFailure({ ...input, path: input.sourcePath ?? root }),
				)
			}),
			refresh: Effect.fn('managed_repository_cache.refresh')(function* (input) {
				return yield* withRepositoryPermit(input, refreshRepositorySource(input)).pipe(
					observeAndMapRepositoryFailure({ ...input, path: input.sourcePath }),
				)
			}),
			materialize: Effect.fn('managed_repository_cache.materialize')(function* (input) {
				return yield* withRepositoryPermit(input, materializeRepositorySource(input)).pipe(
					observeAndMapRepositoryFailure({ ...input, path: input.targetPath }),
				)
			}),
			publishBranch: Effect.fn('managed_repository_cache.publish_branch')(function* (input) {
				return yield* withRepositoryPermit(input, publishRepositoryBranch(input)).pipe(
					observeAndMapRepositoryFailure({ ...input, path: input.materializationPath }),
				)
			}),
		})
	}),
)
