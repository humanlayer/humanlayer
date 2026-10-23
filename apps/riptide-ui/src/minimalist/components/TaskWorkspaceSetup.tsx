import type { Task } from '@humanlayer/db/tables/tasks'
import { deriveRepositoryPlacement, normalizePortablePath } from '@humanlayer/db/utils/repository-directory'
import { useAuth } from '@workos-inc/authkit-react'
import { AlertTriangle } from 'lucide-react'
import { useId, useState } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import type { TaskWorkspaceSetupRow, TaskWorkspaceSetupView } from '@/hooks/live-queries/useTaskWorkspaceSetup'
import { useTaskPermissions } from '@/hooks/useTaskPermissions'
import { useHosts } from '@/minimalist/lib/data'
import { useAction } from '@/minimalist/lib/use-action'
import { useTaskSetupActions } from '@/minimalist/lib/workspace-setup'

type SetupActions = ReturnType<typeof useTaskSetupActions>
type DirectoryEdit = { row: TaskWorkspaceSetupRow; directory: string }

function initialDirectory(row: TaskWorkspaceSetupRow): string {
	const spec = row.resolved_workspace_spec
	if (!spec) return ''
	try {
		return spec.repos.length === 1 ? spec.directory : deriveRepositoryPlacement(spec).repositoryDirectory
	} catch {
		return ''
	}
}

function focusDirectory(input: HTMLInputElement | null) {
	input?.focus()
}

const STAGES: Record<TaskWorkspaceSetupRow['status'], string> = {
	setup_requested: 'Waiting for the host',
	preflight: 'Preparing repositories',
	worktree: 'Creating worktrees',
	copy_globs: 'Copying files',
	setup_command: 'Running the setup command',
	done: 'Your workspace is ready',
}

const FAILURES: Record<TaskWorkspaceSetupRow['status'], string> = {
	setup_requested: 'Could not start workspace setup',
	preflight: 'Could not prepare the repository',
	worktree: 'Could not create the worktree',
	copy_globs: 'Could not copy files',
	setup_command: 'The setup command failed',
	done: 'Could not finish workspace setup',
}

/** The host-scoped task setup rows use their own actions, not project workspace actions. */
export function TaskWorkspaceSetup({
	task,
	setup,
	waitingForWorkspace,
}: {
	task: Task
	setup: TaskWorkspaceSetupView
	waitingForWorkspace: boolean
}) {
	const { user } = useAuth()
	const { taskOrganizationAclsCollection, taskUserAclsCollection } = useSync()
	const { canEditTask } = useTaskPermissions(task, user?.id, taskOrganizationAclsCollection, taskUserAclsCollection)
	const { hosts: ownHosts } = useHosts()
	const actions = useTaskSetupActions()
	if (setup.rows.length === 0)
		return (
			<div className="worked setup flush" role="status">
				<span className="spin" />
				Waiting for the host
			</div>
		)
	return setup.rows.map((row) => {
		const host = setup.hosts.find((entry) => entry.hostId === row.host_id)
		return (
			<TaskSetupRow
				key={row.id}
				row={row}
				actions={actions}
				canEdit={canEditTask}
				canChangeDirectory={
					canEditTask &&
					Boolean(task.workspace_spec) &&
					ownHosts.some((entry) => entry.host.host_id === row.host_id)
				}
				singleRepository={task.workspace_spec?.repos.length === 1}
				hostName={host?.hostName ?? row.host_id}
				waitingForWorkspace={waitingForWorkspace}
			/>
		)
	})
}

function TaskSetupRow({
	row,
	actions,
	canEdit,
	canChangeDirectory,
	singleRepository,
	hostName,
	waitingForWorkspace,
}: {
	row: TaskWorkspaceSetupRow
	actions: SetupActions
	canEdit: boolean
	canChangeDirectory: boolean
	singleRepository: boolean
	hostName: string
	waitingForWorkspace: boolean
}) {
	const action = useAction()
	// Keep the row version from when editing began, so a newer sync cannot silently replace it.
	const [editing, setEditing] = useState<DirectoryEdit | null>(null)
	const error = row.error
	if (!error)
		return (
			<div className="worked setup flush" role="status">
				{row.status !== 'done' ? <span className="spin" /> : null}
				{STAGES[row.status]}
				<span className="muted">{hostName}</span>
			</div>
		)
	const detail = [
		error.command,
		error.stderr?.trim() || error.message,
		error.exitCode === undefined ? null : `exit ${error.exitCode}`,
	]
		.filter(Boolean)
		.join('\n')
	return (
		<div className="notice fail" role="alert">
			<AlertTriangle className="i sm" strokeWidth={1.6} />
			<div className="body">
				<b>{FAILURES[error.stage]}</b>
				<div className="d">
					{hostName} · {error.localPath}
				</div>
				{waitingForWorkspace ? <div className="d">The agent has not started.</div> : null}
				<pre className="log">{detail}</pre>
				{canEdit ? (
					<TaskRecoveryActions
						row={row}
						error={error}
						actions={actions}
						action={action}
						editing={editing}
						setEditing={setEditing}
						canChangeDirectory={canChangeDirectory}
						singleRepository={singleRepository}
					/>
				) : (
					<div className="d">Only members with edit access to this task can retry setup.</div>
				)}
			</div>
		</div>
	)
}

function TaskRecoveryActions({
	row,
	error,
	actions,
	action,
	editing,
	setEditing,
	canChangeDirectory,
	singleRepository,
}: {
	row: TaskWorkspaceSetupRow
	error: NonNullable<TaskWorkspaceSetupRow['error']>
	actions: SetupActions
	action: ReturnType<typeof useAction>
	editing: DirectoryEdit | null
	setEditing: (editing: DirectoryEdit | null) => void
	canChangeDirectory: boolean
	singleRepository: boolean
}) {
	const input = {
		rowId: row.id,
		taskId: row.task_id,
		hostId: row.host_id,
		localPath: error.localPath,
		stage: error.stage,
	}
	const skipStage = error.stage === 'copy_globs' || error.stage === 'setup_command' ? error.stage : null
	return (
		<>
			<div className="d">Fix the problem above, then retry.</div>
			<div className="acts">
				<button
					type="button"
					className="btn primary"
					disabled={action.pending}
					onClick={() =>
						void action.run(
							() => actions.retry(input).isPersisted.promise,
							'Could not retry workspace setup. Check the setup status and try again.',
						)
					}
				>
					Retry
				</button>
				{skipStage ? (
					<button
						type="button"
						className="btn"
						disabled={action.pending}
						onClick={() =>
							void action.run(
								() => actions.skip({ ...input, stage: skipStage }).isPersisted.promise,
								'Could not skip this step. Check the setup status and try again.',
							)
						}
					>
						Skip this step
					</button>
				) : null}
				{canChangeDirectory ? (
					<button
						type="button"
						className="btn"
						disabled={action.pending}
						onClick={() => setEditing({ row, directory: initialDirectory(row) })}
					>
						Change repository location
					</button>
				) : null}
			</div>
			{canChangeDirectory && editing ? (
				<RepositoryLocation
					directory={editing.directory}
					onChange={(directory) => setEditing({ ...editing, directory })}
					singleRepository={singleRepository}
					disabled={action.pending}
					onCancel={() => setEditing(null)}
					onSave={(repositoryDirectory) => {
						void action
							.run(
								() =>
									actions.updateRepositoryDirectory({
										rowId: editing.row.id,
										taskId: editing.row.task_id,
										hostId: editing.row.host_id,
										repositoryDirectory,
										expectedUpdatedAt: editing.row.updated_at.toString(),
									}).isPersisted.promise,
								'Could not update the repository location. Check the setup status and try again.',
							)
							.then((updated) => {
								if (updated) setEditing(null)
							})
					}}
				/>
			) : null}
		</>
	)
}

function RepositoryLocation({
	directory,
	onChange,
	singleRepository,
	disabled,
	onSave,
	onCancel,
}: {
	directory: string
	onChange: (directory: string) => void
	singleRepository: boolean
	disabled: boolean
	onSave: (directory: string) => void
	onCancel: () => void
}) {
	const id = useId()
	let normalized = ''
	try {
		if (directory.trim()) normalized = normalizePortablePath(directory)
	} catch {
		/* The input stays editable until it is a valid path. */
	}
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault()
				if (normalized && !disabled) onSave(normalized)
			}}
		>
			<label htmlFor={id}>
				{singleRepository ? 'Repository directory' : 'Directory containing repositories'}
			</label>
			<input
				id={id}
				ref={focusDirectory}
				className="sinput"
				value={directory}
				disabled={disabled}
				onChange={(event) => onChange(event.target.value)}
			/>
			<div className="acts">
				<button type="submit" className="btn primary" disabled={disabled || !normalized}>
					Use this location
				</button>
				<button type="button" className="btn" disabled={disabled} onClick={onCancel}>
					Cancel
				</button>
			</div>
		</form>
	)
}
