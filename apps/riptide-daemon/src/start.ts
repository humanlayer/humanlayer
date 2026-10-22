import './instrument' // MUST BE FIRST - initializes Sentry
import * as Sentry from '@sentry/bun'
import { Duration, Effect, Exit, Option, Queue, Scope } from 'effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'

import { defaultShutdownCoordinator } from './agents/claudecode/shutdown'
import type { DaemonServices } from './agents/claudecode/types'
import { executeCodelayer } from './agents/codelayer/execute-codelayer'
import { createDaemonRuntime } from './effects/runtime'
import { createClaudeSessionExecutor } from './effects/services/claude-sessions/claude-session-executor'
import { DaemonCollections } from './effects/services/daemon-collections/daemon-collections.service'
import { DaemonInstanceAlreadyRunning, DaemonInstanceLeaseState } from './effects/services/daemon-instance-lock'
import { createFoldSessionExecutor } from './effects/services/fold-sessions/fold-session-executor'
import { HostModelCatalogSource } from './effects/services/host-model-catalog/host-model-catalog.service'
import { ProviderLogin } from './effects/services/provider-login/provider-login.service'
import { SelfUpdateProcessesLive } from './effects/services/self-update/self-update-processes.layer'
import { runRequestedSelfUpdates } from './effects/services/self-update/self-update-requests'
import { DaemonAlreadyShuttingDown, SelfUpdateReportError } from './effects/services/self-update/self-update.errors'
import { makeSelfUpdaterLive } from './effects/services/self-update/self-update.layer'
import type { ShutdownDaemonForRestartInput } from './effects/services/self-update/self-update.service'
import { TaskDiffServiceRegistry } from './effects/services/task-diff/task-diff-service-registry.service'
import { WorkspaceSetup } from './effects/services/workspace-setup/workspace-setup.service'
import { reportAgentSlashCommands, watchAgentCommandDiscoveryRequests } from './lib/agent-commands/report'
import { type LoadedDaemonIdentity, loadDaemonIdentity } from './lib/auth'
import { reportEmergencyError } from './lib/emergency-error-reporter'
import { type CommitWatcher, startCommitWatcher } from './lib/git/commit-watcher'
import { type RepositoryObserver, startRepositoryObserver } from './lib/git/repository-observer'
import { captureGithubIdentity } from './lib/github/github-identity'
import { deriveHeartbeatCapabilities, startHeartbeat } from './lib/heartbeat'
import { API_ORIGIN, BUILD_VERSION, SYNC_ORIGIN } from './lib/macros'
import { orgTelemetryCache } from './lib/org-telemetry-settings'
import { startOrphanDetection } from './lib/orphan-detection'
import { getShutdownExitCode, setShutdownExitCode } from './lib/shutdown-exit-code'
import { type ISyncService, SyncService } from './lib/sync-service'
import { type AutomationDaemonResult, makeAutomationLifecycleCoordinator } from './lifecycle/automation-lifecycle'
import { createGracefulShutdown } from './lifecycle/graceful-shutdown'
import { createShutdownDeadline } from './lifecycle/shutdown-deadline'
import { installShutdownSignals } from './lifecycle/shutdown-signals'
import { createStartupShutdown } from './lifecycle/startup-shutdown'
import logger from './logger'
import {
	DaemonIdentityLoader,
	ManagedDaemonIdentityError,
	ManagedDaemonRuntimeLauncher,
	ManagedDaemonStartupError,
	type ManagedDaemonConfig,
	type ManagedDaemonLaunchResult,
	type ManagedDaemonRuntimeConfig,
	loadResolvedManagedDaemonLaunchRequestAtHostBoundary,
	runManagedDaemonStart,
} from './managed-daemon-start'
import { createDaemonORPCClient } from './orpc/client'
import { initializeSubscriptions } from './subscriptions'

const MODEL_CATALOG_FIRST_HEARTBEAT_WAIT = Duration.seconds(10)

export interface DaemonConfig {
	/** Daemon auth token (DAEMON_IDENTITY equivalent) */
	token: string
	/** Override for API_ORIGIN macro */
	apiOrigin?: string
	/** Override for SYNC_ORIGIN macro */
	syncOrigin?: string
}

export type { ManagedDaemonConfig } from './managed-daemon-start'
export { getAutomationResultExitCode } from './lib/shutdown-exit-code'
export type { AutomationDaemonResult } from './lifecycle/automation-lifecycle'

/**
 * Start the daemon with the given configuration.
 * This is the importable entry point used by the CLI.
 * The daemon runs in the current process and keeps it alive via heartbeat + subscriptions.
 */
async function startDaemonInitialized(
	config: ManagedDaemonRuntimeConfig,
	loadedIdentity: LoadedDaemonIdentity | null,
): Promise<void | AutomationDaemonResult> {
	const { apiOrigin, syncOrigin } = config

	// Load daemon identity from injected token
	const identity = loadedIdentity ?? (await loadDaemonIdentity(config.token))

	// Set Sentry context from identity claims
	if (identity.authenticationMode === 'authenticated') {
		Sentry.setUser({ id: identity.identity.userId })
		Sentry.setTag('organization_id', identity.identity.organizationId)
		Sentry.setTag('host_id', identity.identity.hostId)
		Sentry.setContext('organization', { id: identity.identity.organizationId })
		logger.debug(
			{
				userId: identity.identity.userId,
				organizationId: identity.identity.organizationId,
				hostId: identity.identity.hostId,
			},
			'Set Sentry user context from daemon identity',
		)
	}

	// Create oRPC client - synchronous, just needs token
	const orpc = createDaemonORPCClient(apiOrigin, identity.token)
	logger.info('oRPC client initialized')

	let syncServiceTarget: ISyncService | undefined
	const syncService: ISyncService = {
		ensureTaskSync: (taskId, cwd) => {
			if (syncServiceTarget === undefined) return Promise.reject(new Error('Sync service is not ready'))
			return syncServiceTarget.ensureTaskSync(taskId, cwd)
		},
		shutdown: async () => {
			await syncServiceTarget?.shutdown()
		},
		getDebugState: () =>
			syncServiceTarget?.getDebugState() ?? {
				activeTaskIds: [],
				registeredTaskIds: [],
				pendingTaskIds: [],
			},
	}
	const daemonRuntime = createDaemonRuntime({
		orpc,
		syncOrigin,
		daemonToken: identity.token,
		devMode: config.stage === 'local',
		inheritedEnvironment: process.env,
		syncService,
		collectionConfig: {
			hostId: identity.hostId,
			targetSessionId: config.automation?.targetSessionId,
		},
		instanceLock:
			identity.authenticationMode === 'authenticated'
				? {
						userId: identity.identity.userId,
						organizationId: identity.identity.organizationId,
						hostId: identity.identity.hostId,
						stage: config.stage,
						generationId: config.generationId,
					}
				: undefined,
	})
	let stopHeartbeat = () => {}
	const interruptedExitCode = () => (config.automation === null ? getShutdownExitCode() : 1)
	const shutdownDeadline = createShutdownDeadline({
		forceShutdown: (forceReason, signal) => {
			logger.warn({ forceReason, signal }, 'Forcing immediate daemon shutdown')
			process.exit(interruptedExitCode())
		},
	})
	const startupShutdown = createStartupShutdown({
		deadline: shutdownDeadline,
		stopHeartbeat: () => stopHeartbeat(),
		disposeRuntime: () => daemonRuntime.dispose(),
		exit: () => process.exit(interruptedExitCode()),
	})
	const shutdownSignals = installShutdownSignals((signal) => startupShutdown.shutdown(signal))
	try {
		await daemonRuntime.runPromise(
			Effect.logInfo('Daemon Effect runtime initialized').pipe(
				Effect.withSpan('daemon.runtime.initialize', { attributes: { component: 'riptide-daemon' } }),
			),
		)
		const collections = await daemonRuntime.runPromise(
			Effect.gen(function* () {
				const daemonCollections = yield* DaemonCollections
				return yield* daemonCollections.current
			}),
		)
		syncServiceTarget = new SyncService(orpc, syncOrigin, identity.token, collections.tasks, { daemonRuntime })
		logger.debug('Collections initialized')
		daemonRuntime.runFork(
			Effect.gen(function* () {
				const workspaceSetup = yield* WorkspaceSetup
				yield* workspaceSetup.run
			}).pipe(
				Effect.catchCause((cause) =>
					Effect.logError('Workspace setup stream stopped').pipe(Effect.annotateLogs({ cause })),
				),
			),
		)
		daemonRuntime.runFork(
			Effect.gen(function* () {
				const providerLogin = yield* ProviderLogin
				yield* providerLogin.run
			}).pipe(
				Effect.catchCause((cause) =>
					Effect.logError('Provider login stream stopped').pipe(Effect.annotateLogs({ cause })),
				),
			),
		)
		const claudeExecutor = createClaudeSessionExecutor(daemonRuntime)
		const foldExecutor = createFoldSessionExecutor(daemonRuntime)
		const automationLifecycle =
			config.automation === null
				? undefined
				: await daemonRuntime.runPromise(makeAutomationLifecycleCoordinator(config.automation.lifecycle))
		// Construct services object - this is the ONLY place this happens in production
		const services: DaemonServices = {
			daemonRuntime,
			orpc,
			syncOrigin,
			daemonToken: identity.token,
			automationTargetSessionId: config.automation?.targetSessionId,
			automationLifecycle,
			collections,
			shutdown: defaultShutdownCoordinator,
			syncService,
			executors: {
				claude: claudeExecutor,
				codelayer: executeCodelayer,
				fold: foldExecutor,
			},
		}

		const selfUpdateCapability = config.selfUpdate ?? null
		const requestedSelfUpdateVersions = Effect.runSync(Queue.sliding<string>(1))
		const selfUpdateScope = Scope.makeUnsafe()

		// Register the host before any workspace or session dispatch can begin. The first beat
		// waits briefly for the model probe so the picker rarely sees a host without a catalog.
		const modelCatalogSource = await daemonRuntime.runPromise(HostModelCatalogSource)
		daemonRuntime.runFork(
			modelCatalogSource.run.pipe(
				Effect.catchCause((cause) =>
					Effect.logError('Host model catalog loop stopped').pipe(Effect.annotateLogs({ cause })),
				),
			),
		)
		await daemonRuntime.runPromise(
			modelCatalogSource.awaitFirstProbe.pipe(Effect.timeoutOption(MODEL_CATALOG_FIRST_HEARTBEAT_WAIT)),
		)
		const heartbeat = await startHeartbeat(
			daemonRuntime,
			identity.hostId,
			orpc,
			deriveHeartbeatCapabilities(config, selfUpdateCapability !== null),
			selfUpdateCapability === null ? undefined : requestedSelfUpdateVersions,
			{
				current: () => Option.getOrUndefined(daemonRuntime.runSync(modelCatalogSource.snapshot)),
			},
		)
		stopHeartbeat = heartbeat.stop

		// Seed the org-telemetry cache the collector gates read, so per-org opt-ins (phantom
		// enablement) are honored from startup. On auto-collect build channels the gates enable
		// regardless; a failed fetch leaves the cache OFF (fail-safe) — which on an opt-in channel
		// silently suppresses a phantom-enabled org's collection until the first session refreshes it,
		// so surface it to Sentry, not just the log.
		try {
			orgTelemetryCache.set(await orpc.settings.get({}))
		} catch (error) {
			logger.warn(
				{ error },
				'Failed to fetch org telemetry settings at startup; collectors stay off until refreshed',
			)
			Sentry.captureException(error, { tags: { error_type: 'org_telemetry_settings_fetch' } })
		}

		// Capture the operator's GitHub identity once, fire-and-forget; the upsert makes repeats
		// harmless. The identity only exists to credit merged pull requests, so it follows the
		// org's pr_tracking_enabled setting.
		if (orgTelemetryCache.prTrackingEnabled()) {
			void daemonRuntime.runPromise(captureGithubIdentity(orpc))
		}

		daemonRuntime.runFork(reportAgentSlashCommands({ hostId: identity.hostId }))
		daemonRuntime.runFork(
			watchAgentCommandDiscoveryRequests({ hostId: identity.hostId, syncOrigin, token: identity.token }).pipe(
				Effect.catchCause((cause) =>
					Effect.logError('Agent command discovery request stream stopped').pipe(
						Effect.annotateLogs({ cause }),
					),
				),
			),
		)

		let stopOrphanDetection = () => {}
		let stopSubscriptions: () => Promise<unknown> | void = () => {}
		let commitWatcher: CommitWatcher | null = null
		let repositoryObserver: RepositoryObserver | null = null
		let shutdownStarted = false
		const shutdownDaemon = createGracefulShutdown({
			orpc,
			hostId: identity.hostId,
			stopHeartbeat,
			stopOrphanDetection: () => stopOrphanDetection(),
			syncService: services.syncService,
			stopSubscriptions: () => stopSubscriptions(),
			stopSelfUpdate: () => Effect.runPromise(Scope.close(selfUpdateScope, Exit.void)),
			stopCaptureSources: async () => {
				commitWatcher?.stop()
				repositoryObserver?.stop()
				await daemonRuntime.runPromise(
					Effect.gen(function* () {
						const registry = yield* TaskDiffServiceRegistry
						yield* registry.drain
					}),
				)
			},
			runtime: daemonRuntime,
		})

		const completeShutdown = (reason: string, exitProcess: boolean): Promise<void> => {
			if (shutdownStarted) {
				logger.info({ reason }, 'Shutdown already started, ignoring duplicate shutdown request')
				return shutdownDaemon(reason)
			}

			shutdownStarted = true
			if (!shutdownDeadline.isStarted()) shutdownDeadline.begin(reason)
			const completion = shutdownDaemon(reason)
			if (exitProcess) {
				void completion
					.catch((error) => {
						logger.error(error, 'Error while completing graceful daemon shutdown')
					})
					.finally(() => {
						shutdownDeadline.complete()
						process.exit(getShutdownExitCode())
					})
			}
			return completion
		}

		const shutdownDaemonForRestart = ({ forcedExitCode, beforeShutdown }: ShutdownDaemonForRestartInput) =>
			Effect.gen(function* () {
				if (shutdownDeadline.isStarted()) {
					return yield* new DaemonAlreadyShuttingDown({ message: 'Daemon shutdown already started' })
				}
				yield* beforeShutdown
				setShutdownExitCode(forcedExitCode)
				yield* Effect.promise(() => completeShutdown('SELF_UPDATE', false))
				shutdownDeadline.complete()
			})

		if (selfUpdateCapability !== null) {
			const SelfUpdaterLive = makeSelfUpdaterLive({
				capability: selfUpdateCapability,
				currentVersion: BUILD_VERSION,
				daemonToken: identity.token,
				reportUpdateProgress: (update) =>
					Effect.tryPromise({
						try: () => heartbeat.report(update),
						catch: (cause) =>
							new SelfUpdateReportError({ message: 'Could not report daemon update progress', cause }),
					}),
				shutdownDaemonForRestart,
			}).pipe(Layer.provide(SelfUpdateProcessesLive))
			await daemonRuntime.runPromise(
				runRequestedSelfUpdates(requestedSelfUpdateVersions).pipe(
					Effect.provide(SelfUpdaterLive),
					Effect.forkIn(selfUpdateScope),
				),
			)
		}

		const handleShutdown = (reason: string) => {
			if (!shutdownDeadline.begin(reason)) return
			if (automationLifecycle === undefined) {
				void completeShutdown(reason, true)
				return
			}
			void Effect.runPromise(automationLifecycle.interrupt).catch((error) => {
				logger.error({ error, reason }, 'Failed to interrupt automation lifecycle')
			})
		}

		if (identity.authenticationMode === 'authenticated') {
			daemonRuntime.runFork(
				DaemonInstanceLeaseState.use((leaseState) =>
					leaseState.mode === 'active' ? leaseState.lease.monitorCompromise : Effect.never,
				).pipe(
					Effect.tapError((error) =>
						Effect.logError('Daemon instance lock was compromised').pipe(
							Effect.annotateLogs({
								lock_compromise_reason: error.reason,
								lock_path: error.lockPath,
							}),
							Effect.andThen(
								Effect.sync(() =>
									Sentry.captureException(
										new Error(`Daemon instance lock compromised: ${error.reason}`),
										{
											tags: {
												error_type: 'daemon_instance_lock_compromised',
												lock_compromise_reason: error.reason,
											},
											extra: {
												lockPath: error.lockPath,
												path: error.path,
												cause: error.cause,
											},
										},
									),
								),
							),
						),
					),
					Effect.catchTag('LockCompromisedError', () =>
						Effect.sync(() => handleShutdown('INSTANCE_LOCK_COMPROMISED')),
					),
					Effect.withSpan('daemon_instance_lock.supervise_compromise'),
				),
			)
		}

		if (process.env.RIPTIDE_DAEMON_USE_ORPHAN_DETECTION === '1') {
			stopOrphanDetection = startOrphanDetection(() => handleShutdown('ORPHANED'))
		} else {
			logger.info('Orphan detection disabled')
		}

		if (startupShutdown.isStarted()) return startupShutdown.untilExit()
		shutdownSignals.route(handleShutdown)

		// Process-level safety net: keep the daemon alive on any stray fire-and-forget
		// rejection (e.g. a rejected subscription callback promise that TanStack DB
		// drops on the floor). Logs + Sentry-captures only — deliberately does NOT
		// process.exit (no supervisor/auto-restart yet), and does not interfere with
		// the auth-failure SIGTERM self-shutdown (signal-driven).
		//
		// There is intentionally NO uncaughtException handler: an orphaned daemon whose
		// stdout pipe closes gets EPIPE thrown as an uncaught exception on every log
		// write, and a handler that re-logs it creates an infinite EPIPE→log→EPIPE loop
		// (observed: ~3k errors/ms, 8GB log files, 48GB memory footprint). Let uncaught
		// exceptions crash the process instead.
		process.on('unhandledRejection', (reason) => {
			reportEmergencyError(reason, 'unhandled_rejection')
		})

		// Initialize subscriptions with services and tracker
		stopSubscriptions = initializeSubscriptions(services)

		// Start the commit HEAD-watch — the sensor that fills the commit ledger. Started
		// unconditionally: the watcher re-checks isCommitAttributionEnabled() on every reconcile
		// cycle and stays fully inert (no fs watchers, no scans, no recordObserved) while it is
		// off. Gating the START on the flag was a shipped bug — an org flipping
		// commit_tracking_enabled mid-run got trailers (per-session settings refresh) but an
		// empty ledger until the daemon restarted. Stopped in handleShutdown.
		commitWatcher = startCommitWatcher(services)
		logger.info('Commit HEAD-watch started (gated per reconcile cycle)')

		// Observe which repositories and branches live sessions actually work in — the link the
		// session's pull-request panel reads. Ungated: the panel itself is gated client-side.
		repositoryObserver = startRepositoryObserver(services, { hostId: identity.hostId })
		services.repositoryObserver = repositoryObserver
		logger.info('Session repository observer started')

		if (automationLifecycle !== undefined) {
			const result = await daemonRuntime.runPromise(automationLifecycle.awaitResult)
			await completeShutdown(`AUTOMATION_${result.completionReason.toUpperCase()}`, false)
			shutdownDeadline.complete()
			shutdownSignals.remove()
			return result
		}
	} catch (error) {
		if (startupShutdown.isStarted()) return startupShutdown.untilExit()
		stopHeartbeat()
		await daemonRuntime.dispose()
		shutdownSignals.remove()
		throw error
	}
}

export async function startDaemon(config: DaemonConfig): Promise<void> {
	const apiOrigin = config.apiOrigin ?? API_ORIGIN
	const syncOrigin = config.syncOrigin ?? SYNC_ORIGIN
	if (!apiOrigin) throw new Error('API origin not configured (set RIPTIDE_API_ORIGIN or provide apiOrigin)')
	if (!syncOrigin) throw new Error('Sync origin not configured (set RIPTIDE_SYNC_ORIGIN or provide syncOrigin)')
	await startDaemonInitialized(
		{ ...config, apiOrigin, syncOrigin, stage: 'local', generationId: null, automation: null },
		null,
	)
}

export async function startManagedDaemon(config: ManagedDaemonConfig): Promise<ManagedDaemonLaunchResult> {
	const IdentityLoaderLive = Layer.succeed(DaemonIdentityLoader, {
		load: ({ token }) =>
			Effect.tryPromise({
				try: () => loadDaemonIdentity(token),
				catch: (cause) => new ManagedDaemonIdentityError({ cause, message: 'Failed to load daemon identity' }),
			}).pipe(Effect.withSpan('managed_daemon.load_identity')),
	})
	const RuntimeLauncherLive = Layer.succeed(ManagedDaemonRuntimeLauncher, {
		launch: ({ config: runtimeConfig, identity }) =>
			Effect.tryPromise({
				try: () => startDaemonInitialized(runtimeConfig, identity),
				catch: (cause): DaemonInstanceAlreadyRunning | ManagedDaemonStartupError => {
					logger.error({ cause }, 'Managed daemon runtime adapter failed')
					Sentry.captureException(cause, { tags: { error_type: 'managed_daemon_startup' } })
					if (Schema.is(DaemonInstanceAlreadyRunning)(cause)) return cause
					return new ManagedDaemonStartupError({
						cause,
						message: 'Failed to initialize daemon runtime',
					})
				},
			}).pipe(Effect.tapError(Effect.logError), Effect.withSpan('managed_daemon.launch_runtime')),
	})
	return Effect.runPromise(
		loadResolvedManagedDaemonLaunchRequestAtHostBoundary(config).pipe(
			Effect.flatMap(runManagedDaemonStart),
			Effect.provide(Layer.mergeAll(IdentityLoaderLive, RuntimeLauncherLive)),
		),
	)
}
