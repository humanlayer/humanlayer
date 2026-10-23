import type { Task } from '@humanlayer/db/tables/tasks'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { type OrgMember, useOrgMembers } from '@/hooks/useOrgMembers'
import { taskBranch, useHost, useProjects, useTask } from '@/minimalist/lib/data'
import { formatAgo, shortPath, toMs } from '@/minimalist/lib/format'
import { personName, taskPeople } from '@/minimalist/lib/people'
import { useTaskWorkflow, workflowOption, workflowOptions } from '@/minimalist/lib/task-workflow'
import { useCopy } from '@/minimalist/lib/use-copy'
import { useRiptideApi } from '@/orpc/client'

import { Avatar } from './Avatar'
import { Menu, MenuItem } from './Menu'

/**
 * Where the task runs and who is on it: project, directory, branch, host, workflow, ticket, owner,
 * and everyone else who started a session or left a comment.
 */
export function WiredTaskDetails({ taskId }: { taskId: string }) {
	const { task, sessions } = useTask(taskId)
	const { membersMap } = useOrgMembers()
	const project = useTaskProjectName(task)
	const commenters = useCommentAuthors(taskId)
	const latest = sessions.filter((session) => !session.archived).at(-1) ?? sessions.at(-1) ?? null
	const { host } = useHost(latest?.host_id, latest?.created_by)
	if (!task) return null

	const directory = latest?.working_directory || task.default_working_directory || null
	const branch = taskBranch(task)
	const owner = task.resource_owner_user_id
	const people = taskPeople(owner, [task.created_by, ...sessions.map((session) => session.created_by), ...commenters])

	return (
		<dl className="task-details" aria-label="Task details">
			{project ? <Detail term="Project">{project}</Detail> : null}
			{directory ? <DirectoryDetail directory={directory} /> : null}
			{branch ? (
				<Detail term="Branch">
					<span title={branch}>{branch}</span>
				</Detail>
			) : null}
			{host ? <Detail term="Host">{host.name}</Detail> : null}
			<WorkflowDetail taskId={taskId} />
			{task.ticket_id ? <TicketDetail id={task.ticket_id} url={task.ticket_url} /> : null}
			<Detail term="Owner">
				<Person userId={owner} member={membersMap.get(owner)} />
			</Detail>
			{people.length > 0 ? (
				<Detail term="People">
					<span className="task-people">
						{people.map((id) => (
							<Person key={id} userId={id} member={membersMap.get(id)} />
						))}
					</span>
				</Detail>
			) : null}
			<Detail term="Created">{formatAgo(toMs(task.created_at))}</Detail>
		</dl>
	)
}

/** A workspace task belongs to its workspace's project; any other task names its own. */
function useTaskProjectName(task: Task | null | undefined): string | undefined {
	const { queryClient: orpc } = useRiptideApi()
	const projects = useProjects()
	const workspace = useQuery({
		...orpc.projectWorkspaces.getStatus.queryOptions({
			input: { taskId: task?.id ?? '' },
			context: { silent: true },
		}),
		enabled: Boolean(task?.workspace_id),
	})
	const projectId = task?.workspace_id ? workspace.data?.workspace.projectId : task?.project_id
	return projectId ? projects.data?.find((entry) => entry.id === projectId)?.name : undefined
}

/** Who left a comment on the task's documents or its diff. */
function useCommentAuthors(taskId: string): Array<string | null> {
	const { artifactCommentsCollection: artifactComments, diffCommentsCollection: diffComments } = useSync()
	const artifactAuthors = useLiveQuery(
		(q) =>
			q
				.from({ comments: artifactComments })
				.where(({ comments }) => eq(comments.task_id, taskId))
				.select(({ comments }) => ({ userId: comments.created_by_user_id })),
		[artifactComments, taskId],
	)
	const diffAuthors = useLiveQuery(
		(q) =>
			q
				.from({ comments: diffComments })
				.where(({ comments }) => eq(comments.task_id, taskId))
				.select(({ comments }) => ({ userId: comments.created_by_user_id })),
		[diffComments, taskId],
	)
	const rows = artifactAuthors.data ?? []
	const diffRows = diffAuthors.data ?? []
	return rows.concat(diffRows).map((row) => row.userId)
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
	return (
		<div>
			<dt>{term}</dt>
			<dd>{children}</dd>
		</div>
	)
}

function DirectoryDetail({ directory }: { directory: string }) {
	const copy = useCopy()
	return (
		<Detail term="Directory">
			<button
				type="button"
				className="task-detail-copy"
				title={`${directory}\nCopy path`}
				onClick={() => copy(directory, 'Path copied', 'Could not copy the path')}
			>
				{shortPath(directory, 30)}
			</button>
		</Detail>
	)
}

/** The task's workflow. Its owner can switch it; everyone else reads it. */
function WorkflowDetail({ taskId }: { taskId: string }) {
	const { current, canChange, change } = useTaskWorkflow(taskId)
	const anchor = useRef<HTMLButtonElement>(null)
	const [open, setOpen] = useState(false)
	const option = workflowOption(current)
	if (!canChange)
		return (
			<Detail term="Workflow">
				<span title={option.description}>{option.label}</span>
			</Detail>
		)
	return (
		<Detail term="Workflow">
			<button
				type="button"
				ref={anchor}
				className="task-detail-pick"
				aria-label={`Workflow: ${option.label}`}
				title={`${option.description}\nChange workflow`}
				onClick={() => setOpen(true)}
			>
				{option.label}
				<ChevronDown className="i sm" />
			</button>
			<Menu anchor={anchor} open={open} onClose={() => setOpen(false)} width={300}>
				{workflowOptions(current).map((entry) => (
					<MenuItem
						key={entry.value}
						label={entry.label}
						detail={entry.description}
						checked={entry.value === current}
						onSelect={() => {
							setOpen(false)
							void change(entry.value)
						}}
					/>
				))}
			</Menu>
		</Detail>
	)
}

function TicketDetail({ id, url }: { id: string; url: string | null }) {
	return (
		<Detail term="Ticket">
			{url ? (
				<a href={url} target="_blank" rel="noreferrer">
					{id}
				</a>
			) : (
				id
			)}
		</Detail>
	)
}

function Person({ userId, member }: { userId: string; member: OrgMember | undefined }) {
	const name = personName(userId, member)
	return (
		<span className="task-person" title={member?.email ?? name}>
			<Avatar name={name} src={member?.profilePictureUrl} size={18} />
			<span className="ell">{name}</span>
		</span>
	)
}
