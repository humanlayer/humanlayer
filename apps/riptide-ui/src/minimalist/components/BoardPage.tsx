import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { assignColumn, KANBAN_COLUMN_DEFS } from '@/lib/kanban/columnEngine'
import { WiredUserAvatar } from '@/minimalist/components/Avatar'
import { Segmented } from '@/minimalist/components/SettingsControls'
import { TaskMark } from '@/minimalist/components/TaskItem'
import { type TaskRow, type TaskTreeScope, useTaskTree } from '@/minimalist/lib/data'
import { statusText } from '@/minimalist/lib/status'
import { useUi } from '@/minimalist/lib/ui-state'
import { useTaskUnread } from '@/minimalist/lib/use-unread'

const SCOPES: Array<{ value: TaskTreeScope; label: string }> = [
	{ value: 'mine', label: 'Mine' },
	{ value: 'everyone', label: 'Everyone' },
]

/** Tasks as a board, one column per RPI phase, placed the same way as the standard board. */
export function BoardPage() {
	const [scope, setScope] = useState<TaskTreeScope>('everyone')
	const { recent: rows, isReady } = useTaskTree(false, scope)
	const columns = KANBAN_COLUMN_DEFS.map((column) => ({ ...column, rows: [] as TaskRow[] }))
	const byId = new Map(columns.map((column) => [column.id, column]))
	for (const row of rows) {
		const id = assignColumn(
			row.task,
			row.sessions.map((session) => ({
				archived: session.archived,
				labels: session.labels,
				last_activity_at: session.last_activity_at,
			})),
		)
		byId.get(id)?.rows.push(row)
	}
	return (
		<main className="main board">
			<div className="titlebar">
				<span className="title">Board</span>
				<span className="sp" />
				<Segmented label="Show" value={scope} options={SCOPES} onChange={setScope} />
			</div>
			{isReady && rows.length === 0 ? (
				<div className="hero">
					<h1 className="status">{scope === 'mine' ? 'No tasks of yours yet' : 'No tasks yet'}</h1>
					<Link className="btn" to="/">
						New task
					</Link>
				</div>
			) : (
				<div className="board-columns">
					{columns.map((column) => (
						<section key={column.id} className="board-column" aria-label={column.title}>
							<div className="section">
								{column.title}
								<span className="meta">{column.rows.length}</span>
							</div>
							<div className="board-cards">
								{column.rows.map((row) => (
									<BoardCard key={row.task.id} row={row} />
								))}
							</div>
						</section>
					))}
				</div>
			)}
		</main>
	)
}

function BoardCard({ row }: { row: TaskRow }) {
	const unread = useTaskUnread(row.sessions)
	const status = statusText(row, unread)
	const { closeSidebarOnNarrow } = useUi()
	return (
		<Link
			to="/tasks/$taskId"
			params={{ taskId: row.task.id }}
			onClick={closeSidebarOnNarrow}
			className={`board-card${unread ? ' unread' : ''}`}
			title={row.task.name}
		>
			<span className="board-card-name">{row.task.name}</span>
			{status ? <span className="sr-only">, {status}</span> : null}
			<span className="board-card-meta">
				<span className="ell">{row.projectName}</span>
				<span className="sp" />
				<WiredUserAvatar userId={row.task.resource_owner_user_id} size={18} />
				<span className="rowmeta" aria-hidden="true">
					<TaskMark row={row} unread={unread} selected={false} />
				</span>
			</span>
		</Link>
	)
}
