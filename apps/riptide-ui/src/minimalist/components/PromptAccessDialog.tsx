import type { Session } from '@humanlayer/db/tables/sessions'
import { Users } from 'lucide-react'
import { useState } from 'react'

import { type MultiplayerPromptingDuration, useSettingsStore } from '@/hooks/stores/settingsStore'
import { useMultiplayerPromptingActions } from '@/hooks/useMultiplayerPromptingActions'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { Dialog } from '@/minimalist/components/Dialog'
import { memberFirstName, memberName, usePromptSharing, useSessionAccess } from '@/minimalist/lib/access'
import { useUi } from '@/minimalist/lib/ui-state'
import { useAction } from '@/minimalist/lib/use-action'

const DURATIONS: { value: MultiplayerPromptingDuration; label: string; phrase: string }[] = [
	{ value: '15m', label: '15 min', phrase: 'for 15 minutes' },
	{ value: '30m', label: '30 min', phrase: 'for 30 minutes' },
	{ value: '1h', label: '1 hour', phrase: 'for an hour' },
	{ value: '2h', label: '2 hours', phrase: 'for 2 hours' },
	{ value: '1d', label: '1 day', phrase: 'for a day' },
	{ value: 'unlimited', label: 'No limit', phrase: 'until you stop sharing' },
]

/** Who else may prompt this session, and for how long. Everyone on the list shares one countdown. */
export function PromptAccessDialog({ session, onClose }: { session: Session; onClose: () => void }) {
	const { showToast } = useUi()
	const { membersMap } = useOrgMembers()
	const sharing = usePromptSharing(session)
	const actions = useMultiplayerPromptingActions()
	const lastDuration = useSettingsStore((state) => state.multiplayerPromptingLastDuration)
	const setLastDuration = useSettingsStore((state) => state.setMultiplayerPromptingLastDuration)
	const [selected, setSelected] = useState(() => new Set(sharing.active ? sharing.userIds : []))
	const [duration, setDuration] = useState(lastDuration)
	const [filter, setFilter] = useState('')
	const action = useAction('inline')

	const members = [...membersMap.values()]
		.filter((member) => member.id !== session.created_by)
		.sort((a, b) => memberName(a).localeCompare(memberName(b)))
	const needle = filter.trim().toLowerCase()
	const shown = needle
		? members.filter((member) => `${memberName(member)} ${member.email}`.toLowerCase().includes(needle))
		: members
	const toggle = (id: string) =>
		setSelected((current) => {
			const next = new Set(current)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})

	const stop = async () => {
		await actions.update({ sessionId: session.id, settings: { enabled: false } })
		showToast('Stopped sharing. Only you can prompt this session.')
	}
	const save = async () => {
		const ids = [...selected]
		if (ids.length === 0) return stop()
		const addUserIds = ids.filter((id) => !sharing.userIds.includes(id))
		const removeUserIds = sharing.userIds.filter((id) => !selected.has(id))
		await actions.update({
			sessionId: session.id,
			settings: {
				enabled: true,
				addUserIds: addUserIds.length > 0 ? addUserIds : undefined,
				removeUserIds: removeUserIds.length > 0 ? removeUserIds : undefined,
				duration,
			},
		})
		setLastDuration(duration)
		const who = ids.length === 1 ? memberName(membersMap.get(ids[0] ?? '')) : `${ids.length} teammates`
		showToast(`${who} can prompt ${DURATIONS.find((option) => option.value === duration)?.phrase ?? ''}`)
	}
	const run = (change: () => Promise<void>) =>
		void action.run(change, 'Could not change who can prompt. Try again.').then((saved) => {
			if (saved) onClose()
		})

	return (
		<Dialog
			title="Let teammates prompt"
			description="They can send messages and answer approvals in this session. They need edit access to the task."
			busy={action.pending}
			error={action.error}
			onClose={onClose}
			onSubmit={() => run(save)}
		>
			{members.length === 0 ? (
				<div className="note">No one else is in this organization yet.</div>
			) : (
				<>
					{members.length > 6 ? (
						<input
							aria-label="Find a teammate"
							className="people-find"
							placeholder="Find a teammate"
							value={filter}
							onChange={(event) => setFilter(event.target.value)}
						/>
					) : null}
					<div className="people">
						{shown.map((member) => (
							<label key={member.id} className="person">
								<input
									type="checkbox"
									checked={selected.has(member.id)}
									onChange={() => toggle(member.id)}
									disabled={action.pending}
								/>
								<span className="n">{memberName(member)}</span>
								{member.firstName || member.lastName ? <span className="e">{member.email}</span> : null}
							</label>
						))}
						{shown.length === 0 ? <div className="note">No teammate matches “{filter}”.</div> : null}
					</div>
					<div className="lbl">{sharing.active ? 'Time limit, counted from now' : 'Time limit'}</div>
					<div className="seg fill">
						{DURATIONS.map((option) => (
							<button
								type="button"
								key={option.value}
								className={duration === option.value ? 'on' : undefined}
								onClick={() => setDuration(option.value)}
							>
								{option.label}
							</button>
						))}
					</div>
				</>
			)}
			<div className="dialog-actions">
				{sharing.active ? (
					<button type="button" className="btn aside" disabled={action.pending} onClick={() => run(stop)}>
						Stop sharing
					</button>
				) : null}
				<button type="button" className="btn" onClick={onClose} disabled={action.pending}>
					Cancel
				</button>
				<button
					type="submit"
					className="btn primary"
					disabled={action.pending || (selected.size === 0 && !sharing.active)}
				>
					{action.pending ? 'Saving…' : sharing.active ? 'Save' : 'Share'}
				</button>
			</div>
		</Dialog>
	)
}

/** "2 can prompt · 42m" in the thread header while sharing is on; the creator clicks it to change the list. */
export function SharingPill({ session }: { session: Session }) {
	const sharing = usePromptSharing(session)
	const { canManageSession: canManage } = useSessionAccess(session)
	const { membersMap } = useOrgMembers()
	const [open, setOpen] = useState(false)
	if (!sharing.active) return null
	const people = sharing.userIds.map((id) => memberName(membersMap.get(id)))
	const who =
		sharing.userIds.length === 1
			? memberFirstName(membersMap.get(sharing.userIds[0] ?? ''))
			: `${people.length} people`
	const label = `${who} can prompt${sharing.left ? ` · ${sharing.left}` : ''}`
	const title = `${people.join(', ')} can prompt this session${sharing.left ? ` for ${sharing.left} more` : ''}`
	if (!canManage)
		return (
			<span className="muted sharing" title={title}>
				<Users className="i sm" strokeWidth={1.6} />
				{label}
			</span>
		)
	return (
		<>
			<button type="button" className="btn ghost sharing" title={title} onClick={() => setOpen(true)}>
				<Users className="i sm" strokeWidth={1.6} />
				{label}
			</button>
			{open ? <PromptAccessDialog session={session} onClose={() => setOpen(false)} /> : null}
		</>
	)
}
