import * as BunServices from '@effect/platform-bun/BunServices'
import { ActorSystemDefault } from '@humanlayer/effect-machine'
import { ProperLockfileLive } from '@humanlayer/effect-proper-lockfile'
import * as ConfigProvider from 'effect/ConfigProvider'
import { FetchHttpClient } from 'effect/http'
import * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'

import type { DaemonServices } from '@/agents/claudecode/types'
import { ConfiguredRepoContextRuntimeLive } from '@/lib/configured-repos/runtime'
import { GithubRuntimeLive } from '@/lib/github/runtime'
import type { ISyncService } from '@/lib/sync-service-types'
import { HostUsageLimitsLive } from '@/lib/usage-limits/host-usage-limits'
import type { ORPCClient } from '@/orpc/client'

import { DaemonEffectLoggerLive } from './daemon-effect-logger'
import { SentryEffectLive } from './sentry-effect'
import { ClaudeProcessEnvironment } from './services/claude-sessions/claude-process-environment'
import { ClaudeSessionsLive } from './services/claude-sessions/claude-sessions.live'
import { ClaudeSdkLive } from './services/claude-sessions/sdk/claude-sdk-session.layer'
import { DaemonApiLive } from './services/daemon-api/daemon-api.layer'
import { DaemonCollectionsLive } from './services/daemon-collections/daemon-collections.layer'
import { DaemonCollections } from './services/daemon-collections/daemon-collections.service'
import {
	DaemonInstanceLockLive,
	makeActiveDaemonInstanceLeaseLive,
	DaemonInstanceLeaseState,
	type AcquireDaemonInstanceLockInput,
} from './services/daemon-instance-lock'
import { DaemonTaskSyncLive } from './services/daemon-task-sync'
import { FoldEventProcessorLive } from './services/fold-sessions/fold-event-processor.layer'
import { FoldSessionOpenerLive } from './services/fold-sessions/fold-session-opener.layer'
import { FoldSessionRunnerLive } from './services/fold-sessions/fold-session-runner.layer'
import { HostMachineProbeLive } from './services/host-machine-stats/host-machine-probe.layer'
import { HostMachineStatsLive } from './services/host-machine-stats/host-machine-stats.layer'
import { HostModelCatalogSourceLive } from './services/host-model-catalog/host-model-catalog.layer'
import { ManagedRepositoryCacheLive } from './services/managed-repository-cache/managed-repository-cache.layer'
import { RepositorySourceContextLive } from './services/managed-repository-cache/repository-source-context'
import { ProviderLoginLive } from './services/provider-login/provider-login.layer'
import { ActiveSessionsLive } from './services/session-runs/active-sessions'
import { SessionRunRegistryLive } from './services/session-runs/session-run-registry'
import { DurableStreamFetchLive } from './services/stream-producer/durable-stream-fetch'
import { DiffStreamWriterFactoryLive } from './services/task-diff/diff-stream-writer.layer'
import { DurableStreamsDiffProducerFactoryLive } from './services/task-diff/durable-streams-diff-producer.layer'
import { GitCommandRunnerLive, GitRunnerConfigurationLive } from './services/task-diff/git-command-runner.layer'
import type { GitCommandRunnerRequirements } from './services/task-diff/git-command-runner.service'
import { GitFileSystemLive } from './services/task-diff/git-file-system.layer'
import { TaskDiffLifecycleObserverLive } from './services/task-diff/task-diff-lifecycle-observer.layer'
import { TaskDiffLockRegistryLive } from './services/task-diff/task-diff-lock-registry.layer'
import { TaskDiffServiceRegistryLive } from './services/task-diff/task-diff-service-registry.layer'
import { type TaskDiffServiceRegistry } from './services/task-diff/task-diff-service-registry.service'
import { TaskDiffServiceFactoryLive } from './services/task-diff/task-diff-service.layer'
import { TaskWorkspaceContextLive } from './services/task-workspace-context/task-workspace-context.layer'
import { WorkspacePathResolverLive } from './services/workspace-path-resolver/workspace-path-resolver.layer'
import { RepositorySourceResolverLive } from './services/workspace-repository-actor-operations/repository-source-resolver'
import { WorkspaceRepositoryActorOperationsLive } from './services/workspace-repository-actor-operations/workspace-repository-actor-operations.layer'
import { WorkspaceRepositorySetupActorsLive } from './services/workspace-repository-setup/workspace-repository-setup-actors.layer'
import { WorkspaceRepositorySetupChangesLive } from './services/workspace-repository-setup/workspace-repository-setup-changes'
import { WorkspaceSessionLaunchActorsLive } from './services/workspace-session-launch/workspace-session-launch-actors.layer'
import { WorkspaceSetupExecutorLive } from './services/workspace-setup-executor/workspace-setup-executor.layer'
import { WorkspaceSetupLive } from './services/workspace-setup/workspace-setup.layer'

const TaskDiffPlatformLive = Layer.mergeAll(
	GitCommandRunnerLive,
	GitRunnerConfigurationLive.pipe(Layer.orDie),
	DiffStreamWriterFactoryLive.pipe(Layer.orDie),
	TaskDiffLockRegistryLive,
).pipe(Layer.provideMerge(BunServices.layer))

const TaskDiffAdapterLive = Layer.mergeAll(GitFileSystemLive, DurableStreamsDiffProducerFactoryLive).pipe(
	Layer.provideMerge(TaskDiffPlatformLive),
)

const TaskDiffFactoryLive = TaskDiffServiceFactoryLive.pipe(Layer.provideMerge(TaskDiffAdapterLive))
const TaskDiffRegistryLive = TaskDiffServiceRegistryLive.pipe(Layer.provideMerge(TaskDiffFactoryLive), Layer.orDie)

/** Complete task-diff service graph, including lifecycle observation. */
export const TaskDiffLive = TaskDiffLifecycleObserverLive.pipe(Layer.provideMerge(TaskDiffRegistryLive))

/** Runtime capability required by task-diff hook adapters and their test layers. */
export type TaskDiffRuntime = ManagedRuntime.ManagedRuntime<
	TaskDiffServiceRegistry | GitCommandRunnerRequirements,
	unknown
>

export interface CreateDaemonRuntimeOptions {
	readonly orpc: ORPCClient
	readonly collections?: DaemonServices['collections']
	readonly daemonCollectionsLayer?: Layer.Layer<DaemonCollections, never, never>
	readonly collectionConfig?: {
		readonly hostId: string
		readonly targetSessionId?: string
	}
	readonly syncOrigin: string
	readonly daemonToken: string
	readonly devMode: boolean
	readonly inheritedEnvironment: NodeJS.ProcessEnv
	readonly syncService: ISyncService
	readonly instanceLock?: AcquireDaemonInstanceLockInput
}

export function createDaemonRuntime(options: CreateDaemonRuntimeOptions) {
	const collectionsLayer = (() => {
		if (options.daemonCollectionsLayer !== undefined) return options.daemonCollectionsLayer
		if (options.collectionConfig !== undefined) {
			return DaemonCollectionsLive({
				...options.collectionConfig,
				token: options.daemonToken,
				syncOrigin: options.syncOrigin,
			})
		}
		if (options.collections !== undefined) return DaemonCollectionsLive(options.collections)
		throw new Error('Daemon runtime requires collection config or existing collections')
	})()
	const StartupConfigLive = Layer.succeed(
		ConfigProvider.ConfigProvider,
		ConfigProvider.orElse(
			ConfigProvider.fromUnknown({
				RIPTIDE_SYNC_ORIGIN: options.syncOrigin,
				RIPTIDE_DAEMON_TOKEN: options.daemonToken,
				RIPTIDE_DAEMON_DEV_MODE: options.devMode,
			}),
			ConfigProvider.fromEnv(),
		),
	)
	const BaseRuntimeLive = Layer.mergeAll(
		DaemonApiLive(options.orpc),
		collectionsLayer,
		DaemonEffectLoggerLive,
		SentryEffectLive,
		DurableStreamFetchLive,
		Layer.succeed(ClaudeProcessEnvironment, options.inheritedEnvironment),
		HostModelCatalogSourceLive.pipe(Layer.provide(FetchHttpClient.layer)),
		DaemonTaskSyncLive(options.syncService),
		ConfiguredRepoContextRuntimeLive,
		HostUsageLimitsLive,
		// The only GitHub access instance: the identity probe, the refresh loop, and the post-run PR
		// scan share its auth latches, and the scan resolves project-workspace siblings through the
		// task context above.
		GithubRuntimeLive,
	).pipe(Layer.provideMerge(Layer.mergeAll(StartupConfigLive, BunServices.layer, SessionRunRegistryLive)))
	// One task-context cache shared by session launch, task-diff registration, and the trackers.
	const TaskWorkspaceContextRuntimeLive = TaskWorkspaceContextLive.pipe(Layer.provide(BaseRuntimeLive))
	const ClaudeAdaptersLive = Layer.mergeAll(ClaudeSdkLive, TaskWorkspaceContextRuntimeLive).pipe(
		Layer.provideMerge(BaseRuntimeLive),
	)
	const ClaudeDomainLive = ClaudeSessionsLive.pipe(Layer.provideMerge(ClaudeAdaptersLive))
	const WorkspacePathResolverPlatformLive = WorkspacePathResolverLive.pipe(
		Layer.provideMerge(Layer.mergeAll(BunServices.layer, StartupConfigLive)),
	)
	const WorkspaceSetupOperationalLive = Layer.mergeAll(BunServices.layer, WorkspacePathResolverPlatformLive)
	const WorkspaceSetupExecutorRuntimeLive = WorkspaceSetupExecutorLive.pipe(
		Layer.provideMerge(WorkspaceSetupOperationalLive),
		Layer.orDie,
	)
	const WorkspaceSetupDomainLive = WorkspaceSetupLive.pipe(
		Layer.provideMerge(Layer.mergeAll(WorkspaceSetupExecutorRuntimeLive, BaseRuntimeLive)),
	)
	const WorkspaceRepositoryGitLive = Layer.mergeAll(GitCommandRunnerLive, GitRunnerConfigurationLive).pipe(
		Layer.provideMerge(Layer.mergeAll(BunServices.layer, StartupConfigLive)),
		Layer.orDie,
	)
	const ManagedRepositoryCacheRuntimeLive = Layer.mergeAll(
		ManagedRepositoryCacheLive,
		RepositorySourceContextLive,
	).pipe(Layer.provideMerge(Layer.mergeAll(WorkspaceRepositoryGitLive, BunServices.layer, StartupConfigLive)))
	const WorkspaceRepositoryOperationsLive = WorkspaceRepositoryActorOperationsLive.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				BaseRuntimeLive,
				WorkspaceRepositoryGitLive,
				ManagedRepositoryCacheRuntimeLive,
				RepositorySourceResolverLive,
				BunServices.layer,
			),
		),
	)
	const WorkspaceRepositoryActorsLive = WorkspaceRepositorySetupActorsLive.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				ActorSystemDefault,
				WorkspaceRepositoryOperationsLive,
				BaseRuntimeLive,
				WorkspaceRepositorySetupChangesLive({ syncOrigin: options.syncOrigin, token: options.daemonToken }),
			),
		),
	)
	// One deterministic launch actor per V2 session. Actors call DaemonApi from BaseRuntimeLive; the
	// WorkspaceSessionRunner they hand off to needs DaemonServices, which exist only after this
	// runtime is built, so the subscription program provides that layer itself.
	const WorkspaceSessionLaunchLive = WorkspaceSessionLaunchActorsLive.pipe(
		Layer.provideMerge(Layer.mergeAll(ActorSystemDefault, BaseRuntimeLive)),
	)
	const DaemonInstanceLockWithProperLockfileLive = DaemonInstanceLockLive.pipe(Layer.provideMerge(ProperLockfileLive))
	const DaemonInstanceLeaseStateLive =
		options.instanceLock === undefined
			? Layer.succeed(DaemonInstanceLeaseState, { mode: 'locking-disabled' as const })
			: makeActiveDaemonInstanceLeaseLive(options.instanceLock).pipe(
					Layer.provideMerge(DaemonInstanceLockWithProperLockfileLive),
				)
	const FoldAdaptersLive = Layer.mergeAll(
		FoldSessionOpenerLive,
		FoldEventProcessorLive,
		TaskWorkspaceContextRuntimeLive,
	).pipe(Layer.provideMerge(BaseRuntimeLive))
	const FoldAdaptersWithTaskDiffLive = FoldAdaptersLive.pipe(Layer.provideMerge(TaskDiffLive))
	const FoldDomainLive = FoldSessionRunnerLive.pipe(Layer.provideMerge(FoldAdaptersWithTaskDiffLive))
	const ProviderLoginDomainLive = ProviderLoginLive.pipe(Layer.provideMerge(BaseRuntimeLive))
	const ActiveSessionsRuntimeLive = ActiveSessionsLive.pipe(
		Layer.provide(Layer.mergeAll(ClaudeDomainLive, FoldDomainLive)),
	)
	const HostMachineStatsRuntimeLive = HostMachineStatsLive.pipe(
		Layer.provide(Layer.mergeAll(HostMachineProbeLive, ActiveSessionsRuntimeLive)),
	)
	const DaemonRuntimeLive = Layer.mergeAll(
		DaemonInstanceLeaseStateLive,
		ProviderLoginDomainLive,
		TaskDiffLive,
		ClaudeDomainLive,
		FoldDomainLive,
		HostMachineStatsRuntimeLive,
		WorkspaceSetupExecutorRuntimeLive,
		WorkspaceSetupDomainLive,
		WorkspaceRepositoryActorsLive,
		WorkspaceSessionLaunchLive,
		TaskWorkspaceContextRuntimeLive,
	).pipe(Layer.provideMerge(BaseRuntimeLive))

	return ManagedRuntime.make(DaemonRuntimeLive)
}

export type DaemonManagedRuntime = ReturnType<typeof createDaemonRuntime>

export type DaemonRuntime = ReturnType<typeof createDaemonRuntime>
