import { Duration, FileSystem, Layer, Path } from 'effect'
import { ChildProcessSpawner } from 'effect/process'

import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'
import { ManagedRepositoryCache } from '@/effects/services/managed-repository-cache/managed-repository-cache.service'
import { RepositorySourceContext } from '@/effects/services/managed-repository-cache/repository-source-context'
import { GitCommandRunner, GitRunnerConfiguration } from '@/effects/services/task-diff/git-command-runner.service'
import { RepositorySourceResolver } from '@/effects/services/workspace-repository-actor-operations/repository-source-resolver'

// Replacing a capability does not erase its declared R. These dependencies must never
// perform I/O in tests with scripted operations. Process/capability mocks die on access.
export const UnusedGitRequirements = Layer.mergeAll(
	Layer.succeed(GitRunnerConfiguration, {
		timeout: Duration.seconds(30),
		maxOutputBytes: 1024,
		inheritedSshCommand: undefined,
		inheritedSshExecutable: undefined,
		inheritedSshVariant: undefined,
	}),
	Layer.mock(ChildProcessSpawner.ChildProcessSpawner, {}),
)

export const UnusedRepositoryRequirements = Layer.mergeAll(
	UnusedGitRequirements,
	FileSystem.layerNoop({}),
	Path.layer,
	Layer.mock(GitCommandRunner, {}),
	Layer.mock(ManagedRepositoryCache, {}),
	Layer.succeed(RepositorySourceContext, {
		root: '/unused',
		cloneTimeout: Duration.minutes(10),
		gitEnvironment: {},
	}),
	Layer.mock(RepositorySourceResolver, {}),
)

export const UnusedRepositoryOperationRequirements = Layer.mergeAll(
	UnusedRepositoryRequirements,
	Layer.mock(DaemonApi, {}),
)
