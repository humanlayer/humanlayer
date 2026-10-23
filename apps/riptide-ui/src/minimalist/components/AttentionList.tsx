import { Link } from '@tanstack/react-router'
import { Check, MessageCircle, MessageSquareDiff, Reply, Users, X } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useRef } from 'react'

import { notificationRowView } from '@/components/notifications/notification-row-view'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import type { NotificationKind, NotificationRow } from '@/lib/notifications/notification-row'
import { attentionSections } from '@/minimalist/lib/attention'
import { type TaskRow, useOpenTaskId, useTaskTree } from '@/minimalist/lib/data'
import type { MinimalistInbox } from '@/minimalist/lib/inbox'
import { shortcutHint } from '@/minimalist/lib/shortcuts'
import { useUi } from '@/minimalist/lib/ui-state'

/** Shared notifications first; Running and Today remain a separate task overview. */
export function AttentionList({ rows, synced, openNotification, dismissNotification }: MinimalistInbox) {
	const { membersMap } = useOrgMembers()
	const list = useRef<HTMLDivElement>(null)
	const rowButtons = useRef(new Map<string, HTMLButtonElement>())
	const focusRow = (index: number) => {
		const row = rows[Math.min(rows.length - 1, Math.max(0, index))]
		const button = row ? rowButtons.current.get(row.key) : undefined
		button?.focus()
		button?.scrollIntoView?.({ block: 'nearest' })
	}
	const dismissRow = (row: NotificationRow) => {
		const index = rows.indexOf(row)
		if (!dismissNotification(row)) return
		if (rows.length === 1) list.current?.focus()
		else focusRow(index + 1 < rows.length ? index + 1 : index - 1)
	}
	const handleRowKey = (event: KeyboardEvent<HTMLButtonElement>, row: NotificationRow, index: number) => {
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
		if (event.key === 'ArrowDown' || event.key === 'j') focusRow(index + 1)
		else if (event.key === 'ArrowUp' || event.key === 'k') focusRow(index - 1)
		else if (event.key === 'e') dismissRow(row)
		else return
		event.preventDefault()
		event.stopPropagation()
	}
	return (
		<>
			<div ref={list} role="group" aria-label="Needs you" tabIndex={-1}>
				<div className="section">
					Needs you{rows.length > 0 ? ` · ${rows.length}` : null}
					<span className="sp" />
					<span className="kbd">{shortcutHint('next-attention')}</span>
				</div>
				{synced ? null : <div className="skeleton" />}
				{synced && rows.length === 0 ? <div className="empty">Nothing needs you</div> : null}
				{rows.map((row, index) => {
					const view = notificationRowView(row, membersMap)
					return (
						<div
							className={row.dismissible ? 'task-row' : undefined}
							key={row.key}
							data-notification-kind={row.kind}
							data-notification-key={row.key}
						>
							<button
								type="button"
								className="row urgent notification-row"
								ref={(button) => {
									if (button) rowButtons.current.set(row.key, button)
									else rowButtons.current.delete(row.key)
								}}
								onClick={() => openNotification(row)}
								onKeyDown={(event) => handleRowKey(event, row, index)}
							>
								<NotificationMark kind={row.kind} />
								<span className="lines">
									<span className="ell">
										{view.actorName ? `${view.actorName} ${view.action}` : view.action}
									</span>
									<span className="ell">
										{view.subject}
										{view.taskName ? ` · ${view.taskName}` : null}
									</span>
									{view.detail ? <span className="why ell">{view.detail}</span> : null}
								</span>
								<span className="rowmeta why">{view.age}</span>
							</button>
							{row.dismissible ? (
								<span className="row-acts">
									<button
										type="button"
										title="Dismiss notification"
										aria-label={`Dismiss notification for ${view.subject}`}
										onClick={() => dismissRow(row)}
										onKeyDown={(event) => handleRowKey(event, row, index)}
									>
										<X className="i sm" strokeWidth={1.6} />
									</button>
								</span>
							) : null}
						</div>
					)
				})}
			</div>
			<TaskOverview />
		</>
	)
}

function NotificationMark({ kind }: { kind: NotificationKind }) {
	switch (kind) {
		case 'approval':
			return <span className="dot warn" aria-hidden="true" />
		case 'ready_for_input':
			return <span className="dot" aria-hidden="true" />
		case 'session_failed':
		case 'workspace_setup_failed':
			return <span className="dot err" aria-hidden="true" />
		case 'prompt_invite':
			return <Users className="i sm" strokeWidth={1.6} aria-hidden="true" />
		case 'artifact_comment':
			return <MessageCircle className="i sm" strokeWidth={1.6} aria-hidden="true" />
		case 'thread_reply':
			return <Reply className="i sm" strokeWidth={1.6} aria-hidden="true" />
		case 'diff_comment':
			return <MessageSquareDiff className="i sm" strokeWidth={1.6} aria-hidden="true" />
	}
}

function TaskOverview() {
	const { groups, isReady } = useTaskTree()
	const taskId = useOpenTaskId()
	const { running, today } = attentionSections(groups.flatMap((group) => group.tasks))
	return (
		<>
			<div className="section">Running</div>
			{isReady ? null : <div className="skeleton" />}
			{isReady && running.length === 0 ? <div className="empty">Nothing running</div> : null}
			{running.map((row) => (
				<AttentionRow key={row.task.id} row={row} selected={row.task.id === taskId}>
					<span className="spin" />
					<span className="ell">{row.task.name}</span>
				</AttentionRow>
			))}
			{today.length > 0 ? <div className="section">Today</div> : null}
			{today.map((row) => (
				<AttentionRow key={row.task.id} row={row} selected={row.task.id === taskId} className="done">
					<Check className="i sm" strokeWidth={1.6} />
					<span className="ell">{row.task.name}</span>
				</AttentionRow>
			))}
		</>
	)
}

function AttentionRow({
	row,
	selected,
	className,
	children,
}: {
	row: TaskRow
	selected: boolean
	className?: string
	children: ReactNode
}) {
	const { closeSidebarOnNarrow } = useUi()
	return (
		<Link
			to="/tasks/$taskId"
			onClick={closeSidebarOnNarrow}
			params={{ taskId: row.task.id }}
			className={`row${selected ? ' sel' : ''}${className ? ` ${className}` : ''}`}
		>
			{children}
		</Link>
	)
}
