import { repositoryNameFromIdentity } from '@humanlayer/schemas/effect/project-workspace'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { AlertTriangle } from 'lucide-react'

import { useTaskWorkspaceSetup } from '@/hooks/live-queries/useTaskWorkspaceSetup'
import { useTask } from '@/minimalist/lib/data'
import { useAction } from '@/minimalist/lib/use-action'
import { type SetupRepository as Repository, useWorkspaceSetup } from '@/minimalist/lib/workspace-setup'
import { useRiptideApi } from '@/orpc/client'

import { TaskWorkspaceSetup } from './TaskWorkspaceSetup'

type Stage = Repository['status']['status']

const SKIPPABLE: readonly Stage[] = ['copying_files', 'running_setup_command']
/** Steps that fail on the project's repository or access to it, which a retry alone won't fix. */
const SOURCE: readonly Stage[] = ['cloning_source', 'refreshing_source', 'resolving_commit']

/** What the host is doing right now, as a short present-tense line. */
function stageLine(repository: Repository): string {
	const name = repositoryNameFromIdentity(repository.status.repositoryIdentity)
	switch (repository.status.status) {
		case 'setup_requested':
			return 'Waiting for the host'
		case 'checking_source':
			return `Finding ${name}`
		case 'cloning_source':
			return `Cloning ${name}`
		case 'refreshing_source':
			return `Fetching ${name}`
		case 'resolving_commit':
			return `Finding the base commit of ${name}`
		case 'materializing':
			return `Creating the worktree for ${name}`
		case 'publishing_branch':
			return `Creating the task branch in ${name}`
		case 'copying_files':
			return `Copying files into ${name}`
		case 'running_setup_command':
			return `Running ${repository.repository.setupCommand ?? 'the setup command'}`
		default:
			return `${name} is ready`
	}
}

/** The same step, as the thing that failed: "Could not fetch app". */
function failureLine(repository: Repository): string {
	const name = repositoryNameFromIdentity(repository.status.repositoryIdentity)
	switch (repository.status.error?.stage ?? repository.status.status) {
		case 'checking_source':
			return `Could not find ${name} on the host`
		case 'cloning_source':
			return `Could not clone ${name}`
		case 'refreshing_source':
			return `Could not fetch ${name}`
		case 'resolving_commit':
			return `Could not find the base branch of ${name}`
		case 'materializing':
			return `Could not create the worktree for ${name}`
		case 'publishing_branch':
			return `Could not create the task branch in ${name}`
		case 'copying_files':
			return `Could not copy files into ${name}`
		case 'running_setup_command':
			return 'The setup command failed'
		default:
			return `Could not set up ${name}`
	}
}

/** What the failed setup means for the task, and what the reader can do about it. */
function nextStepLine(about: {
	waitingForWorkspace: boolean
	missingCheckout: boolean
	owner: boolean
	source: boolean
	sourcePath?: string | null
}) {
	if (about.missingCheckout)
		return `The checkout at ${about.sourcePath ?? 'the saved path'} is missing. The host can clone its own copy instead.`
	const waiting = about.waitingForWorkspace ? 'The agent has not started. ' : ''
	if (!about.owner) return about.waitingForWorkspace ? 'The agent has not started.' : null
	if (about.source) return `${waiting}Check the repository address and access in project settings, then retry.`
	return `${waiting}Fix the problem below, then retry.`
}

/**
 * Shows workspace progress and recovery, including when setup doesn't block the session.
 */
export function WorkspaceSetup({ taskId, waitingForWorkspace }: { taskId: string; waitingForWorkspace: boolean }) {
	const { task, isReady } = useTask(taskId)
	const setup = useTaskWorkspaceSetup(taskId)
	if (!isReady) return <div className="boot-mark" />
	if (!task) return null
	// Notifications come from these synced rows, even when a task has no project workspace.
	const taskSetup = <TaskWorkspaceSetup task={task} setup={setup} waitingForWorkspace={waitingForWorkspace} />
	if (task.workspace_id)
		return (
			<>
				<ProjectWorkspaceSetup taskId={taskId} waitingForWorkspace={waitingForWorkspace} />
				{setup.isReady && setup.rows.some((row) => row.error) ? taskSetup : null}
			</>
		)
	if (!setup.isReady) return <div className="boot-mark" />
	if (task.workspace_spec || setup.rows.length > 0) return taskSetup
	return (
		<div className="worked setup flush" role="status">
			This task has no workspace setup
		</div>
	)
}

function ProjectWorkspaceSetup({ taskId, waitingForWorkspace }: { taskId: string; waitingForWorkspace: boolean }) {
	const { client: api } = useRiptideApi()
	const queryClient = useQueryClient()
	const { user } = useAuth()
	const action = useAction()
	const { failed, working, settled, unknown, checking, check, queryKey } = useWorkspaceSetup(taskId)

	if (unknown)
		return (
			<div className="notice" role="alert">
				<AlertTriangle className="i sm" strokeWidth={1.6} />
				<div className="body">
					<b>Could not check the workspace setup</b>
					<div className="d">
						{waitingForWorkspace
							? "The host may still be setting it up. The agent starts once it's ready."
							: 'The host may still be setting up your workspace. Check again to see its status.'}
					</div>
					<div className="acts">
						<button type="button" className="btn" disabled={checking} onClick={check}>
							{checking ? 'Checking…' : 'Check again'}
						</button>
					</div>
				</div>
			</div>
		)

	if (!failed) {
		if (settled)
			return (
				<div className="worked setup flush" role="status">
					Your workspace is ready
				</div>
			)
		return (
			<div className="worked setup flush" role="status">
				<span className="spin" />
				Setting up your workspace
				{working ? <span className="muted">{stageLine(working)}…</span> : null}
			</div>
		)
	}

	const status = failed.status
	const error = status.error
	const input = {
		taskId,
		hostId: status.hostId,
		repositoryIdentity: status.repositoryIdentity,
		expectedUpdatedAt: status.updatedAt,
	}
	const refresh = () => queryClient.invalidateQueries({ queryKey })
	const owner = status.userId === user?.id
	const skippable = error ? SKIPPABLE.includes(error.stage) : false
	const source = error ? SOURCE.includes(error.stage) : false
	const missingCheckout = status.sourcePolicy === 'filesystem_required' && error?.stage === 'checking_source'
	const nextStep = nextStepLine({
		waitingForWorkspace,
		missingCheckout,
		owner,
		source,
		sourcePath: status.sourcePath,
	})
	const detail = [
		error?.stderr?.trim() || error?.message,
		error?.exitCode === undefined ? null : `exit ${error.exitCode}`,
	]
		.filter(Boolean)
		.join('\n')

	return (
		<div className="notice fail" role="alert">
			<AlertTriangle className="i sm" strokeWidth={1.6} />
			<div className="body">
				<b>{failureLine(failed)}</b>
				{nextStep ? <div className="d">{nextStep}</div> : null}
				{detail ? <pre className="log">{detail}</pre> : null}
				{owner ? (
					<div className="acts">
						{missingCheckout ? (
							<button
								type="button"
								className="btn primary"
								disabled={action.pending}
								onClick={() =>
									void action.run(async () => {
										await api.projectWorkspaces.repositorySources.recover({
											...input,
											source: { kind: 'managed_clone' },
										})
										await refresh()
									}, 'Could not switch to a managed clone. Try again.')
								}
							>
								Clone it instead
							</button>
						) : (
							<button
								type="button"
								className="btn primary"
								disabled={action.pending}
								onClick={() =>
									void action.run(async () => {
										await api.projectWorkspaces.retryRepositorySetup(input)
										await refresh()
									}, 'Could not retry setup. Refresh and try again.')
								}
							>
								Retry
							</button>
						)}
						{skippable ? (
							<button
								type="button"
								className="btn"
								disabled={action.pending}
								onClick={() =>
									void action.run(async () => {
										await api.projectWorkspaces.skipRepositorySetupStep(input)
										await refresh()
									}, 'Could not skip this step. Refresh and try again.')
								}
							>
								Skip this step
							</button>
						) : null}
						{source ? (
							<Link className="btn" to="/settings/projects">
								Project settings
							</Link>
						) : null}
					</div>
				) : (
					<div className="d">Only the person who started this task can retry setup.</div>
				)}
			</div>
		</div>
	)
}
