import type { OnlineHost } from '@humanlayer/db/tables/online-hosts'
import { taskWorkspaceSetupForHostSelectSchema } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { WorkspaceSetupStateSchema } from '@humanlayer/schemas/zod/workspace'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'
import type z from 'zod/v4'

import { useSync } from '@/components/providers/SyncProvider'

export type TaskWorkspaceSetupRow = z.output<typeof taskWorkspaceSetupForHostSelectSchema>

export interface TaskWorkspaceSetupView {
	rows: TaskWorkspaceSetupRow[]
	rowsByHost: Map<string, TaskWorkspaceSetupRow[]>
	hosts: TaskWorkspaceHost[]
	activeHostId: string | null
	activeRow: TaskWorkspaceSetupRow | null
	activeHostName: string | null
	isBlockingFirstSession: boolean
	elapsedMs: number | null
	acceptedSkipCount: number
	acceptedSkipNotes: string[]
	isReady: boolean
}

export interface TaskWorkspaceHost {
	hostId: string
	hostName: string | null
	userId: string | null
	row: TaskWorkspaceSetupRow | null
	configured: boolean
}

export function deriveTaskWorkspaceSetupView({
	rows,
	hosts,
	preferredHostId,
	setupBlocksFirstSession = false,
	isReady,
}: {
	rows: TaskWorkspaceSetupRow[]
	hosts: Pick<OnlineHost, 'host_id' | 'host_name' | 'user_id'>[]
	preferredHostId?: string | null
	setupBlocksFirstSession?: boolean
	isReady: boolean
}): TaskWorkspaceSetupView {
	const sortedRows = [...rows].sort((a, b) => Number(b.updated_at) - Number(a.updated_at))
	const rowsByHost = new Map<string, TaskWorkspaceSetupRow[]>()
	for (const row of sortedRows) {
		const hostRows = rowsByHost.get(row.host_id) ?? []
		hostRows.push(row)
		rowsByHost.set(row.host_id, hostRows)
	}

	// The task's selected host owns the workspace panel even before setup has
	// created a row. Never fall through to another host's setup state.
	const activeHostId = preferredHostId ?? sortedRows[0]?.host_id
	const activeRow = activeHostId ? (rowsByHost.get(activeHostId)?.[0] ?? null) : null
	const activeHostName = activeHostId
		? (hosts.find((host) => host.host_id === activeHostId)?.host_name ?? null)
		: null
	const stateResult = activeRow ? WorkspaceSetupStateSchema.safeParse(activeRow.workspace_setup_state) : null
	const state = stateResult?.success ? stateResult.data : null
	const elapsedMs = state?.startedAt
		? Math.max(0, (state.finishedAt ?? Number(activeRow?.updated_at ?? Date.now())) - state.startedAt)
		: null
	const configuredHosts = [...rowsByHost.entries()].map<TaskWorkspaceHost>(([hostId, hostRows]) => {
		const host = hosts.find((candidate) => candidate.host_id === hostId)
		return {
			hostId,
			hostName: host?.host_name ?? null,
			userId: host?.user_id ?? null,
			row: hostRows[0] ?? null,
			configured: true,
		}
	})
	const selectedHostAlreadyConfigured = preferredHostId
		? configuredHosts.some((host) => host.hostId === preferredHostId)
		: true
	const selectedUnconfiguredHost =
		preferredHostId && !selectedHostAlreadyConfigured
			? (() => {
					const host = hosts.find((candidate) => candidate.host_id === preferredHostId)
					return {
						hostId: preferredHostId,
						hostName: host?.host_name ?? null,
						userId: host?.user_id ?? null,
						row: null,
						configured: false,
					} satisfies TaskWorkspaceHost
				})()
			: null
	const workspaceHosts = [...configuredHosts].sort((left, right) => {
		if (left.hostId === preferredHostId) return -1
		if (right.hostId === preferredHostId) return 1
		return (left.hostName ?? left.hostId).localeCompare(right.hostName ?? right.hostId)
	})
	if (selectedUnconfiguredHost) workspaceHosts.unshift(selectedUnconfiguredHost)

	return {
		rows: sortedRows,
		rowsByHost,
		hosts: workspaceHosts,
		activeHostId: activeHostId ?? null,
		activeRow,
		activeHostName,
		isBlockingFirstSession: setupBlocksFirstSession && activeRow !== null && activeRow.status !== 'done',
		elapsedMs,
		acceptedSkipCount: state?.acceptedSkips?.length ?? 0,
		acceptedSkipNotes:
			state?.acceptedSkips?.map(
				(skip) =>
					`${skip.localPath}: skipped ${skip.stage.replaceAll('_', ' ')}${skip.errorMessage ? ` (${skip.errorMessage})` : ''}`,
			) ?? [],
		isReady,
	}
}

export function useTaskWorkspaceSetup(
	taskId: string | null | undefined,
	preferredHostId?: string | null,
	setupBlocksFirstSession = false,
): TaskWorkspaceSetupView {
	const { taskWorkspaceSetupForHostCollection, onlineHostsCollection } = useSync()
	const { data: rows, isReady: rowsReady } = useLiveQuery(
		(q) =>
			taskId
				? q.from({ setup: taskWorkspaceSetupForHostCollection }).where(({ setup }) => eq(setup.task_id, taskId))
				: undefined,
		[taskWorkspaceSetupForHostCollection, taskId],
	)
	const { data: hosts, isReady: hostsReady } = useLiveQuery(
		(q) => (taskId ? q.from({ hosts: onlineHostsCollection }) : undefined),
		[onlineHostsCollection, taskId],
	)

	return useMemo(() => {
		const parsedRows = (rows ?? []).flatMap((row) => {
			const result = taskWorkspaceSetupForHostSelectSchema.safeParse(row)
			return result.success ? [result.data] : []
		})
		return deriveTaskWorkspaceSetupView({
			rows: parsedRows,
			hosts: hosts ?? [],
			preferredHostId,
			setupBlocksFirstSession,
			isReady: rowsReady && hostsReady,
		})
	}, [hosts, hostsReady, preferredHostId, rows, rowsReady, setupBlocksFirstSession])
}
