/**
 * new-task-form-helpers.ts
 *
 * Helper functions extracted from NewTaskFormV2.tsx to reduce component size.
 * Contains workspace-now pipeline, V2 setup operations, and ticket content builders.
 */

import type { WorkspaceSetupState, WorkspaceSpec, WorkspaceState } from '@humanlayer/schemas/effect/workspace'
import { toast } from 'sonner'
import { uuidv7 } from 'uuidv7'

import type { createSessionActions } from '@/actions/sessions'
import type { NewTaskFormV2Input } from '@/components/NewTaskFormV2'
import type { OperationStatus } from '@/components/OperationStatusRow'
import type { SubmitAction, SubmitOperation } from '@/hooks/stores/newTaskFormStore'
import type { AgentType, ProviderType } from '@/hooks/stores/settingsStore'
import { captureException } from '@/integrations/sentry/sentry'
import {
	type WorkspaceRepoCreateResult,
	type WorkspaceRepoInput,
	workspaceCopyGlobs,
	workspaceCreate,
	workspacePreflight,
	workspaceRemoveAll,
	workspaceRunSetup,
} from '@/integrations/tauri/workspace-setup'
import { getFirstSessionParams } from '@/lib/auto-advance'
import { repoBasename, type WorkspaceNowExecutionMode } from '@/lib/workspace-config'
import type { EffectiveRepoEntry, EffectiveWorkspaceConfig } from '@/lib/workspace-config-schema'
import { deriveWorkspaceBaseDirectory, renderAllRepoInputs, renderWorkspaceSpec } from '@/lib/workspace-setup'

/** User action on workspace-now setup failures. */
export type WorkspaceNowUserAction = 'retry' | 'proceed_anyway' | 'remove_all'

/**
 * Builds ticket.md content from the inline task description.
 * Returns null when there is nothing meaningful to write.
 */
export function buildInlineTicketContent({
	effectiveName,
	description,
}: {
	effectiveName: string
	description: string
}): string | null {
	const trimmedDescription = description.trim()
	return trimmedDescription ? `# ${effectiveName}\n\n${trimmedDescription}` : null
}

export function isAtomicTaskCreateVisible({
	taskVisible,
	firstSessionVisible,
}: {
	taskVisible: boolean
	firstSessionVisible?: boolean
}): boolean {
	return taskVisible && firstSessionVisible !== false
}

// --- Workspace-now pipeline ---

type WorkspaceNowPipelineResult =
	| {
			ok: true
			/** The primary repo's expanded worktree path — the task/session working directory. */
			workingDirectory: string
			/** Per-repo create results (expanded paths + best-effort git identity) for the workspace_state snapshot. */
			createResults: WorkspaceRepoCreateResult[]
			setupResults: WorkspaceSetupCommandResult[]
			acceptedSkips: Array<{
				localPath: string
				stage: 'setup_command'
				skippedAt: number
				command?: string
				errorMessage?: string
			}>
			startedAt: number
			finishedAt: number
	  }
	| { ok: false; aborted: boolean }

type WorkspaceSetupRepo = WorkspaceRepoInput & { opId: string }
type WorkspaceSetupCommandResult = Awaited<ReturnType<typeof workspaceRunSetup>> & { repo: WorkspaceSetupRepo }

async function runWorkspaceSetupCommand(repo: WorkspaceSetupRepo): Promise<WorkspaceSetupCommandResult> {
	const setupResult = await workspaceRunSetup({
		targetPath: repo.targetPath,
		setupCommand: repo.setupCommand,
		localPath: repo.localPath,
	})

	return { ...setupResult, repo }
}

function getSetupErrorMessage(setupResult: Awaited<ReturnType<typeof workspaceRunSetup>>): string {
	return (
		setupResult.error ||
		(setupResult.stderr
			? `Exit ${setupResult.exitCode}: ${setupResult.stderr.slice(0, 200)}`
			: `Setup command failed with exit code ${setupResult.exitCode}`)
	)
}

/**
 * Runs the full workspace-now setup pipeline (preflight → create → copy → setup).
 * Returns { ok: true, workingDirectory, createResults } on success — the working
 * directory is the primary repo's expanded worktree path.
 * Returns { ok: false, aborted: true } if user cancelled (e.g. Remove All).
 * Returns { ok: false, aborted: false } if an error occurred (config invariant /
 * preflight / create failed).
 *
 * Config invariants (exactly one primary repo in the selection, all target
 * paths sharing one parent directory) are asserted here, before any native
 * git call is made.
 */
export async function runWorkspaceNowPipeline({
	selectedDirectory,
	repos,
	repoInputs,
	dispatchSubmit,
	updateOp,
	waitForWorkspaceAction,
}: {
	selectedDirectory: string
	/** The selection-filtered effective repo entries (same repos as repoInputs, carrying primary/description). */
	repos: EffectiveRepoEntry[]
	repoInputs: WorkspaceRepoInput[]
	dispatchSubmit: React.Dispatch<SubmitAction>
	updateOp: (id: string, updates: Partial<SubmitOperation>) => void
	waitForWorkspaceAction: () => Promise<WorkspaceNowUserAction>
}): Promise<WorkspaceNowPipelineResult> {
	const startedAt = Date.now()
	const acceptedSkips: Extract<WorkspaceNowPipelineResult, { ok: true }>['acceptedSkips'] = []
	// Build pre-task operation list
	const ops: SubmitOperation[] = [
		{ id: 'ws-preflight', name: 'Preflighting repos', status: 'pending', scope: 'workspace' },
		{ id: 'ws-create', name: 'Creating worktrees', status: 'pending', scope: 'workspace' },
		{ id: 'ws-copy', name: 'Copying files', status: 'pending', scope: 'workspace' },
		...repoInputs
			.filter((r) => r.setupCommand)
			.map((r) => ({
				id: `ws-setup-${r.localPath}`,
				name: `Running setup: ${repoBasename(r.localPath, selectedDirectory)}`,
				status: 'pending' as OperationStatus,
				command: r.setupCommand,
				scope: 'workspace' as const,
			})),
	]
	dispatchSubmit({ type: 'SET_OPERATIONS', operations: ops })

	// --- Config invariants (TS-owned, asserted before any native call) ---
	const primaryRepos = repos.filter((r) => r.primary)
	const primaryRepo = primaryRepos[0]
	if (primaryRepos.length !== 1 || !primaryRepo) {
		updateOp('ws-preflight', {
			status: 'error',
			errorMessage:
				primaryRepos.length === 0
					? 'The workspace selection has no primary repository. Mark exactly one repo as primary.'
					: 'The workspace selection has multiple primary repositories. Mark exactly one repo as primary.',
		})
		return { ok: false, aborted: false }
	}

	const baseDirResult = deriveWorkspaceBaseDirectory(repoInputs)
	if (!baseDirResult.ok) {
		updateOp('ws-preflight', { status: 'error', errorMessage: baseDirResult.error })
		return { ok: false, aborted: false }
	}

	// --- Preflight ---
	updateOp('ws-preflight', { status: 'running' })
	const preflightResult = await workspacePreflight({ selectedDirectory, repos: repoInputs })
	if (!preflightResult.ok) {
		const failedRepo = preflightResult.repos.find((r) => !r.ok)
		updateOp('ws-preflight', {
			status: 'error',
			errorMessage: failedRepo?.error ?? 'Preflight failed',
		})
		return { ok: false, aborted: false }
	}
	updateOp('ws-preflight', { status: 'success' })

	// --- Create worktrees ---
	updateOp('ws-create', { status: 'running' })
	const createResult = await workspaceCreate({ selectedDirectory, repos: repoInputs })
	if (!createResult.ok) {
		const failedRepo = createResult.repos.find((r) => !r.ok)
		updateOp('ws-create', {
			status: 'error',
			errorMessage: failedRepo?.error ?? 'Failed to create worktrees',
		})
		return { ok: false, aborted: false }
	}

	// The session working directory is the primary repo's expanded worktree path
	const primaryCreateResult = createResult.repos.find((r) => r.localPath === primaryRepo.localPath)
	if (!primaryCreateResult?.expandedTargetPath) {
		updateOp('ws-create', {
			status: 'error',
			errorMessage: `Could not determine the working directory for primary repo "${primaryRepo.localPath}"`,
		})
		return { ok: false, aborted: false }
	}
	const workingDirectory = primaryCreateResult.expandedTargetPath
	updateOp('ws-create', { status: 'success' })

	// --- Copy globs ---
	updateOp('ws-copy', { status: 'running' })
	console.log('[workspace-now] Calling workspaceCopyGlobs with:', {
		selectedDirectory,
		repos: repoInputs.map((r) => ({ localPath: r.localPath, copyGlobs: r.copyGlobs })),
	})
	const copyResult = await workspaceCopyGlobs({ selectedDirectory, repos: repoInputs })
	if (!copyResult.ok) {
		const failedRepo = copyResult.repos.find((r) => !r.ok)
		updateOp('ws-copy', {
			status: 'error',
			errorMessage: failedRepo?.error ?? 'Failed to copy files',
		})
	} else {
		updateOp('ws-copy', { status: 'success' })
	}

	// --- Run setup commands concurrently (one per repo with a setup command) ---
	const setupRepos = repoInputs
		.filter((r) => r.setupCommand)
		.map((repo) => ({
			...repo,
			opId: `ws-setup-${repo.localPath}`,
		}))
	for (const repo of setupRepos) {
		updateOp(repo.opId, { status: 'running' })
	}

	const setupResults = await Promise.all(setupRepos.map((repo) => runWorkspaceSetupCommand(repo)))
	const finalSetupResults = new Map(setupResults.map((result) => [result.repo.localPath, result]))
	for (const setupResult of setupResults) {
		if (setupResult.ok) {
			updateOp(setupResult.repo.opId, { status: 'success' })
		} else {
			updateOp(setupResult.repo.opId, {
				status: 'error',
				errorMessage: getSetupErrorMessage(setupResult),
			})
		}
	}

	for (const initialSetupResult of setupResults) {
		if (initialSetupResult.ok) continue

		const { repo } = initialSetupResult
		const opId = repo.opId

		let setupResult = initialSetupResult
		let done = false
		while (!done) {
			if (setupResult.ok) {
				updateOp(opId, { status: 'success' })
				done = true
			} else {
				updateOp(opId, { status: 'error', errorMessage: getSetupErrorMessage(setupResult) })

				console.log('[workspace-now] Waiting for user action...')
				const action = await waitForWorkspaceAction()
				console.log('[workspace-now] User chose:', action)

				if (action === 'retry') {
					updateOp(opId, { status: 'running', errorMessage: undefined })
					setupResult = await runWorkspaceSetupCommand(repo)
					finalSetupResults.set(repo.localPath, setupResult)
				} else if (action === 'proceed_anyway') {
					updateOp(opId, { status: 'skipped' })
					const acceptedSkip: Extract<WorkspaceNowPipelineResult, { ok: true }>['acceptedSkips'][number] = {
						localPath: repo.localPath,
						stage: 'setup_command',
						skippedAt: Date.now(),
						errorMessage: getSetupErrorMessage(setupResult),
					}
					if (repo.setupCommand) acceptedSkip.command = repo.setupCommand
					acceptedSkips.push(acceptedSkip)
					done = true
				} else {
					console.log('[workspace-now] Calling workspaceRemoveAll...', {
						selectedDirectory,
						repoCount: repoInputs.length,
					})
					dispatchSubmit({
						type: 'SET_OPERATIONS',
						operations: [{ id: 'ws-cleanup', name: 'Removing worktrees', status: 'running' }],
					})
					const removeResult = await workspaceRemoveAll({ selectedDirectory, repos: repoInputs })
					console.log('[workspace-now] workspaceRemoveAll result:', removeResult)
					return { ok: false, aborted: true }
				}
			}
		}
	}

	return {
		ok: true,
		workingDirectory,
		createResults: createResult.repos,
		setupResults: [...finalSetupResults.values()],
		acceptedSkips,
		startedAt,
		finishedAt: Date.now(),
	}
}

/** Selects who executes workspace-now setup for the current submit. */
export function getWorkspaceNowExecutionMode(daemonDrivenWorkspaceSetupEnabled: boolean): WorkspaceNowExecutionMode {
	return daemonDrivenWorkspaceSetupEnabled ? 'daemon' : 'form'
}

export interface PreparedWorkspaceNowTaskCreation {
	readonly repoInputs: WorkspaceRepoInput[]
	readonly workspaceSpec: WorkspaceSpec
	readonly primaryWorkingDirectory: string
}

function isAbsoluteWorkspacePath(value: string): boolean {
	return value.startsWith('/') || value.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(value)
}

/** Replaces a launch-host home prefix with a portable tilde path. */
export function normalizePathToHome(value: string, homeDirectory: string): string {
	if (value.startsWith('~') || !isAbsoluteWorkspacePath(value)) return value

	const trimmedHome = homeDirectory.replace(/[\\/]+$/, '')
	const home = trimmedHome || (/^[\\/]+$/.test(homeDirectory) ? homeDirectory[0] : '')
	if (!home) {
		throw new Error(
			`Cannot make absolute path "${value}" portable because the launching home directory is unavailable`,
		)
	}

	if (value === home) return '~'
	if (value.startsWith(home)) {
		const separator = value[home.length]
		if (separator === '/' || separator === '\\') {
			const remainder = value.slice(home.length + 1).replaceAll('\\', '/')
			return remainder ? `~/${remainder}` : '~'
		}
	}

	throw new Error(
		`Path "${value}" is outside the launching home directory "${home}". Remote worktree setup requires paths under the launching home directory.`,
	)
}

/** Renders the shared workspace-now payload before either execution path runs. */
export function prepareWorkspaceNowTaskCreation({
	config,
	selectedDirectory,
	taskSlug,
	pathTransform,
}: {
	config: EffectiveWorkspaceConfig
	selectedDirectory: string
	taskSlug: string
	pathTransform?: (path: string) => string
}): PreparedWorkspaceNowTaskCreation {
	const primaryRepos = config.repos.filter((repo) => repo.primary)
	const primaryRepo = primaryRepos[0]
	if (primaryRepos.length !== 1 || !primaryRepo) {
		throw new Error('Workspace-now task creation requires exactly one primary repository')
	}

	const repoInputs = renderAllRepoInputs(config, { taskSlug, selectedDirectory })
	const primaryRepoInput = repoInputs.find((repo) => repo.localPath === primaryRepo.localPath)
	if (!primaryRepoInput) {
		throw new Error(`No rendered workspace input found for primary repo "${primaryRepo.localPath}"`)
	}
	const workspaceSpec = renderWorkspaceSpec({ config, selectedDirectory, repoInputs })
	if (!pathTransform) {
		return {
			repoInputs,
			workspaceSpec,
			primaryWorkingDirectory: primaryRepoInput.targetPath,
		}
	}

	return {
		repoInputs,
		workspaceSpec: {
			...workspaceSpec,
			directory: pathTransform(workspaceSpec.directory),
			workspaceBaseDirectory: pathTransform(workspaceSpec.workspaceBaseDirectory),
			repos: workspaceSpec.repos.map((repo) => ({
				...repo,
				targetPath: pathTransform(repo.targetPath),
			})),
		},
		primaryWorkingDirectory: pathTransform(primaryRepoInput.targetPath),
	}
}

// --- Workspace state snapshot ---

/**
 * Builds the task's workspace_state snapshot from the data a successful
 * workspace-now pipeline has in hand: the rendered repo inputs (target paths,
 * branches, source refs), the selection-filtered effective config entries
 * (description, primary), and the per-repo create results (best-effort git
 * identity: source ref, remote URL, resolved commit).
 *
 * Repos are emitted in config-declared order (the order of `inputs`).
 * `workspaceBaseDirectory` stays non-expanded ("~/..."); repo `path` is the
 * worktree subdir name relative to the base. Optional fields (description,
 * remoteUrl, sourceCommit) are omitted when unknown — never fabricated.
 *
 * Throws when invariants already asserted by runWorkspaceNowPipeline are
 * violated (no common parent directory, missing effective repo entry).
 */
export function buildWorkspaceState(
	inputs: WorkspaceRepoInput[],
	repos: EffectiveRepoEntry[],
	results: WorkspaceRepoCreateResult[],
): WorkspaceState {
	const baseDirResult = deriveWorkspaceBaseDirectory(inputs)
	if (!baseDirResult.ok) {
		throw new Error(baseDirResult.error)
	}
	const { baseDir } = baseDirResult
	const basePrefix = baseDir === '/' ? '/' : `${baseDir}/`

	const reposByLocalPath = new Map(repos.map((repo) => [repo.localPath, repo]))
	const resultsByLocalPath = new Map(results.map((result) => [result.localPath, result]))

	const snapshotRepos = inputs.map((input) => {
		const repo = reposByLocalPath.get(input.localPath)
		if (!repo) {
			throw new Error(`No effective repo entry found for workspace repo "${input.localPath}"`)
		}
		const trimmedTarget = input.targetPath.replace(/\/+$/, '')
		if (!trimmedTarget.startsWith(basePrefix)) {
			throw new Error(`Target path "${input.targetPath}" is not inside the workspace base directory "${baseDir}"`)
		}
		const result = resultsByLocalPath.get(input.localPath)

		const snapshotRepo: WorkspaceState['repos'][number] = {
			path: trimmedTarget.slice(basePrefix.length),
			sourceRef: result?.resolvedSourceRef ?? input.sourceRef,
			branch: input.branch,
			primary: repo.primary,
		}
		if (input.branchRemote) snapshotRepo.branchRemote = input.branchRemote
		if (repo.description) snapshotRepo.description = repo.description
		if (result?.remoteUrl) snapshotRepo.remoteUrl = result.remoteUrl
		if (result?.resolvedSha) snapshotRepo.sourceCommit = result.resolvedSha
		return snapshotRepo
	})

	return { workspaceBaseDirectory: baseDir, repos: snapshotRepos }
}

/** Converts the completed synchronous Tauri pipeline into the shared durable ledger. */
export function buildFinishedWorkspaceSetupState({
	repoInputs,
	createResults,
	setupResults,
	acceptedSkips,
	userId,
	startedAt,
	finishedAt,
}: {
	repoInputs: WorkspaceRepoInput[]
	createResults: WorkspaceRepoCreateResult[]
	setupResults: WorkspaceSetupCommandResult[]
	acceptedSkips: Extract<WorkspaceNowPipelineResult, { ok: true }>['acceptedSkips']
	userId: string
	startedAt: number
	finishedAt: number
}): WorkspaceSetupState {
	const createByPath = new Map(createResults.map((result) => [result.localPath, result]))
	const setupByPath = new Map(setupResults.map((result) => [result.repo.localPath, result]))

	const workspaceSetupState: WorkspaceSetupState = {
		specVersion: 1,
		startedAt,
		finishedAt,
		repos: repoInputs.map((repo) => {
			const create = createByPath.get(repo.localPath)
			const setup = setupByPath.get(repo.localPath)
			const preflight: NonNullable<WorkspaceSetupState['repos'][number]['preflight']> = {}
			if (create?.resolvedSha) preflight.resolvedSourceCommit = create.resolvedSha
			const worktree: NonNullable<WorkspaceSetupState['repos'][number]['worktree']> = {}
			if (create?.expandedTargetPath) worktree.targetPath = create.expandedTargetPath
			if (create?.remoteUrl) worktree.remoteUrl = create.remoteUrl
			const repoSetupState: WorkspaceSetupState['repos'][number] = {
				localPath: repo.localPath,
				status: 'done' as const,
				preflight,
				worktree,
				copyGlobs: {},
			}
			if (repo.setupCommand) {
				const setupCommand: NonNullable<WorkspaceSetupState['repos'][number]['setupCommand']> = {
					command: repo.setupCommand,
				}
				if (setup) setupCommand.exitCode = setup.exitCode
				repoSetupState.setupCommand = setupCommand
			}
			return repoSetupState
		}),
	}
	if (acceptedSkips.length > 0) {
		workspaceSetupState.acceptedSkips = acceptedSkips.map((skip) => ({
			...skip,
			skippedByUserId: userId,
		}))
	}
	return workspaceSetupState
}

// --- V2 setup operations ---

export async function runV2SetupOperations({
	data,
	effectiveName,
	taskId,
	slug,
	hostId,
	workingDirectory,
	sessionActions,
	codingAgent,
	provider,
	model,
	effort,
	fastMode,
	autoAdvanceQuestionsToResearch,
	cancelledRef,
	dispatchSubmit,
	updateOp,
	waitForUserAction,
	appendToExistingOps,
}: {
	data: NewTaskFormV2Input
	effectiveName: string
	taskId: string
	slug: string
	hostId: string
	workingDirectory: string
	sessionActions: ReturnType<typeof createSessionActions>
	codingAgent: AgentType
	provider: ProviderType
	model: string
	effort?: string
	fastMode?: boolean
	autoAdvanceQuestionsToResearch: boolean
	cancelledRef: React.MutableRefObject<boolean>
	dispatchSubmit: React.Dispatch<SubmitAction>
	updateOp: (id: string, updates: Partial<SubmitOperation>) => void
	waitForUserAction: () => Promise<'retry' | 'skip'>
	appendToExistingOps?: boolean
}) {
	const ops: SubmitOperation[] = []

	if (!appendToExistingOps) {
		ops.push({ id: 'create-task', name: 'Creating task', status: 'success' as OperationStatus, scope: 'task' })
	}

	ops.push({
		id: 'launch-session',
		name: 'Launching session',
		status: 'pending' as OperationStatus,
		scope: 'session',
	})

	if (appendToExistingOps) {
		dispatchSubmit({ type: 'APPEND_OPERATIONS', operations: ops })
	} else {
		dispatchSubmit({ type: 'SET_OPERATIONS', operations: ops })
	}

	const runners = {
		'launch-session': async () => {
			const sessionParams = getFirstSessionParams({
				slug: slug || null,
				name: effectiveName,
				autoAdvanceQuestionsToResearch,
				workflow: data.workflow === 'oneshot' ? 'oneshot' : 'rpi',
			})
			const sessionId = uuidv7()
			const eventId = uuidv7()
			const sessionTx = sessionActions.launchSession({
				id: sessionId,
				eventId,
				taskId,
				title: sessionParams.title,
				text: sessionParams.prompt,
				workingDirectory: workingDirectory,
				hostId,
				codingAgent,
				provider,
				model,
				effort,
				fastMode,
				permissionsMode: sessionParams.permissionsMode,
			})

			try {
				await sessionTx.isPersisted.promise
			} catch (error: unknown) {
				const message =
					error instanceof Error ? error.message : typeof error === 'string' ? error : String(error)
				toast.error('Failed to launch session', { description: message })
				captureException(error, { extra: { action: 'launchSession', sessionId, taskId } })
				throw error
			}
		},
	}

	for (const op of ops) {
		if (op.id !== 'launch-session') continue
		if (cancelledRef.current) {
			updateOp(op.id, { status: 'skipped' })
			continue
		}

		const runner = runners[op.id]
		if (!runner) continue

		let succeeded = false
		while (!succeeded) {
			if (cancelledRef.current) {
				updateOp(op.id, { status: 'skipped' })
				break
			}

			updateOp(op.id, { status: 'running', errorMessage: undefined })

			try {
				await runner()
				updateOp(op.id, { status: 'success' })
				succeeded = true
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				updateOp(op.id, { status: 'error', errorMessage })

				const action = await waitForUserAction()
				if (action === 'skip') {
					updateOp(op.id, { status: 'skipped' })
					succeeded = true
				}
			}
		}
	}
}
