import type { TaskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { deriveWorkspaceView, type WorkspaceView } from '@humanlayer/db/utils/workspace-view'
import type { WorkspaceSpec, WorkspaceState } from '@humanlayer/schemas/effect/workspace'

export interface WorkspaceHostGroup {
	hostId: string
	hostName: string | null
	userId: string | null
	setupRow: TaskWorkspaceSetupForHost | null
	configured: boolean
	isCurrentUserHost: boolean
	workspaceView: WorkspaceView
}

interface WorkspaceHostInput {
	hostId: string
	hostName: string | null
	userId: string | null
	row: TaskWorkspaceSetupForHost | null
	configured: boolean
}

export function deriveWorkspaceHostGroups({
	hosts,
	workspaceSpec,
	workspaceState,
	currentUserHostId,
}: {
	hosts: readonly WorkspaceHostInput[]
	workspaceSpec: WorkspaceSpec | null | undefined
	workspaceState: WorkspaceState | null | undefined
	currentUserHostId: string | null | undefined
}): WorkspaceHostGroup[] {
	return hosts.flatMap((host) => {
		const workspaceView = deriveWorkspaceView({
			workspaceSpec: host.row?.resolved_workspace_spec ?? workspaceSpec ?? null,
			workspaceSetupState: host.row?.workspace_setup_state,
			legacyWorkspaceState: workspaceState ?? null,
		})
		return workspaceView
			? [
					{
						hostId: host.hostId,
						hostName: host.hostName,
						userId: host.userId,
						setupRow: host.row,
						configured: host.configured,
						isCurrentUserHost: host.hostId === currentUserHostId,
						workspaceView,
					},
				]
			: []
	})
}
