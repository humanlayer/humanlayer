import type { Session } from '@humanlayer/db/tables/sessions'
import type { Task } from '@humanlayer/db/tables/tasks'
import type { WorkspaceView } from '@humanlayer/db/utils/workspace-view'
import type { TaskWorkflowType, WorktreeTiming } from '@humanlayer/schemas/effect/taskconfiguration'
import dedent from 'dedent'
import { Clock, Effect, Option } from 'effect'
import * as Path from 'effect/Path'

import { DEFAULT_EFFECTIVE_SETTINGS } from '@/agents/claudecode/effective-settings'
import { createArtifactBashSyncHook } from '@/agents/claudecode/hooks/artifact-bash-sync-hook'
import { createArtifactReadSyncHook } from '@/agents/claudecode/hooks/artifact-read-sync-hook'
import { createArtifactSyncHook } from '@/agents/claudecode/hooks/artifact-sync-hook'
import { createSkillTaskUrlHook } from '@/agents/claudecode/hooks/skill-task-url-hook'
import { createClaudeTaskDiffCaptureHook } from '@/agents/claudecode/hooks/task-diff-capture-hook'
import { createWorkflowRoutingHook } from '@/agents/claudecode/hooks/workflow-routing-hook'
import { createHumanlayerMcpServer } from '@/agents/claudecode/mcp/humanlayer-server'
import { renderContextShardsPromptBlock } from '@/agents/shared/context-shards'
import type { InterruptStateService } from '@/agents/shared/interrupt-state.service'
import { Sentry } from '@/instrument'
import { getArtifactSymlinkPath } from '@/lib/artifact-paths'
import { createArtifactSyncLedger } from '@/lib/artifact-sync-ledger'
import { orgTelemetryCache } from '@/lib/org-telemetry-settings'
import { renderSessionInformation } from '@/lib/session-information'
import { isInGitWorktree } from '@/lib/workspace/detect-worktree'
import { PROJECT_WORKSPACE_SOURCE_PATH } from '@/lib/workspace/project-workspace-view'
import {
	expandedWorkspaceBaseDirectory,
	renderWorkspaceInformation,
	renderWorkspaceSetupProgress,
	workspaceRepoDirectories,
} from '@/lib/workspace/render-workspace-information'
import logger from '@/logger'

import { DaemonApi } from '../daemon-api/daemon-api.service'
import { DaemonCollections } from '../daemon-collections/daemon-collections.service'
import { DaemonTaskSync } from '../daemon-task-sync'
import type { GitCommandRunnerRequirements } from '../task-diff/git-command-runner.service'
import { TaskDiffServiceRegistry } from '../task-diff/task-diff-service-registry.service'
import { resolveSessionWorkspaceView } from '../task-workspace-context/resolve-session-workspace-view'
import { locateClaudeExecutable, resolveClaudeWorkingDirectory } from './claude-session-environment'
import {
	materializeHumanlayerPlugin,
	materializeRpiPlugin,
	prepareArtifactPaths,
	readCommitAttributionEnvironment,
	readConfiguredRepositoryContext,
} from './claude-session-preparation-adapters'
import type { ExecuteClaudeSessionInput } from './claude-sessions.service'
import { MULTIPLAYER_MESSAGE_CONTRACT, sessionHasActiveMultiplayerPrompting } from './multiplayer-message-contract'
import { buildClaudeQueryOptions } from './query-options'
import type { OpenClaudeSdkSessionInput } from './sdk/claude-sdk-session.service'
import { requestToolApproval } from './workflows/approvals'

export interface PreparedClaudeRun {
	readonly session: Session
	readonly interruptState: InterruptStateService
	readonly sdk: OpenClaudeSdkSessionInput
}

export interface ClaudeSessionConfiguration {
	readonly homeDirectory: string
	readonly configuredClaudePath: Option.Option<string>
	readonly executableSearchPath: string
	readonly inheritedEnvironment: NodeJS.ProcessEnv
}

function isWorkflowType(value: string | null | undefined): value is TaskWorkflowType {
	return value === 'rpi' || value === 'outline_only' || value === 'prd_tdd' || value === 'oneshot'
}

function isWorktreeTiming(value: string | null | undefined): value is WorktreeTiming {
	return value === 'now' || value === 'later' || value === 'never'
}

function baseSystemPromptAdditions(): string[] {
	return [
		dedent`
			When you launch one or more sub-agents with the Agent tool, you MUST NOT launch it in the background.
			You MUST NOT specify the 'run_in_background' option, or the 'resume' option.
			You MUST NOT specify the 'model' unless the user explicitly asks you to.
			Obeying these instructions is CRITICAL to ensure the Agent tool performs properly.
		`,
		dedent`
			When you are writing markdown artifacts and/or inline markdown blocks in the chat, do not add line breaks for the purposes of simulating line wrapping - the artifact viewer and chat renderer wrap lines automatically.
			Keep structural line breaks for paragraphs, headings, lists, tables, and fenced code blocks (including Mermaid diagrams).

			When writing markdown documents or sending messages to the user, mermaid blocks with \`\`\`mermaid will render as diagrams for the user. The UI is themed so do not use custom colors or styles in mermaid diagrams.
		`,
	]
}

export function loadClaudeContextShards(input: ExecuteClaudeSessionInput) {
	return Effect.gen(function* () {
		if (input.resumeSessionId || input.forkMeta) return null

		const api = yield* DaemonApi
		const { session } = input.context
		const enabledShards = yield* api.listEnabledContextShards({}).pipe(
			Effect.map(({ data }) => data),
			Effect.catch((error) =>
				Effect.sync(() => {
					logger.warn(
						{ sessionId: session.id, error },
						'Failed to fetch enabled context shards, launching without them',
					)
				}).pipe(Effect.as(null)),
			),
		)
		if (!enabledShards) return null

		logger.info(
			{
				organizationId: session.organization_id,
				userId: session.resource_owner_user_id,
				sessionId: session.id,
				shardIds: enabledShards.map((shard) => shard.id),
				shardCount: enabledShards.length,
			},
			'session.context_shards',
		)
		return renderContextShardsPromptBlock(enabledShards)
	})
}

export function prepareClaudeRun(input: ExecuteClaudeSessionInput, configuration: ClaudeSessionConfiguration) {
	return Effect.gen(function* () {
		const api = yield* DaemonApi
		const collections = yield* DaemonCollections
		const taskSyncService = yield* DaemonTaskSync
		const taskDiffServiceRegistry = yield* TaskDiffServiceRegistry
		// The Claude SDK invokes Promise callbacks outside the daemon's Effect environment.
		const taskDiffContext = yield* Effect.context<GitCommandRunnerRequirements>()
		const runTaskDiffCapture = Effect.runPromiseWith(taskDiffContext)
		const path = yield* Path.Path
		const approvalContext = yield* Effect.context<DaemonApi | DaemonCollections>()
		const runApproval = Effect.runPromiseWith(approvalContext)
		const humanlayerToolsApi = {
			comments: {
				get: (request: Parameters<typeof api.getArtifactComments>[0]) =>
					runApproval(api.getArtifactComments(request)),
				update: (request: Parameters<typeof api.updateArtifactComments>[0]) =>
					runApproval(api.updateArtifactComments(request)),
				reply: (request: Parameters<typeof api.replyToArtifactComment>[0]) =>
					runApproval(api.replyToArtifactComment(request)),
			},
			agents: {
				research: (request: Parameters<typeof api.researchLibrary>[0]) =>
					runApproval(api.researchLibrary(request)),
			},
			runDiffCommentEffect: <A, E>(effect: Effect.Effect<A, E, DaemonApi>) => runApproval(effect),
		}
		const { session } = input.context
		const currentCollections = yield* collections.current
		const sessionId = session.id
		const cwd = yield* resolveClaudeWorkingDirectory({
			workingDirectory: session.working_directory,
			homeDirectory: configuration.homeDirectory,
		})
		const effectiveSettings = yield* api
			.getSettings({})
			.pipe(
				Effect.catch((cause) =>
					Effect.sync(() => Sentry.captureException(cause)).pipe(
						Effect.andThen(Effect.logWarning('Failed to fetch effective settings, using defaults')),
						Effect.as(DEFAULT_EFFECTIVE_SETTINGS),
					),
				),
			)
		// The session-launch settings fetch is how the org's telemetry flags reach this daemon —
		// skipping this set left the commit/PR-tracking gates stale until a daemon restart.
		yield* Effect.sync(() => orgTelemetryCache.set(effectiveSettings))
		const claudePath = yield* locateClaudeExecutable({
			configuredPath: configuration.configuredClaudePath,
			executableSearchPath: configuration.executableSearchPath,
			homeDirectory: configuration.homeDirectory,
		})
		const workingDirectory = cwd
		const rpiPluginPath = yield* materializeRpiPlugin()
		const humanlayerPluginPath = yield* materializeHumanlayerPlugin()

		let syncManager
		let taskSlug: string | null = null
		let taskRecord: Task | undefined
		let ticketId: string | null = null
		let ticketProvider: string | null = null
		let workflowType: TaskWorkflowType | null = null
		let worktreeTiming: WorktreeTiming | null = null
		let workspaceView: WorkspaceView | null = null
		let workspaceSetupProgress: string | null = null
		if (session.task_id) {
			const taskId = session.task_id
			const taskSync = yield* taskSyncService.ensureTaskSync({ taskId, workingDirectory: cwd })
			syncManager = taskSync.createSessionManager(sessionId)
			taskRecord = currentCollections.tasks.toArray.find((task) => task.id === taskId)
			taskSlug = taskRecord?.slug ?? taskSync.getTaskSlug()
			ticketId = taskRecord?.ticket_id ?? null
			ticketProvider = taskRecord?.ticket_provider ?? null
			workflowType = isWorkflowType(taskRecord?.workflow_type) ? taskRecord.workflow_type : null
			worktreeTiming = isWorktreeTiming(taskRecord?.worktree_timing) ? taskRecord.worktree_timing : null
			// Every session of a task, first or later, resolves the same task-scoped repository set.
			const workspaceResolution = taskRecord
				? yield* resolveSessionWorkspaceView({
						task: taskRecord,
						hostId: session.host_id,
						setupRows: currentCollections.workspaceSetup.toArray,
						freshness: 'launch',
					})
				: null
			workspaceView = workspaceResolution?.view ?? null
			const setupRow = currentCollections.workspaceSetup.toArray.find(
				(row) => row.task_id === taskId && row.host_id === session.host_id,
			)
			workspaceSetupProgress =
				workspaceResolution?.setupProgress ??
				(taskRecord?.workspace_spec && setupRow?.workspace_setup_state
					? renderWorkspaceSetupProgress(
							setupRow.workspace_setup_state,
							setupRow.error ?? null,
							taskRecord.workspace_spec,
						)
					: null)
			if (taskSlug) {
				const resolvedTaskSlug = taskSlug
				yield* prepareArtifactPaths({
					workingDirectory: cwd,
					taskId,
					taskSlug: resolvedTaskSlug,
					setupArtifactPaths: input.setupArtifactPaths,
				})
			}
		}

		const isMultiRepoWorkspace = (workspaceView?.repos.length ?? 0) > 1
		const workspaceDirectories =
			workspaceView && isMultiRepoWorkspace ? workspaceRepoDirectories(workspaceView, cwd) : undefined
		let configuredRepositoryInput: Parameters<typeof readConfiguredRepositoryContext>[0] = workspaceDirectories
			? {
					workingDirectory: cwd,
					sessionId,
					workspaceDirectories,
				}
			: { workingDirectory: cwd, sessionId }
		if (workspaceDirectories && workspaceView?.source === 'project_workspace') {
			configuredRepositoryInput = {
				...configuredRepositoryInput,
				workspaceSourcePath: PROJECT_WORKSPACE_SOURCE_PATH,
			}
		}
		const configuredRepoContext = yield* readConfiguredRepositoryContext(configuredRepositoryInput).pipe(
			Effect.catch((error) =>
				Effect.logWarning('Failed to load configured repo context; continuing without it').pipe(
					Effect.annotateLogs({ cwd, error, sessionId }),
					Effect.as({
						launchRoot: cwd,
						configSources: [],
						additionalDirectories: [],
						configuredRepos: [],
					}),
				),
			),
		)

		const artifactSyncLedger = createArtifactSyncLedger()
		const artifactSyncHook =
			syncManager && session.task_id
				? createArtifactSyncHook(
						syncManager,
						sessionId,
						cwd,
						session.task_id,
						taskSlug,
						ticketId,
						ticketProvider,
						undefined,
						{
							ledger: artifactSyncLedger,
							createLinearAttachment: (request) => runApproval(api.createLinearAttachment(request)),
							createJiraRemoteLink: (request) => runApproval(api.createJiraRemoteLink(request)),
						},
					)
				: undefined
		const artifactReadSyncHook =
			syncManager && session.task_id
				? createArtifactReadSyncHook(syncManager, sessionId, cwd, session.task_id, taskSlug, {
						ledger: artifactSyncLedger,
					})
				: undefined
		const artifactBashSyncHook =
			syncManager && session.task_id
				? createArtifactBashSyncHook(syncManager, sessionId, cwd, session.task_id, taskSlug, {
						ledger: artifactSyncLedger,
					})
				: undefined
		const taskIdForCapture = session.task_id
		const taskDiffCaptureHook = taskIdForCapture
			? createClaudeTaskDiffCaptureHook({
					taskId: taskIdForCapture,
					sessionId,
					requestCapture: () =>
						runTaskDiffCapture(
							taskDiffServiceRegistry.requestCapture({ taskId: taskIdForCapture, sessionId }),
						),
				})
			: undefined
		const sessionIsInWorktree = yield* Effect.promise(() => isInGitWorktree(cwd))
		const systemPromptAdditions = baseSystemPromptAdditions()
		systemPromptAdditions.push(renderSessionInformation(session, taskRecord))
		const nowMillis = yield* Clock.currentTimeMillis
		if (sessionHasActiveMultiplayerPrompting(session, nowMillis)) {
			systemPromptAdditions.push(MULTIPLAYER_MESSAGE_CONTRACT)
		}
		if (taskSlug) {
			const artifactPath = getArtifactSymlinkPath(cwd, taskSlug)
			systemPromptAdditions.push(dedent`
								<artifacts_directory_information>
								Your task artifacts directory is: ${artifactPath}

								If the user requests an rpi: skill and doesn't mention a file, check here first.
								If the user asks you to continue work on a task / design discussion / plan or other task and doesn't mention a file, check here first.

								**Important**: this directory, ${artifactPath}, is a **symlink**. You can only list files in it using the 'ls -La' command, not with List or Glob or Grep.
								You **must not** use 'ls -la' as that will show you the symlink target, which is irrelevant.
								You should read and write files in this directory as though they were normal files.
								You **may not** attempt to write/edit directly using the symlink's target. You **must** write them across the symlink.
								**IMPORTANT**: you MUST NOT ever edit artifacts with the Bash tool using python, node, sed, or other CLI utilities. Artifacts may only be edited using the explicit write and edit tools. Otherwise the user will not be able to see the changes.

								When conversing with the user or writing markdown artifacts, you can inline artifact previews (HTML, images, etc.; not Markdown) using:
								\`\`\`task-artifact
								${artifactPath}/filename.html
								\`\`\`
								Note: The artifact file must be written to the task directory first. This syntax works both in conversation messages and in markdown documents you write to the task directory.
								Note: Do not use task-artifact fenced blocks for Markdown artifacts. To reference a Markdown artifact, tell the user the artifact file name and that it is available in the Artifacts tab of the sidebar.
								Note: To show an image, save it here (Bash is fine) and embed it with ![alt](${artifactPath}/image.png). Images elsewhere, like /tmp, won't display.
								</artifacts_directory_information>
			`)
		}
		const contextShardsBlock = yield* loadClaudeContextShards(input)
		if (contextShardsBlock) systemPromptAdditions.push(contextShardsBlock)
		if (workspaceView && isMultiRepoWorkspace) {
			systemPromptAdditions.push(
				renderWorkspaceInformation(workspaceView, cwd, expandedWorkspaceBaseDirectory(workspaceView)),
			)
		}
		if (workspaceSetupProgress) systemPromptAdditions.push(workspaceSetupProgress)

		const commitEnv = yield* readCommitAttributionEnvironment({ sessionId, workingDirectory: cwd })
		const humanlayerServer = createHumanlayerMcpServer(humanlayerToolsApi, {
			taskId: session.task_id,
			enableLibraryResearcher: effectiveSettings.experimentalSubagentsEnabled,
		})
		const postToolUseHooks: NonNullable<
			NonNullable<ReturnType<typeof buildClaudeQueryOptions>['hooks']>['PostToolUse']
		> = [
			{ matcher: 'Skill' as const, timeout: 10, hooks: [createSkillTaskUrlHook(session.task_id)] },
			{
				matcher: 'Skill' as const,
				timeout: 10,
				hooks: [createWorkflowRoutingHook(workflowType, worktreeTiming, sessionIsInWorktree)],
			},
		]
		if (taskDiffCaptureHook) {
			postToolUseHooks.unshift({
				matcher: 'Write|Edit|MultiEdit|Bash' as const,
				timeout: 10,
				hooks: [taskDiffCaptureHook],
			})
		}
		if (artifactSyncHook) {
			postToolUseHooks.push({
				matcher: 'Write|Edit|MultiEdit' as const,
				timeout: 60,
				hooks: [artifactSyncHook],
			})
		}
		if (artifactReadSyncHook) {
			postToolUseHooks.push({ matcher: 'Read' as const, timeout: 60, hooks: [artifactReadSyncHook] })
		}
		if (artifactBashSyncHook) {
			postToolUseHooks.push({ matcher: 'Bash' as const, timeout: 60, hooks: [artifactBashSyncHook] })
		}
		const queryOptions = buildClaudeQueryOptions({
			session,
			effectiveSettings,
			pathToClaudeCodeExecutable: claudePath,
			cwd: workingDirectory,
			rpiPluginPath,
			humanlayerPluginPath,
			additionalDirectories: [
				...configuredRepoContext.additionalDirectories,
				rpiPluginPath,
				humanlayerPluginPath,
				path.join(configuration.homeDirectory, '.humanlayer', 'riptide', 'artifacts'),
			],
			systemPromptAdditions,
			resumeSessionId: input.resumeSessionId,
			forkMeta: input.forkMeta,
			mcpServers: humanlayerServer ? { humanlayer: humanlayerServer } : undefined,
			commitAttributionEnv: commitEnv,
			inheritedEnv: configuration.inheritedEnvironment,
			stderr: (contents) => {
				logger.warn({ sessionId, stderr: contents }, 'Claude process STDERR')
			},
			canUseTool: (toolName, toolInput, options) =>
				runApproval(
					requestToolApproval({
						sessionId,
						toolName,
						toolInput,
						cwd,
						signal: options.signal,
						suggestions: options.suggestions,
						toolUseID: options.toolUseID,
						agentID: options.agentID,
					}),
				),
			hooks: { PostToolUse: postToolUseHooks },
		})

		return {
			session,
			interruptState: input.context.interruptState,
			sdk: { sessionId: session.id, prompt: session.prompt ?? '', options: queryOptions },
		}
	})
}
