import { Button } from '@humanlayer/ui/components/button'
import { SidebarSectionHeader } from '@humanlayer/ui/components/sidebar/SidebarSectionHeader'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { useAuth } from '@workos-inc/authkit-react'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useStore } from 'zustand'

import { CreateProjectDialog } from '@/components/launcher-v3/CreateProjectDialog'
import { createProjectSidebarStore } from '@/hooks/stores/projectSidebarStore'

import { CreateProjectPrompt } from './CreateProjectPrompt'
import { deriveProjectSidebar, layoutProjectSidebar } from './derive-project-sidebar'
import { ProjectSidebarExtras, ProjectSidebarReadNotice } from './ProjectSidebarExtras'
import { ProjectSidebarFrame } from './ProjectSidebarFrame'
import { ProjectSidebarGroup } from './ProjectSidebarGroup'
import { ProjectSidebarArchiveSync, ProjectSidebarOrderSnapshot } from './ProjectSidebarOrderSync'
import { useProjectSidebarData } from './useProjectSidebarData'

export function ProjectSidebarV2() {
	const { user, organizationId } = useAuth()
	if (!user || !organizationId) return null
	return (
		<ScopedProjectSidebar key={`${organizationId}:${user.id}`} userId={user.id} organizationId={organizationId} />
	)
}

function ScopedProjectSidebar({ userId, organizationId }: { userId: string; organizationId: string }) {
	const [store] = useState(() => createProjectSidebarStore(userId, organizationId))
	const order = useStore(store, (state) => state.order)
	const data = useProjectSidebarData(userId)
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
	const [createOpen, setCreateOpen] = useState(false)
	const derived = deriveProjectSidebar({ ...data, order })
	// Cached metadata stays useful during refetch errors. Unresolved relations must not
	// classify projects as empty, but must not hide already resolved task groups either.
	const layout = layoutProjectSidebar(
		data.isReady ? derived.groups : [],
		data.isReady && data.projectsState === 'ready' && !derived.pendingRelations && !derived.failedRelations
			? derived.emptyProjects
			: [],
		data.projects,
		order,
	)
	const groups = layout.groups
	const visibleTasks = groups.filter((group) => !collapsed.has(group.id)).flatMap((group) => group.tasks)
	// Only observe resolved groups. A pending read cannot mutate saved order or assign a task to Other.
	const snapshot = groups
		.filter((group) => group.project || group.id === 'other')
		.map((group) => ({ id: group.id, taskIds: group.tasks.map((task) => task.id) }))
	const projectIds = groups.filter((group) => group.project).map((group) => group.id)
	return (
		<ProjectSidebarFrame tasks={visibleTasks} standaloneSessions={data.standaloneSessions}>
			<ProjectSidebarArchiveSync store={store} />
			<ProjectSidebarOrderSnapshot key={JSON.stringify(snapshot)} store={store} groups={snapshot} />
			<div className="flex items-center pr-3">
				<SidebarSectionHeader icon="projects" label="Your projects" />
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							aria-label="Create a project"
							className="ml-auto size-6 text-muted-foreground hover:text-accent"
							onClick={() => setCreateOpen(true)}
						>
							<Plus aria-hidden className="size-3" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="right">Create a project</TooltipContent>
				</Tooltip>
			</div>
			<CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => {}} />
			<ProjectSidebarReadNotice
				error={Boolean(data.error)}
				ready={data.isReady}
				projectsPending={data.projectsState === 'pending'}
				workspaceError={derived.failedRelations || data.workspaceError}
				retry={data.retry}
			/>
			{data.projectsState === 'ready' && !data.error && !data.projects.some((project) => !project.archived) ? (
				<CreateProjectPrompt onCreate={() => setCreateOpen(true)} />
			) : null}
			{groups.map((group) => {
				return (
					<ProjectSidebarGroup
						key={group.id}
						group={group}
						projectIds={projectIds}
						store={store}
						open={!collapsed.has(group.id)}
						onToggle={() =>
							setCollapsed((previous) => {
								const next = new Set(previous)
								if (next.has(group.id)) next.delete(group.id)
								else next.add(group.id)
								return next
							})
						}
					/>
				)
			})}
			{data.isReady && !data.error && groups.length === 0 ? (
				<p className="p-3 text-xs text-muted-foreground">No active tasks. Create a task to get started.</p>
			) : null}
			<ProjectSidebarExtras standaloneSessions={data.standaloneSessions} emptyProjects={layout.emptyProjects} />
		</ProjectSidebarFrame>
	)
}
