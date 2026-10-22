import type { Session } from '@humanlayer/db/tables/sessions'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { useRef, useState } from 'react'

import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/minimalist/components/Menu'
import { useTask } from '@/minimalist/lib/data'
import { formatAgo, toMs } from '@/minimalist/lib/format'
import { chapterName, phaseOf } from '@/minimalist/lib/phases'
import { statusLabel } from '@/minimalist/lib/status'

/**
 * The title bar's "› Research" crumb: the task's sessions, and a new one. A task
 * with one freeform session has nothing to switch between, so it shows nothing.
 */
export function ChapterMenu({ session }: { session: Session }) {
	const navigate = useNavigate()
	const taskId = session.task_id
	const { sessions: chapters } = useTask(taskId)
	const anchor = useRef<HTMLButtonElement>(null)
	const [open, setOpen] = useState(false)
	if (chapters.length < 2 && !phaseOf(session)) return null
	const index = Math.max(
		0,
		chapters.findIndex((chapter) => chapter.id === session.id),
	)

	return (
		<>
			<span className="crumb">›</span>
			<button type="button" ref={anchor} className="btn ghost chapter" onClick={() => setOpen(true)}>
				{chapterName(session, index)}
				<ChevronDown className="i sm" />
			</button>
			<Menu anchor={anchor} open={open} onClose={() => setOpen(false)} width={300}>
				<MenuLabel>Sessions in this task</MenuLabel>
				{chapters.map((chapter, position) => (
					<MenuItem
						key={chapter.id}
						label={`${chapterName(chapter, position)}${chapter.archived ? ' (archived)' : ''}`}
						detail={`${statusLabel(chapter.status)} · ${formatAgo(toMs(chapter.created_at))}`}
						checked={chapter.id === session.id}
						onSelect={() => {
							setOpen(false)
							if (taskId)
								void navigate({
									to: '/tasks/$taskId',
									params: { taskId },
									search: { session: chapter.id },
								})
						}}
					/>
				))}
				{taskId ? (
					<>
						<MenuSeparator />
						<MenuItem
							label="New session in this task"
							onSelect={() => {
								setOpen(false)
								void navigate({ to: '/', search: { task: taskId } })
							}}
						/>
					</>
				) : null}
			</Menu>
		</>
	)
}
