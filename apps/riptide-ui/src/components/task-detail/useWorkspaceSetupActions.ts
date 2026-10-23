import type { TaskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { createWorkspaceSetupActions } from '@/actions/workspace-setup'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { useRiptideApi } from '@/orpc/client'

function buildDiagnosticPrompt(taskName: string, row: TaskWorkspaceSetupForHost): string {
	const error = row.error
	if (!error) return `Inspect workspace setup for task "${taskName}" and report any problems.`
	return [
		`Diagnose the workspace setup failure for task "${taskName}".`,
		`Host: ${row.host_id}`,
		`Repository: ${error.localPath}`,
		`Stage: ${error.stage}`,
		`Message: ${error.message}`,
		error.command ? `Command: ${error.command}` : null,
		error.exitCode !== undefined ? `Exit code: ${error.exitCode}` : null,
		error.stderr ? `Stderr:\n${error.stderr}` : null,
		'Inspect the repository and workspace configuration, explain the cause, and propose the smallest safe fix.',
	]
		.filter(Boolean)
		.join('\n')
}

export function useWorkspaceSetupActions({
	taskId,
	taskName,
	row,
}: {
	taskId: string
	taskName: string
	row: TaskWorkspaceSetupForHost | null
}) {
	const navigate = useNavigate()
	const { taskWorkspaceSetupForHostCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const { client } = useRiptideApi()
	const [busyAction, setBusyAction] = useState<'retry' | 'skip' | 'updateRepositoryDirectory' | null>(null)
	const actions = useMemo(
		() =>
			createWorkspaceSetupActions(
				taskWorkspaceSetupForHostCollection,
				client.workspaceSetup,
				confirmTx.workspaceSetup,
			),
		[client.workspaceSetup, confirmTx.workspaceSetup, taskWorkspaceSetupForHostCollection],
	)

	const retry = async () => {
		if (!row?.error) return
		setBusyAction('retry')
		try {
			await actions.retry({
				rowId: row.id,
				taskId,
				hostId: row.host_id,
				localPath: row.error.localPath,
				stage: row.error.stage,
			}).isPersisted.promise
			toast.success('Workspace setup retry requested')
		} catch {
			toast.error('Could not retry workspace setup')
		} finally {
			setBusyAction(null)
		}
	}

	const skip = async () => {
		if (!row?.error || (row.error.stage !== 'copy_globs' && row.error.stage !== 'setup_command')) return
		setBusyAction('skip')
		try {
			await actions.skip({
				rowId: row.id,
				taskId,
				hostId: row.host_id,
				localPath: row.error.localPath,
				stage: row.error.stage,
			}).isPersisted.promise
			toast.success('Workspace setup step skipped')
		} catch {
			toast.error('Could not skip workspace setup step')
		} finally {
			setBusyAction(null)
		}
	}

	const diagnose = () => {
		if (!row) return
		navigate({
			to: '/sessions/draft',
			search: {
				taskId,
				title: `Diagnose workspace setup: ${taskName}`,
				prompt: buildDiagnosticPrompt(taskName, row),
			},
		})
	}

	const updateRepositoryDirectory = async (repositoryDirectory: string): Promise<boolean> => {
		if (!row) return false
		setBusyAction('updateRepositoryDirectory')
		try {
			await actions.updateRepositoryDirectory({
				rowId: row.id,
				taskId,
				hostId: row.host_id,
				repositoryDirectory,
				expectedUpdatedAt: row.updated_at.toString(),
			}).isPersisted.promise
			toast.success('Repository location updated; workspace setup will retry automatically')
			return true
		} catch {
			toast.error('Could not update the repository location')
			return false
		} finally {
			setBusyAction(null)
		}
	}

	return { retry, skip, diagnose, updateRepositoryDirectory, busyAction }
}
