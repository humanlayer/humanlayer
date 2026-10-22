import { bakedModelCatalog, codingTools } from '@humanlayer/fold-agent'
import {
	defineAgent,
	eventLogSource,
	layerLiveIdFactory,
	resumeSession,
	SessionId,
	startSession,
	type PostToolUseHook,
} from '@humanlayer/fold-core'
import { xaiModel } from '@humanlayer/fold-xai'
import {
	TaskWorkflowType,
	type TaskWorkflowType as TaskWorkflowTypeValue,
	WorktreeTiming,
	type WorktreeTiming as WorktreeTimingValue,
} from '@humanlayer/schemas/effect/taskconfiguration'
import * as Sentry from '@sentry/bun'
import dedent from 'dedent'
import { Cause, Effect, Layer, Schema } from 'effect'

import { DEFAULT_EFFECTIVE_SETTINGS } from '@/agents/claudecode/effective-settings'
import { renderContextShardsPromptBlock } from '@/agents/shared/context-shards'
import { ensureArtifactSymlink, getArtifactSymlinkPath } from '@/lib/artifact-paths'
import { ConfiguredRepoContext } from '@/lib/configured-repos/service'
import { commitAttributionEnv } from '@/lib/git/commit-attribution'
import { orgTelemetryCache } from '@/lib/org-telemetry-settings'
import { renderSessionInformation } from '@/lib/session-information'
import type { ISyncManager } from '@/lib/sync-service-types'
import { normalizePath } from '@/lib/utils'
import { isInGitWorktree } from '@/lib/workspace/detect-worktree'
import { PROJECT_WORKSPACE_SOURCE_PATH } from '@/lib/workspace/project-workspace-view'
import {
	expandedWorkspaceBaseDirectory,
	renderWorkspaceInformation,
	workspaceRepoDirectories,
} from '@/lib/workspace/render-workspace-information'

import { DaemonApi } from '../daemon-api/daemon-api.service'
import { DaemonCollections } from '../daemon-collections/daemon-collections.service'
import { DaemonTaskSync } from '../daemon-task-sync'
import { decodePersistedFoldEntry, makeFoldEventLogSession } from '../fold-event-log/fold-event-log-session'
import { resolveSessionWorkspaceView } from '../task-workspace-context/resolve-session-workspace-view'
import { makeFoldAgentDelegation } from './fold-agent-tool'
import { loadFoldCompatibility } from './fold-compatibility-selection'
import { layerFoldHostServices } from './fold-host-services'
import { makeFoldModel } from './fold-model-selection'
import {
	makeFoldArtifactBashSyncHook,
	makeFoldArtifactReadSyncHook,
	makeFoldArtifactWriteSyncHook,
	makeFoldCommitAttributionHook,
	makeFoldTaskDiffCaptureHook,
	makeFoldWorkflowRoutingHook,
} from './fold-product-hooks'
import { makeFoldHumanLayerTools } from './fold-product-tools'
import { FoldSessionForkMetadata, validateFoldForkedSessionLog } from './fold-session-fork'
import { FoldSessionOpener } from './fold-session-opener.service'
import { FoldSessionOpenError } from './fold-sessions.errors'
import { FoldModelSelection, FoldSessionIdentity, type OpenFoldSessionInput } from './fold-sessions.schemas'
import { makeFoldSkillTool } from './fold-skills'

const FoldSessionRow = Schema.Struct({
	identity: FoldSessionIdentity,
	model: FoldModelSelection,
	forkedFromSessionId: Schema.NullOr(Schema.String),
	codingAgentSessionId: Schema.NullOr(SessionId),
	forkData: Schema.NullOr(Schema.Struct({ fork: FoldSessionForkMetadata })),
})

const DEFAULT_FOLD_CODING_PROMPT =
	'You are Fold, an expert coding assistant operating inside HumanLayer, a coding agent harness. ' +
	"You are a headless coding agent working in the user's project directory. " +
	'Use your tools to inspect and change files, run commands, and accomplish the task. ' +
	'When you edit files, read them first, make focused changes, and verify your work when you can. ' +
	'Delegate to a subagent when a step would burn context you need for the main task: researcher for ' +
	'locating and explaining code, web-search-researcher for current web research, bash for running a ' +
	'command and summarizing its output, and general-purpose for a self-contained multi-step task. Do simple work yourself. ' +
	'Keep responses concise; let the tools do the work.'

const BASE_SYSTEM_PROMPT = [
	DEFAULT_FOLD_CODING_PROMPT,
	'Work in the current working directory to help the user with their request.',
	'Use the available tools to read files, make changes, and run commands.',
	dedent`
		When you are writing markdown artifacts and/or inline markdown blocks in the chat, do not add line breaks for the purposes of simulating line wrapping - the artifact viewer and chat renderer wrap lines automatically.
		Keep structural line breaks for paragraphs, headings, lists, tables, and fenced code blocks (including Mermaid diagrams).

		When writing markdown documents or sending messages to the user, mermaid blocks with \`\`\`mermaid will render as diagrams for the user. The UI is themed so do not use custom colors or styles in mermaid diagrams.
	`,
]

const artifactDirectoryInstructions = (artifactPath: string): string => dedent`
	<artifacts_directory_information>
		Your task artifacts directory is: ${artifactPath}

		If the user requests an rpi: skill and doesn't mention a file, check here first.
		If the user asks you to continue work on a task / design discussion / plan or other task and doesn't mention a file, check here first.

		**Important**: this directory, ${artifactPath}, is a **symlink**. You can only list files in it using the 'ls -La' command, not with List or Glob or Grep.
		You **must not** use 'ls -la' as that will show you the symlink target, which is irrelevant.
		You should read and write files in this directory as though they were normal files.
		You **may not** attempt to write/edit directly using the symlink's target. You **must** write them across the symlink.
		Artifacts may only be edited using the explicit write, edit, or apply-patch tools.

		When conversing with the user or writing markdown artifacts, you can inline artifact previews using:
		\`\`\`task-artifact
		${artifactPath}/filename.html
		\`\`\`
		Note: To show an image, save it here (Bash is fine) and embed it with ![alt](${artifactPath}/image.png). Images elsewhere, like /tmp, won't display.
	</artifacts_directory_information>
`

const captureConfiguredRepositoryFailure = (sessionId: string, workingDirectory: string, cause: Cause.Cause<unknown>) =>
	Effect.logError('Failed to load configured repository context; continuing with the working directory', cause).pipe(
		Effect.annotateLogs({ sessionId, workingDirectory }),
		Effect.andThen(
			Effect.sync(() =>
				Sentry.captureException(Cause.squash(cause), {
					tags: { error_type: 'fold_configured_repository_discovery', session_id: sessionId },
					extra: { cause: Cause.pretty(cause), workingDirectory },
				}),
			),
		),
	)

export const openFoldSession = Effect.fn('fold.open_session')(function* (input: OpenFoldSessionInput) {
	const collectionsService = yield* DaemonCollections
	const daemonApi = yield* DaemonApi
	const taskSyncService = yield* DaemonTaskSync
	const configuredRepoContextService = yield* ConfiguredRepoContext
	const collections = yield* collectionsService.current
	const row = collections.sessions.get(input.sessionId)
	if (row === undefined) {
		return yield* new FoldSessionOpenError({
			sessionId: input.sessionId,
			cause: null,
			message: 'The synchronized session row is unavailable.',
		})
	}

	const decoded = yield* Schema.decodeUnknownEffect(FoldSessionRow)({
		identity: {
			sessionId: row.id,
			organizationId: row.organization_id,
			hostId: row.host_id,
			taskId: row.task_id,
			workingDirectory: normalizePath(row.working_directory),
		},
		model: { provider: row.provider, model: row.model, reasoning: row.effort ?? 'low' },
		forkedFromSessionId: row.forked_from_session_id,
		codingAgentSessionId: row.coding_agent_session_id,
		forkData: row.fork_data,
	}).pipe(
		Effect.mapError(
			(cause) =>
				new FoldSessionOpenError({
					sessionId: input.sessionId,
					cause,
					message: 'The Fold session configuration is invalid.',
				}),
		),
	)
	const rows = yield* daemonApi.listFoldSessionEvents({ sessionId: input.sessionId }).pipe(
		Effect.mapError(
			(cause) =>
				new FoldSessionOpenError({
					sessionId: input.sessionId,
					cause,
					message: 'Failed to read the Fold session log.',
				}),
		),
	)
	if (decoded.forkedFromSessionId !== null && decoded.forkData === null) {
		return yield* new FoldSessionOpenError({
			sessionId: input.sessionId,
			cause: null,
			message: 'The forked Fold session metadata is missing.',
		})
	}
	if (decoded.forkData !== null) {
		if (decoded.codingAgentSessionId === null) {
			return yield* new FoldSessionOpenError({
				sessionId: input.sessionId,
				cause: null,
				message: 'The forked Fold session has no Fold session identity.',
			})
		}
		const entries = yield* Effect.forEach(rows, decodePersistedFoldEntry).pipe(
			Effect.mapError(
				(cause) =>
					new FoldSessionOpenError({
						sessionId: input.sessionId,
						cause,
						message: 'The copied Fold session log is invalid.',
					}),
			),
		)
		yield* validateFoldForkedSessionLog({
			riptideSessionId: input.sessionId,
			sourceSessionId: decoded.forkedFromSessionId,
			codingAgentSessionId: decoded.codingAgentSessionId,
			forkMetadata: decoded.forkData.fork,
			entries,
		}).pipe(
			Effect.mapError(
				(cause) =>
					new FoldSessionOpenError({
						sessionId: input.sessionId,
						cause,
						message: cause.message,
					}),
			),
		)
	}
	const isFreshLaunch = rows.length === 0
	const task =
		decoded.identity.taskId === null
			? undefined
			: collections.tasks.toArray.find((candidate) => candidate.id === decoded.identity.taskId)
	const systemPrompt = [...BASE_SYSTEM_PROMPT, renderSessionInformation(row, task)]
	const compatibility = yield* loadFoldCompatibility({
		provider: decoded.model.provider,
		model: decoded.model.model,
		workingDirectory: decoded.identity.workingDirectory,
	})
	if (compatibility.instructionBlock !== null) systemPrompt.push(compatibility.instructionBlock)
	let workflowType: TaskWorkflowTypeValue | null = null
	let worktreeTiming: WorktreeTimingValue | null = null
	let isInWorktree = false
	let taskId: string | null = null
	let taskSlug: string | null = null
	let ticketId: string | null = null
	let ticketProvider: string | null = null
	let syncManager: ISyncManager | undefined
	let workspaceDirectories: ReadonlyArray<string> | undefined
	let workspaceSourcePath: string | undefined

	if (decoded.identity.taskId !== null) {
		const resolvedTaskId = decoded.identity.taskId
		taskId = resolvedTaskId
		const taskSync = yield* taskSyncService
			.ensureTaskSync({
				taskId: resolvedTaskId,
				workingDirectory: decoded.identity.workingDirectory,
			})
			.pipe(
				Effect.mapError(
					(cause) =>
						new FoldSessionOpenError({
							sessionId: input.sessionId,
							cause,
							message: 'Failed to prepare task artifact synchronization.',
						}),
				),
			)
		syncManager = taskSync.createSessionManager(input.sessionId)
		taskSlug = task?.slug ?? taskSync.getTaskSlug()
		ticketId = task?.ticket_id ?? null
		ticketProvider = task?.ticket_provider ?? null
		workflowType = yield* Schema.decodeUnknownEffect(Schema.NullOr(TaskWorkflowType))(
			task?.workflow_type ?? null,
		).pipe(
			Effect.mapError(
				(cause) =>
					new FoldSessionOpenError({
						sessionId: input.sessionId,
						cause,
						message: 'The task workflow configuration is invalid.',
					}),
			),
		)
		worktreeTiming = yield* Schema.decodeUnknownEffect(Schema.NullOr(WorktreeTiming))(
			task?.worktree_timing ?? null,
		).pipe(
			Effect.mapError(
				(cause) =>
					new FoldSessionOpenError({
						sessionId: input.sessionId,
						cause,
						message: 'The task worktree configuration is invalid.',
					}),
			),
		)

		if (taskSlug !== null) {
			const resolvedTaskSlug = taskSlug
			yield* Effect.tryPromise(() =>
				ensureArtifactSymlink(decoded.identity.workingDirectory, resolvedTaskId, resolvedTaskSlug),
			).pipe(
				Effect.mapError(
					(cause) =>
						new FoldSessionOpenError({
							sessionId: input.sessionId,
							cause,
							message: 'Failed to prepare the task artifact directory.',
						}),
				),
			)
			systemPrompt.push(
				artifactDirectoryInstructions(
					getArtifactSymlinkPath(decoded.identity.workingDirectory, resolvedTaskSlug),
				),
			)
		}

		if (task !== undefined) {
			systemPrompt.push(
				`<task_information>\nTicket: ${task.ticket_provider ?? 'none'}:${task.ticket_id ?? 'none'}\nWorkflow: ${task.workflow_type ?? 'none'}\n</task_information>`,
			)
			// Every session of a task, first or later, resolves the same task-scoped repository set.
			const { view: workspace, setupProgress } = yield* resolveSessionWorkspaceView({
				task,
				hostId: decoded.identity.hostId,
				setupRows: collections.workspaceSetup.toArray,
				freshness: 'launch',
			}).pipe(
				Effect.mapError(
					(cause) =>
						new FoldSessionOpenError({
							sessionId: input.sessionId,
							cause,
							message: 'Failed to load the complete project workspace context.',
						}),
				),
			)
			if (workspace !== null && workspace.repos.length > 1) {
				systemPrompt.push(
					renderWorkspaceInformation(
						workspace,
						decoded.identity.workingDirectory,
						expandedWorkspaceBaseDirectory(workspace),
					),
				)
				workspaceDirectories = workspaceRepoDirectories(workspace, decoded.identity.workingDirectory)
				if (workspace.source === 'project_workspace') workspaceSourcePath = PROJECT_WORKSPACE_SOURCE_PATH
			}
			if (setupProgress !== null) {
				systemPrompt.push(setupProgress)
			} else if (workspace !== null) {
				const unfinished = workspace.repos.filter((repo) => repo.status !== undefined && repo.status !== 'done')
				if (unfinished.length > 0) {
					systemPrompt.push(
						`<workspace_setup_status>\n${unfinished.map((repo) => `${repo.relativePath} - ${repo.status} - RUNNING`).join('\n')}\n</workspace_setup_status>`,
					)
				}
			}
		}
		isInWorktree = yield* Effect.tryPromise(() => isInGitWorktree(decoded.identity.workingDirectory)).pipe(
			Effect.catchTag('UnknownError', () => Effect.succeed(false)),
		)
	}

	if (isFreshLaunch) {
		const shards = yield* daemonApi.listEnabledContextShards({}).pipe(
			Effect.map(({ data }) => renderContextShardsPromptBlock(data)),
			Effect.catchTag('DaemonContextShardsListError', () => Effect.succeed(null)),
		)
		if (shards !== null) systemPrompt.push(shards)
	}

	const configuredRepositoryInput: Parameters<typeof configuredRepoContextService.loadForWorkspace>[0] =
		workspaceDirectories === undefined
			? {
					cwd: decoded.identity.workingDirectory,
					sessionId: input.sessionId,
				}
			: {
					cwd: decoded.identity.workingDirectory,
					sessionId: input.sessionId,
					workspaceDirectories: [...workspaceDirectories],
				}
	if (workspaceSourcePath !== undefined) configuredRepositoryInput.workspaceSourcePath = workspaceSourcePath
	const configuredRepoContext = yield* configuredRepoContextService.loadForWorkspace(configuredRepositoryInput).pipe(
		Effect.catchCause((cause) =>
			captureConfiguredRepositoryFailure(input.sessionId, decoded.identity.workingDirectory, cause).pipe(
				Effect.as({
					launchRoot: decoded.identity.workingDirectory,
					configSources: [],
					additionalDirectories: [],
					configuredRepos: [],
					diagnostics: [],
				}),
			),
		),
	)
	for (const repo of configuredRepoContext.configuredRepos) {
		if (repo.instructionPrompt !== undefined) systemPrompt.push(repo.instructionPrompt)
	}

	const settings = yield* daemonApi
		.getSettings({})
		.pipe(Effect.catchTag('DaemonSettingsGetError', () => Effect.succeed(DEFAULT_EFFECTIVE_SETTINGS)))
	yield* Effect.sync(() => orgTelemetryCache.set(settings))
	const foldSkillInput = {
		sessionId: input.sessionId,
		provider: decoded.model.provider,
		workingDirectory: decoded.identity.workingDirectory,
		projectRoot: compatibility.projectRoot,
		configuredRepositoryRoots: configuredRepoContext.configuredRepos.map((repo) => repo.root),
		homeDirectory: compatibility.home,
	}
	const skillTool = yield* makeFoldSkillTool(
		compatibility.grokHome === null ? foldSkillInput : { ...foldSkillInput, grokHome: compatibility.grokHome },
	).pipe(
		Effect.mapError(
			(cause) =>
				new FoldSessionOpenError({
					sessionId: input.sessionId,
					cause,
					message: 'Failed to compose Fold skills.',
				}),
		),
	)
	const productTools = yield* makeFoldHumanLayerTools({
		taskId,
		enableLibraryResearcher: settings.experimentalSubagentsEnabled,
	})
	const commitAttributionEnvironment = yield* Effect.tryPromise(() =>
		commitAttributionEnv(input.sessionId, {
			cwd: decoded.identity.workingDirectory,
			codingAgent: 'fold',
		}),
	).pipe(
		Effect.tapError((cause) =>
			Effect.logError('Failed to prepare Fold commit attribution', cause).pipe(
				Effect.annotateLogs({ sessionId: input.sessionId }),
				Effect.andThen(
					Effect.sync(() =>
						Sentry.captureException(cause, {
							tags: { error_type: 'fold_commit_attribution_preparation', session_id: input.sessionId },
						}),
					),
				),
			),
		),
		Effect.mapError(
			(cause) =>
				new FoldSessionOpenError({
					sessionId: input.sessionId,
					cause,
					message: 'Failed to prepare commit attribution for the Fold session.',
				}),
		),
		Effect.withSpan('fold.prepare_commit_attribution', { attributes: { session_id: input.sessionId } }),
	)
	const commitAttributionHook = yield* makeFoldCommitAttributionHook({
		sessionId: input.sessionId,
		workingDirectory: decoded.identity.workingDirectory,
	})
	const postToolUse: PostToolUseHook[] = [commitAttributionHook]
	if (taskId !== null && syncManager !== undefined) {
		const workflowRoutingHook = yield* makeFoldWorkflowRoutingHook({
			sessionId: input.sessionId,
			workflowType,
			worktreeTiming,
			isInWorktree,
		})
		const artifactWriteSyncHook = yield* makeFoldArtifactWriteSyncHook({
			syncManager,
			sessionId: input.sessionId,
			workingDirectory: decoded.identity.workingDirectory,
			taskId,
			taskSlug,
			ticketId,
			ticketProvider,
		})
		const artifactReadSyncHook = yield* makeFoldArtifactReadSyncHook({
			syncManager,
			sessionId: input.sessionId,
			workingDirectory: decoded.identity.workingDirectory,
			taskId,
			taskSlug,
		})
		const artifactBashSyncHook = yield* makeFoldArtifactBashSyncHook({
			syncManager,
			sessionId: input.sessionId,
			workingDirectory: decoded.identity.workingDirectory,
			taskId,
			taskSlug,
			ticketId,
			ticketProvider,
		})
		const taskDiffCaptureHook = yield* makeFoldTaskDiffCaptureHook({ taskId, sessionId: input.sessionId })
		postToolUse.push(
			workflowRoutingHook,
			artifactWriteSyncHook,
			artifactReadSyncHook,
			artifactBashSyncHook,
			taskDiffCaptureHook,
		)
	}
	const hooks = { postToolUse }

	const model = yield* makeFoldModel(decoded.model).pipe(
		Effect.mapError(
			(cause) =>
				new FoldSessionOpenError({
					sessionId: input.sessionId,
					cause,
					message: 'Failed to construct the Fold session.',
				}),
		),
	)
	const subagentReasoning =
		decoded.model.reasoning === 'off' || decoded.model.reasoning === 'minimal' ? decoded.model.reasoning : 'low'
	const subagentModel =
		decoded.model.provider === 'xai'
			? xaiModel({ model: decoded.model.model, reasoning: subagentReasoning })
			: model
	const tools = codingTools({
		cwd: decoded.identity.workingDirectory,
		processEnvironment: commitAttributionEnvironment,
	})
	const completeSystemPrompt = systemPrompt.join('\n\n')
	const delegation = makeFoldAgentDelegation({
		model,
		subagentModel,
		codingTools: tools,
		sharedSkillTool: skillTool,
		productTools,
		hooks,
		systemPrompt: completeSystemPrompt,
	})
	const agent = defineAgent({
		model,
		promptCacheKey: decoded.identity.sessionId,
		systemPrompt,
		tools: [...tools, skillTool, ...productTools, delegation.rootAgentTool],
		hooks,
	})
	const log = eventLogSource(
		makeFoldEventLogSession({ sessionId: input.sessionId }).pipe(
			// eslint-disable-next-line anti-slop/no-reprovide-ambient-service -- Fold invokes this fixed event-log factory without DaemonApi in its declared environment.
			Effect.provideService(DaemonApi, daemonApi),
			Effect.provide(layerLiveIdFactory),
		),
	)
	const sessionOptions = { agent, log, catalog: bakedModelCatalog }
	const open =
		rows.length === 0
			? startSession({ ...sessionOptions, cwd: decoded.identity.workingDirectory })
			: resumeSession(sessionOptions)
	// Built in the caller's scope so the services outlive this open and serve the whole session.
	const hostServices = yield* Layer.build(layerFoldHostServices(input.sessionId))
	return yield* open.pipe(
		Effect.provideContext(hostServices),
		Effect.mapError(
			(cause) =>
				new FoldSessionOpenError({
					sessionId: input.sessionId,
					cause,
					message: 'Failed to construct the Fold session.',
				}),
		),
	)
})

export const FoldSessionOpenerLive = Layer.succeed(FoldSessionOpener, FoldSessionOpener.of({ open: openFoldSession }))
