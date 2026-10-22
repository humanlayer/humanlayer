import type { DiscoveredGitRepository, RepositoryDiscoveryError } from '@humanlayer/riptide-electron-rpc'
import * as Context from 'effect/Context'
import type * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import type * as Path from 'effect/Path'
import type { ChildProcessSpawner } from 'effect/process'

type RepositoryDiscoveryRequirements = FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner

export interface RepositoryDiscoveryServiceShape {
	readonly inspectSelected: (input: { readonly directory: string }) => Effect.Effect<
		{
			readonly isInsideGitRepository: boolean
			readonly selectedRepository: DiscoveredGitRepository | undefined
		},
		never,
		RepositoryDiscoveryRequirements
	>
	readonly discover: (input: {
		readonly directory: string
	}) => Effect.Effect<
		ReadonlyArray<DiscoveredGitRepository>,
		RepositoryDiscoveryError,
		RepositoryDiscoveryRequirements
	>
}

export class RepositoryDiscoveryService extends Context.Service<
	RepositoryDiscoveryService,
	RepositoryDiscoveryServiceShape
>()('RepositoryDiscoveryService') {}
