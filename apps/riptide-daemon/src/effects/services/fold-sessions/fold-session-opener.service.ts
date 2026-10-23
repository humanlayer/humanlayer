import type { FoldSession } from '@humanlayer/fold-core'
import { Context, type Effect, FileSystem, Path, type Scope } from 'effect'

import type { ConfiguredRepoContext } from '@/lib/configured-repos/service'

import type { DaemonApi } from '../daemon-api/daemon-api.service'
import type { DaemonCollections } from '../daemon-collections/daemon-collections.service'
import type { DaemonTaskSync } from '../daemon-task-sync'
import type { GitCommandRunnerRequirements } from '../task-diff/git-command-runner.service'
import type { TaskDiffServiceRegistry } from '../task-diff/task-diff-service-registry.service'
import type { TaskWorkspaceContext } from '../task-workspace-context/task-workspace-context.service'
import type { FoldHostServices } from './fold-host-services'
import type { FoldSessionOpenError } from './fold-sessions.errors'
import type { OpenFoldSessionInput } from './fold-sessions.schemas'

export type FoldSessionOpenRequirements =
	| DaemonCollections
	| DaemonApi
	| DaemonTaskSync
	| ConfiguredRepoContext
	| TaskDiffServiceRegistry
	| TaskWorkspaceContext
	| GitCommandRunnerRequirements
	| FileSystem.FileSystem
	| Path.Path

export class FoldSessionOpener extends Context.Service<
	FoldSessionOpener,
	{
		readonly open: (
			input: OpenFoldSessionInput,
		) => Effect.Effect<
			FoldSession<FoldHostServices>,
			FoldSessionOpenError,
			Scope.Scope | FoldSessionOpenRequirements
		>
	}
>()('FoldSessionOpener') {}
