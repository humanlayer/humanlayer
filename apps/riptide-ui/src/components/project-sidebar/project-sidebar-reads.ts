import { ORPCError } from '@orpc/client'

import type { SidebarProject, WorkspaceRead, WorkspaceStatus } from './derive-project-sidebar'

interface ProjectListRead {
	data?: { projects: SidebarProject[] }
	error: unknown
}

/** Keep cached metadata on refetch errors; only a completed list proves a relation unresolved. */
export function readProjectMetadata(
	active: ProjectListRead,
	archived: ProjectListRead,
): { projects: SidebarProject[]; projectsState: 'ready' | 'error' | 'pending'; error: unknown } {
	const byId = new Map<string, SidebarProject>()
	const projects = active.data?.projects ? [...active.data.projects] : []
	if (archived.data?.projects) projects.push(...archived.data.projects)
	for (const project of projects) {
		const previous = byId.get(project.id)
		if (!previous || previous.updatedAt <= project.updatedAt) byId.set(project.id, project)
	}
	const projectsState = active.data && archived.data ? 'ready' : active.error || archived.error ? 'error' : 'pending'
	return { projects: [...byId.values()], projectsState, error: active.error ?? archived.error }
}

export function readWorkspace(query: { data?: WorkspaceStatus; error: unknown } | undefined): WorkspaceRead {
	if (query?.data) return { state: 'ready', data: query.data }
	if (!query?.error) return { state: 'pending' }
	return { state: query.error instanceof ORPCError && query.error.code === 'NOT_FOUND' ? 'missing' : 'error' }
}

/** Historical completed tasks need a relation read, not a permanent polling loop. */
export function workspaceRefetchInterval(launching: boolean, status?: WorkspaceStatus): number | false {
	const settingUp = status?.materializations.some((m) =>
		m.repositories.some((r) => r.status.status !== 'done' && !r.status.error),
	)
	return launching || settingUp ? 5_000 : false
}
