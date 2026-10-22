import type { Session } from '@humanlayer/db/tables/sessions'
import { useNavigate } from '@tanstack/react-router'
import { MoreHorizontal } from 'lucide-react'
import { useRef, useState } from 'react'

import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/minimalist/components/Menu'
import { PromptAccessDialog } from '@/minimalist/components/PromptAccessDialog'
import { TextDialog } from '@/minimalist/components/TextDialog'
import { useSessionAccess } from '@/minimalist/lib/access'
import { useTaskAutoAdvance } from '@/minimalist/lib/auto-advance'
import { useTask } from '@/minimalist/lib/data'
import { sessionName } from '@/minimalist/lib/session-name'
import { useArchive } from '@/minimalist/lib/use-archive'
import { useCopy } from '@/minimalist/lib/use-copy'
import { useRiptideApi } from '@/orpc/client'

export function ThreadActions({ session }: { session: Session }) {
	const taskId = session.task_id
	const { client: api } = useRiptideApi()
	const navigate = useNavigate()
	const { task } = useTask(taskId)
	const autoAdvance = useTaskAutoAdvance(taskId)
	const copy = useCopy()
	const archiver = useArchive()
	const anchor = useRef<HTMLButtonElement>(null)
	const [open, setOpen] = useState(false)
	const [rename, setRename] = useState<'task' | 'session' | null>(null)
	const [sharing, setSharing] = useState(false)
	const { canManageSession } = useSessionAccess(session)
	const sharingEnabled = useSettingsStore((state) => state.orgSettings.multiplayerPromptingEnabled)
	const archive = (kind: 'task' | 'session', archived: boolean) => {
		setOpen(false)
		void archiver.archive(
			kind === 'task' && taskId ? { kind, id: taskId } : { kind: 'session', id: session.id },
			archived,
		)
	}
	return (
		<>
			<button
				type="button"
				ref={anchor}
				className="iconbtn"
				aria-label="Task and session actions"
				title="Task and session actions"
				onClick={() => setOpen(true)}
				disabled={archiver.pending}
			>
				<MoreHorizontal className="i" />
			</button>
			<Menu anchor={anchor} open={open} onClose={() => setOpen(false)} placement="below-end">
				{task ? (
					<>
						<MenuLabel>Task</MenuLabel>
						<MenuItem
							label="New session"
							onSelect={() => {
								setOpen(false)
								void navigate({ to: '/', search: { task: task.id } })
							}}
						/>
						<MenuItem
							label="Rename task"
							onSelect={() => {
								setOpen(false)
								setRename('task')
							}}
						/>
						{autoAdvance.available ? (
							<MenuItem
								label="Continue to the next phase on its own"
								checked={autoAdvance.on}
								onSelect={autoAdvance.toggle}
							/>
						) : null}
						<MenuItem
							label={task.archived ? 'Unarchive task' : 'Archive task'}
							detail="Sessions and files are preserved"
							onSelect={() => archive('task', !task.archived)}
						/>
						<MenuSeparator />
					</>
				) : null}
				<MenuLabel>Session</MenuLabel>
				{canManageSession ? (
					<>
						<MenuItem
							label="Rename session"
							onSelect={() => {
								setOpen(false)
								setRename('session')
							}}
						/>
						<MenuItem
							label="Let teammates prompt…"
							detail={sharingEnabled ? undefined : 'An admin turned this off for your organization'}
							disabled={!sharingEnabled}
							onSelect={() => {
								setOpen(false)
								setSharing(true)
							}}
						/>
						<MenuItem
							label={session.archived ? 'Unarchive session' : 'Archive session'}
							onSelect={() => archive('session', !session.archived)}
						/>
					</>
				) : null}
				<MenuItem
					label="Copy session link"
					onSelect={() => {
						setOpen(false)
						copy(
							`${location.origin}/sessions/${session.id}`,
							'Session link copied',
							'Could not copy the session link. Copy the address from your browser.',
						)
					}}
				/>
			</Menu>
			{sharing ? <PromptAccessDialog session={session} onClose={() => setSharing(false)} /> : null}
			{rename ? (
				<TextDialog
					title={rename === 'task' ? 'Rename task' : 'Rename session'}
					initialValue={rename === 'task' ? (task?.name ?? '') : sessionName(session, '')}
					submitLabel="Save name"
					onClose={() => setRename(null)}
					onSave={(name) =>
						rename === 'task' && taskId
							? api.tasks.update({ taskId, name })
							: api.sessions.update({ sessionId: session.id, title: name })
					}
				/>
			) : null}
		</>
	)
}
