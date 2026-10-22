import { isMultiplayerPromptingActive } from '@/hooks/useMultiplayerPromptingNow'

import type { NotificationRow } from '../notification-row'
import type { RowContext } from './row-context'
import { sessionName } from './row-text'

export function promptInviteRows(context: RowContext): NotificationRow[] {
	if (!context.sources.multiplayerPromptingEnabled) return []
	const rows: NotificationRow[] = []
	for (const session of context.sources.sessions) {
		const invitees = session.multiplayer_prompting_user_ids ?? []
		const startedAt = session.multiplayer_prompting_started_at ?? null
		const expiresAt = session.multiplayer_prompting_expires_at ?? null
		if (session.created_by === context.userId || !invitees.includes(context.userId)) continue
		if (startedAt === null || !isMultiplayerPromptingActive(invitees, startedAt, expiresAt, context.now)) continue
		const key = `prompt_invite:${session.id}:${String(startedAt)}`
		const at = Number(startedAt)
		if (!context.isUnseen(key, at)) continue
		rows.push({
			key,
			kind: 'prompt_invite',
			at,
			actors: [{ userId: session.created_by }],
			count: 1,
			subject: sessionName(session),
			taskName: context.taskName(session.task_id),
			detail: expiresAt === null ? null : `Access ends in ${timeUntil(Number(expiresAt), context.now)}`,
			destination: { kind: 'session', sessionId: session.id },
			dismissible: true,
		})
	}
	return rows
}

function timeUntil(target: number, now: number): string {
	const minutes = Math.max(1, Math.ceil((target - now) / 60_000))
	if (minutes < 60) return `${minutes} min`
	const hours = Math.round(minutes / 60)
	return hours === 1 ? '1 hour' : `${hours} hours`
}
