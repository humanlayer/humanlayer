import { SidebarSectionHeader } from '@humanlayer/ui/components/sidebar/SidebarSectionHeader'
import type { SidebarSession } from '@humanlayer/ui/components/sidebar/types'
import { ChevronRight } from 'lucide-react'
import { useId, useState } from 'react'

import { WiredSessionRow } from '@/components/sidebar-task-tree/WiredSessionRow'

import type { SidebarProject } from './derive-project-sidebar'
import { ProjectHeading, ProjectName } from './ProjectSidebarGroup'

/** These sections never participate in populated-project drag ordering. */
export function ProjectSidebarExtras({
	standaloneSessions,
	emptyProjects,
}: {
	standaloneSessions: SidebarSession[]
	emptyProjects: SidebarProject[]
}) {
	const [emptyOpen, setEmptyOpen] = useState(false)
	const emptyId = useId()
	return (
		<>
			{standaloneSessions.length > 0 ? (
				<section className="mt-4">
					<SidebarSectionHeader icon="standalone" label="Standalone Sessions" />
					<ul>
						{standaloneSessions.map((session) => (
							<WiredSessionRow key={session.id} session={session} projectTree />
						))}
					</ul>
				</section>
			) : null}
			{emptyProjects.length > 0 ? (
				<section className="mt-4">
					<button
						type="button"
						aria-expanded={emptyOpen}
						aria-controls={emptyId}
						className="flex w-full items-center gap-1 px-2 py-2 text-left text-xs font-medium text-muted-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring"
						onClick={() => setEmptyOpen(!emptyOpen)}
					>
						<ChevronRight
							aria-hidden
							className={`size-3 shrink-0 transition-transform ${emptyOpen ? 'rotate-90' : ''}`}
						/>
						Empty projects
					</button>
					<div id={emptyId} hidden={!emptyOpen} className="pl-4">
						{emptyProjects.map((project) => (
							<ProjectHeading key={project.id} project={project}>
								<span aria-hidden className="size-3 shrink-0" />
								<span className="min-w-0 py-1.5">
									<ProjectName name={project.name} />
								</span>
							</ProjectHeading>
						))}
					</div>
				</section>
			) : null}
		</>
	)
}

export function ProjectSidebarReadNotice({
	error,
	ready,
	projectsPending,
	workspaceError,
	retry,
}: {
	error: boolean
	ready: boolean
	projectsPending: boolean
	workspaceError: boolean
	retry: () => void
}) {
	if (error)
		return (
			<div role="alert" className="p-3 text-xs">
				Tasks or projects could not be loaded.{' '}
				<button type="button" onClick={retry}>
					Retry
				</button>
			</div>
		)
	if (workspaceError)
		return (
			<div role="alert" className="p-2 text-xs">
				Some project details could not be loaded. Tasks remain visible.{' '}
				<button type="button" onClick={retry}>
					Retry
				</button>
			</div>
		)
	if (!ready)
		return (
			<p role="status" className="p-3 text-xs">
				Loading tasks and projects…
			</p>
		)
	if (projectsPending)
		return (
			<p role="status" className="p-2 text-xs">
				Loading projects…
			</p>
		)
	return null
}
