import { useQuery } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams } from '@tanstack/react-router'
import { Folder, FolderOpen, GitBranch, MoreHorizontal, Plus, SquarePen } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Menu, MenuItem } from '@/minimalist/components/Menu'
import { TaskItem } from '@/minimalist/components/TaskItem'
import { type ProjectGroup, repoName, useOpenTaskId, useTaskTree } from '@/minimalist/lib/data'
import { formatAge, toMs } from '@/minimalist/lib/format'
import { sessionName } from '@/minimalist/lib/session-name'
import { useUi } from '@/minimalist/lib/ui-state'
import { useAction } from '@/minimalist/lib/use-action'
import { useRiptideApi } from '@/orpc/client'

const TASKS_PER_PROJECT = 5
const STANDALONE_SESSIONS = 8

/**
 * The sidebar's default view: each project with its latest tasks, then sessions outside any task.
 * Other people's projects show only while they hold one of your tasks; the composer's project
 * picker still lists every project.
 */
export function ProjectList() {
	const { groups: allGroups, standalone, isReady } = useTaskTree()
	const groups = allGroups.filter((group) => group.mine || group.tasks.length > 0)
	const { closeSidebarOnNarrow } = useUi()
	const params = useParams({ strict: false }) as { sessionId?: string }
	const openTaskId = useOpenTaskId()
	const location = useLocation()
	const homeSearch = location.search as { project?: string; dir?: string }
	// On the home screen, the project the composer will launch into
	const selectedProject =
		location.pathname === '/'
			? (homeSearch.project ?? (homeSearch.dir ? `dir:${repoName(homeSearch.dir)}` : null))
			: null

	return (
		<>
			<div className="section">
				Projects
				<span className="sp" />
				<Link className="section-act" to="/settings/projects/new" title="Add project" aria-label="Add project">
					<Plus className="i sm" strokeWidth={1.6} />
				</Link>
			</div>
			{isReady ? null : <SkeletonRows />}
			{isReady && groups.length === 0 ? (
				<div className="empty">
					Add a project to start. <Link to="/settings/projects/new">Add project</Link>
				</div>
			) : null}
			{groups.map((group) => (
				<ProjectSection
					key={group.key}
					group={group}
					selected={group.key === selectedProject}
					selectedTaskId={openTaskId}
				/>
			))}
			{standalone.length > 0 ? <div className="section">Sessions</div> : null}
			{standalone.slice(0, STANDALONE_SESSIONS).map((session) => (
				<Link
					key={session.id}
					to="/sessions/$sessionId"
					onClick={closeSidebarOnNarrow}
					params={{ sessionId: session.id }}
					className={`row child session ${session.id === params.sessionId ? 'sel' : ''}`}
				>
					<span className="t">{sessionName(session)}</span>
					<span className="meta rowmeta">{formatAge(toMs(session.last_activity_at))}</span>
				</Link>
			))}
		</>
	)
}

function ProjectSection({
	group,
	selected,
	selectedTaskId,
}: {
	group: ProjectGroup
	selected: boolean
	selectedTaskId: string | undefined
}) {
	const { closeSidebarOnNarrow } = useUi()
	const containsSelected = group.tasks.some((row) => row.task.id === selectedTaskId)
	const [collapsed, toggleCollapsed, reveal] = useCollapsed(group.key)
	const [showAll, setShowAll] = useState(false)
	useEffect(() => {
		if (containsSelected) {
			reveal()
			setShowAll(true)
		}
	}, [selectedTaskId, containsSelected, reveal])
	const visible = showAll ? group.tasks : group.tasks.slice(0, TASKS_PER_PROJECT)
	return (
		<div>
			<div className={`row proj${selected ? ' sel' : ''}`}>
				<button
					type="button"
					className="proj-toggle"
					aria-expanded={!collapsed}
					title={
						isShared(group)
							? `${group.detail ?? group.name}\nShared with you`
							: (group.detail ?? group.name)
					}
					onClick={toggleCollapsed}
				>
					<ProjectIcon project={isProject(group)} shared={isShared(group)} open={!collapsed} />
					<span className="t">{group.name}</span>
				</button>
				<span className="acts">
					<Link
						to="/"
						search={newTaskSearch(group)}
						onClick={closeSidebarOnNarrow}
						title={`New task in ${group.name}`}
						aria-label={`New task in ${group.name}`}
					>
						<SquarePen className="i sm" strokeWidth={1.6} />
					</Link>
					{group.workspaceReadFailed && group.tasks[0] ? (
						<WiredProjectRetry taskId={group.tasks[0].task.id} />
					) : (
						<ProjectMenu group={group} />
					)}
				</span>
			</div>
			{collapsed
				? null
				: visible.map((row) => (
						<TaskItem key={row.task.id} row={row} selected={row.task.id === selectedTaskId} />
					))}
			{!collapsed && group.tasks.length > TASKS_PER_PROJECT ? (
				<button type="button" className="row more" onClick={() => setShowAll(!showAll)}>
					{showAll ? 'Show less' : 'Show more'}
				</button>
			) : null}
		</div>
	)
}

/** A HumanLayer project, including one whose workspace is still loading; the rest group by directory. */
function isProject(group: ProjectGroup): boolean {
	return group.projectId !== null || group.key.startsWith('workspace:')
}

/** Someone else's project, listed because it holds one of your tasks. */
function isShared(group: ProjectGroup): boolean {
	return group.projectId !== null && !group.mine
}

/**
 * An open or closed folder; projects carry a branch mark in the corner so they read apart from
 * directories, and projects shared with you are blue.
 */
function ProjectIcon({ project, shared, open }: { project: boolean; shared: boolean; open: boolean }) {
	const FolderIcon = open ? FolderOpen : Folder
	return (
		<span className={`proj-icon${project ? ' project' : ''}${shared ? ' shared' : ''}`}>
			<FolderIcon className="i" strokeWidth={1.6} />
			{project ? <GitBranch className="proj-badge" strokeWidth={2.4} /> : null}
		</span>
	)
}

const COLLAPSED_KEY = 'hl-min-collapsed-projects'

function readCollapsed(): string[] {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')
		return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : []
	} catch {
		return []
	}
}

/** Collapsed projects stay collapsed across reloads on this device. */
function useCollapsed(key: string): [boolean, () => void, () => void] {
	const [collapsed, setCollapsed] = useState(() => readCollapsed().includes(key))
	const toggle = () => {
		const others = readCollapsed().filter((entry) => entry !== key)
		try {
			localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed ? others : [...others, key]))
		} catch {
			// Storage is blocked; the project still toggles until reload.
		}
		setCollapsed(!collapsed)
	}
	const reveal = useCallback(() => {
		setCollapsed(false)
		try {
			localStorage.setItem(COLLAPSED_KEY, JSON.stringify(readCollapsed().filter((entry) => entry !== key)))
		} catch {
			// The group still reveals this visit.
		}
	}, [key])
	return [collapsed, toggle, reveal]
}

/** Home, preset to this project, or to the directory its latest task ran in. */
function newTaskSearch(group: ProjectGroup): { project?: string; dir?: string } {
	if (group.projectId) return { project: group.projectId }
	const latest = group.tasks[0]
	const dir = latest?.task.default_working_directory ?? latest?.latest?.working_directory
	return dir ? { dir } : {}
}

/** New task, edit, archive. Directory groups have no project to edit or archive. */
function ProjectMenu({ group }: { group: ProjectGroup }) {
	const { client: api } = useRiptideApi()
	const { showToast, closeSidebarOnNarrow } = useUi()
	const navigate = useNavigate()
	const action = useAction()
	const anchor = useRef<HTMLButtonElement>(null)
	const [open, setOpen] = useState(false)
	const projectId = group.projectId
	const archive = async (archived: boolean) => {
		if (!projectId) return
		setOpen(false)
		const saved = await action.run(
			() => api.projects.v2.archive({ projectId, archived }),
			`Could not ${archived ? 'archive' : 'unarchive'} ${group.name}. Try again.`,
		)
		if (saved)
			showToast(archived ? `${group.name} archived` : `${group.name} unarchived`, {
				label: 'Undo',
				run: () => void archive(!archived),
			})
	}
	return (
		<>
			<button
				type="button"
				ref={anchor}
				title="More"
				aria-label={`More for ${group.name}`}
				onClick={() => setOpen(true)}
			>
				<MoreHorizontal className="i sm" strokeWidth={1.6} />
			</button>
			<Menu anchor={anchor} open={open} onClose={() => setOpen(false)} placement="below-end" width={220}>
				<MenuItem
					label="New task in project"
					onSelect={() => {
						setOpen(false)
						closeSidebarOnNarrow()
						void navigate({ to: '/', search: newTaskSearch(group) })
					}}
				/>
				{projectId ? (
					<>
						<MenuItem
							label="Edit project"
							onSelect={() => {
								setOpen(false)
								void navigate({ to: '/settings/projects' })
							}}
						/>
						<MenuItem
							label="Archive project"
							detail="Workspaces on your hosts are kept"
							onSelect={() => void archive(true)}
						/>
					</>
				) : null}
			</Menu>
		</>
	)
}

function SkeletonRows() {
	return (
		<>
			<div className="skeleton" />
			<div className="skeleton" />
			<div className="skeleton" />
		</>
	)
}

function WiredProjectRetry({ taskId }: { taskId: string }) {
	const { queryClient: api } = useRiptideApi()
	const query = useQuery(api.projectWorkspaces.getStatus.queryOptions({ input: { taskId } }))
	return (
		<button
			type="button"
			className="linkbtn"
			aria-label="Retry loading project"
			disabled={query.isFetching}
			onClick={() => void query.refetch()}
		>
			Retry
		</button>
	)
}
