import { Link } from '@tanstack/react-router'
import { Archive, MoreHorizontal } from 'lucide-react'
import { useRef, useState } from 'react'

import { useBrowserAuth as useAuth } from '@/hooks/use-browser-auth'
import { WiredUserAvatar } from '@/minimalist/components/Avatar'
import { Menu, MenuItem, MenuSeparator } from '@/minimalist/components/Menu'
import { TextDialog } from '@/minimalist/components/TextDialog'
import type { TaskRow } from '@/minimalist/lib/data'
import { newTaskDraftKey, useHasDraft } from '@/minimalist/lib/drafts'
import { formatAge } from '@/minimalist/lib/format'
import { phaseOf } from '@/minimalist/lib/phases'
import { shortcutHint } from '@/minimalist/lib/shortcuts'
import { statusText } from '@/minimalist/lib/status'
import { useUi } from '@/minimalist/lib/ui-state'
import { useArchive } from '@/minimalist/lib/use-archive'
import { useCopy } from '@/minimalist/lib/use-copy'
import { useTaskUnread, useUnreadActions } from '@/minimalist/lib/use-unread'
import { useRiptideApi } from '@/orpc/client'

/** A task in the sidebar: its name and state, archive on hover, and a menu on right-click or "More". */
export function TaskItem({ row, selected }: { row: TaskRow; selected: boolean }) {
	const { client: api } = useRiptideApi()
	const { user } = useAuth()
	const { closeSidebarOnNarrow } = useUi()
	const copy = useCopy()
	const unread = useTaskUnread(row.sessions)
	const status = statusText(row, unread)
	const { markRead, markUnread } = useUnreadActions()
	const archiver = useArchive()
	const anchor = useRef<HTMLDivElement>(null)
	const [open, setOpen] = useState(false)
	const [renaming, setRenaming] = useState(false)
	const taskId = row.task.id
	const latest = row.latest
	const archive = () => {
		setOpen(false)
		void archiver.archive({ kind: 'task', id: taskId }, true)
	}
	const link = `${window.location.origin}/tasks/${taskId}`
	return (
		<div
			ref={anchor}
			className="task-row"
			onContextMenu={(event) => {
				event.preventDefault()
				setOpen(true)
			}}
		>
			<Link
				to="/tasks/$taskId"
				onClick={closeSidebarOnNarrow}
				params={{ taskId }}
				className={`row child ${selected ? 'sel' : ''}${unread ? ' unread' : ''}`}
				title={row.task.name}
				aria-current={selected ? 'page' : undefined}
			>
				<span className="t">{row.task.is_draft ? row.task.name || 'Untitled draft' : row.task.name}</span>
				{/* Someone else's task, which you started a session in, shows whose it is. */}
				{user && row.task.resource_owner_user_id !== user.id ? (
					<WiredUserAvatar userId={row.task.resource_owner_user_id} size={16} />
				) : null}
				{/* The mark hides while the row has focus, so its meaning goes in the link's name. */}
				{status ? <span className="sr-only">, {status}</span> : null}
				<span className="rowmeta" aria-hidden="true">
					<TaskMark row={row} unread={unread} selected={selected} />
				</span>
			</Link>
			<span className="row-acts">
				<button
					type="button"
					title={`Archive task (${shortcutHint('archive')})`}
					aria-label={`Archive ${row.task.name}`}
					disabled={archiver.pending}
					onClick={archive}
				>
					<Archive className="i sm" strokeWidth={1.6} />
				</button>
				<button
					type="button"
					title="More"
					aria-label={`More for ${row.task.name}`}
					onClick={() => setOpen(true)}
				>
					<MoreHorizontal className="i sm" strokeWidth={1.6} />
				</button>
			</span>
			<Menu anchor={anchor} open={open} onClose={() => setOpen(false)} placement="below-end" width={220}>
				<MenuItem
					label="Rename"
					onSelect={() => {
						setOpen(false)
						setRenaming(true)
					}}
				/>
				<MenuItem
					label={unread ? 'Mark as read' : 'Mark as unread'}
					kbd={unread ? undefined : shortcutHint('mark-unread')}
					disabled={!latest}
					onSelect={() => {
						setOpen(false)
						if (unread) markRead(row.sessions)
						else if (latest) void markUnread(taskId, latest.id)
					}}
				/>
				<MenuItem label="Archive" kbd={shortcutHint('archive')} onSelect={archive} />
				<MenuSeparator />
				<MenuItem
					label="Copy link"
					onSelect={() => {
						setOpen(false)
						copy(link, 'Link copied', 'Could not copy the link. Copy it from the address bar.')
					}}
				/>
				<MenuItem
					label="Open in new window"
					onSelect={() => {
						setOpen(false)
						window.open(link, '_blank', 'noopener')
					}}
				/>
			</Menu>
			{renaming ? (
				<TextDialog
					title="Rename task"
					initialValue={row.task.name ?? ''}
					submitLabel="Save name"
					onClose={() => setRenaming(false)}
					onSave={(name) => api.tasks.update({ taskId, name })}
				/>
			) : null}
		</div>
	)
}

/**
 * The most urgent of running, needs you, failed and unread; then "Draft" when a message is half
 * written somewhere else than the open task; otherwise the RPI phase or age.
 */
export function TaskMark({ row, unread, selected }: { row: TaskRow; unread: boolean; selected: boolean }) {
	const drafted = useHasDraft([...row.sessions.map((session) => session.id), newTaskDraftKey(row.task.id)])
	if (row.attention === 'running') return <span className="spin" />
	if (row.attention === 'needs-you') return <span className="dot warn" />
	if (row.attention === 'failed') return <span className="dot err" />
	if (unread) return <span className="dot" />
	if (drafted && !selected) return <span className="meta draft">Draft</span>
	const phase = row.latest ? phaseOf(row.latest) : null
	return <span className="meta">{phase ?? formatAge(row.lastActivity)}</span>
}
