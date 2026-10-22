import { Button } from '@humanlayer/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { useNavigate } from '@tanstack/react-router'
import { ChevronRight, FolderTree, GitBranch, GripVertical, Plus } from 'lucide-react'
import { type DragEvent, type ReactNode, useRef } from 'react'

import { WiredTaskRow } from '@/components/sidebar-task-tree/WiredTaskRow'
import type { ProjectSidebarStore } from '@/hooks/stores/projectSidebarStore'
import { useMountEffect } from '@/hooks/useMountEffect'

import type { ProjectSidebarGroup as Group, SidebarProject } from './derive-project-sidebar'

const DRAG_TYPE = 'application/x-humanlayer-project-sidebar'
type DragItem = { group: null; id: string }

function readDrag(event: DragEvent): DragItem | null {
	try {
		const item = JSON.parse(event.dataTransfer.getData(DRAG_TYPE))
		return item && typeof item.id === 'string' && item.group === null ? item : null
	} catch {
		return null
	}
}

export function ReorderRow({
	group,
	id,
	name,
	ids,
	store,
	children,
}: {
	group: null
	id: string
	name: string
	ids: string[]
	store: ProjectSidebarStore
	children: ReactNode
}) {
	const rowRef = useRef<HTMLDivElement>(null)
	const hoverCleanup = useRef<(() => void) | null>(null)
	const clearDragOver = () => {
		hoverCleanup.current?.()
		hoverCleanup.current = null
		rowRef.current?.removeAttribute('data-drag-over')
	}
	const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
		if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
		event.preventDefault()
		event.stopPropagation()
		event.dataTransfer.dropEffect = 'move'
		// Hover feedback stays in the DOM: no tree renders or persisted writes per dragover.
		if (event.currentTarget.hasAttribute('data-drag-over')) return
		event.currentTarget.setAttribute('data-drag-over', '')
		window.addEventListener('dragend', clearDragOver, true)
		window.addEventListener('drop', clearDragOver, true)
		hoverCleanup.current = () => {
			window.removeEventListener('dragend', clearDragOver, true)
			window.removeEventListener('drop', clearDragOver, true)
		}
	}
	const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
		if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
		clearDragOver()
	}
	const handleDrop = (event: DragEvent<HTMLDivElement>) => {
		if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
		event.preventDefault()
		event.stopPropagation()
		clearDragOver()
		const item = readDrag(event)
		if (item?.group === group && item.id !== id && ids.includes(item.id))
			store.getState().move(group, ids, item.id, id)
	}
	const handleDragStart = (event: DragEvent<HTMLButtonElement>) => {
		event.stopPropagation()
		event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ group, id }))
		event.dataTransfer.effectAllowed = 'move'
		const row = rowRef.current
		if (!row) return
		const bounds = row.getBoundingClientRect()
		event.dataTransfer.setDragImage(row, event.clientX - bounds.left, event.clientY - bounds.top)
	}
	useMountEffect(() => {
		return () => clearDragOver()
	})
	return (
		<div
			ref={rowRef}
			className={`group/reorder-row flex min-w-0 items-center hover:bg-sidebar-accent data-[drag-over]:ring-1 data-[drag-over]:ring-sidebar-ring ${group === null ? 'border-r-2 border-r-transparent' : ''}`}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDragEnd={clearDragOver}
			onDrop={handleDrop}
		>
			<div className="min-w-0 flex-1">{children}</div>
			<div className="flex shrink-0 items-center py-1 text-muted-foreground">
				<button
					type="button"
					draggable
					aria-label={`Drag ${name}`}
					className="cursor-grab p-0.5"
					onDragStart={handleDragStart}
				>
					<GripVertical aria-hidden className="size-3" />
				</button>
			</div>
		</div>
	)
}

export function ProjectHeading({ project, children }: { project?: SidebarProject; children: ReactNode }) {
	const navigate = useNavigate()
	const handleCreateTask = () => {
		if (!project) return
		return navigate({ to: '/tasks/new', search: { projectId: project.id } })
	}
	return (
		<div className="group/project-row flex min-w-0 items-center gap-1 px-2 hover:bg-sidebar-accent">
			{children}
			{project?.archived ? (
				<span
					className="ml-auto text-[10px]"
					title="New tasks cannot be created from an archived project. Existing tasks and sessions remain accessible."
				>
					Archived
				</span>
			) : project ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							aria-label={`Create task in ${project.name}`}
							className="ml-auto size-6 text-muted-foreground hover:text-accent"
							onClick={handleCreateTask}
						>
							<Plus aria-hidden className="size-3" />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="right">Create task in {project.name}</TooltipContent>
				</Tooltip>
			) : null}
		</div>
	)
}

export function ProjectName({ name, isProject = true }: { name: string; isProject?: boolean }) {
	return (
		<span className="flex min-w-0 items-center gap-1 text-sm font-normal text-sidebar-foreground">
			{isProject ? <FolderTree aria-hidden className="size-3 shrink-0 text-muted-foreground" /> : null}
			<span className="truncate">{name}</span>
		</span>
	)
}

export function ProjectSidebarGroup({
	group,
	store,
	open,
	onToggle,
	projectIds,
}: {
	group: Group
	store: ProjectSidebarStore
	open: boolean
	onToggle: () => void
	projectIds: string[]
}) {
	const heading = (
		<ProjectHeading project={group.project}>
			{group.tasks.length === 0 ? (
				<span className="flex min-w-0 flex-1 items-center gap-1 py-1.5">
					<span aria-hidden className="size-3 shrink-0" />
					<ProjectName name={group.name} isProject={Boolean(group.project)} />
				</span>
			) : (
				<button
					type="button"
					className="flex min-w-0 flex-1 items-center gap-1 self-stretch py-1.5 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring"
					aria-label={group.name}
					aria-expanded={open}
					onClick={onToggle}
				>
					<ChevronRight
						aria-hidden
						className={`size-3 shrink-0 text-muted-foreground transition-transform group-hover/project-row:text-sidebar-foreground ${open ? 'rotate-90' : ''}`}
					/>
					<ProjectName name={group.name} isProject={Boolean(group.project)} />
				</button>
			)}
		</ProjectHeading>
	)
	return (
		<section aria-label={group.name}>
			{group.project ? (
				<ReorderRow group={null} id={group.id} name={group.name} ids={projectIds} store={store}>
					{heading}
				</ReorderRow>
			) : (
				heading
			)}
			{open ? (
				<ul>
					{group.tasks.map((task) => (
						<WiredTaskRow
							key={task.id}
							task={task}
							projectTree
							leadingIcon={<GitBranch aria-hidden className="size-3 shrink-0 text-muted-foreground" />}
							allSessionIds={task.allSessionIds}
						/>
					))}
				</ul>
			) : null}
		</section>
	)
}
