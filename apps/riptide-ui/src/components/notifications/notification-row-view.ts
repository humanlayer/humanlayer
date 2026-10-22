import type { NotificationRowProps } from '@humanlayer/ui/components/notifications/NotificationRow'
import { formatRelativeTime } from '@humanlayer/ui/lib/comment-utils'

import type { OrgMember } from '@/hooks/useOrgMembers'
import type { NotificationActor, NotificationKind, NotificationRow } from '@/lib/notifications/notification-row'

export type NotificationRowView = Omit<NotificationRowProps, 'id' | 'focused' | 'onSelect' | 'onHover'>

const AGENT_ACTIONS: Partial<Record<NotificationKind, string>> = {
	approval: 'Needs approval',
	ready_for_input: 'Ready for input',
	session_failed: 'Session failed',
	workspace_setup_failed: 'Workspace setup failed',
}
const PERSON_ACTIONS: Partial<Record<NotificationKind, string>> = {
	prompt_invite: 'invited you to prompt',
	artifact_comment: 'commented',
	thread_reply: 'replied to your thread',
	diff_comment: 'commented on a diff',
}

export function notificationRowView(row: NotificationRow, membersMap: Map<string, OrgMember>): NotificationRowView {
	const actor = describeActors(row.actors, membersMap)
	return {
		kind: row.kind,
		actorName: actor?.name ?? null,
		actorAvatarUrl: actor?.avatarUrl ?? null,
		action: actor ? (PERSON_ACTIONS[row.kind] ?? '') : (AGENT_ACTIONS[row.kind] ?? ''),
		subject: row.subject,
		taskName: row.taskName,
		detail: row.count > 1 ? `${row.count} comments · ${row.detail ?? ''}` : row.detail,
		age: formatRelativeTime(BigInt(Math.floor(row.at))),
	}
}

function describeActors(
	actors: NotificationActor[],
	membersMap: Map<string, OrgMember>,
): { name: string; avatarUrl: string | null } | null {
	const people = actors.filter((actor) => !('agent' in actor))
	const [first, second] = people
	if (!first) return null
	const nameOf = (actor: NotificationActor) =>
		'userId' in actor ? memberName(membersMap.get(actor.userId)) : 'guestName' in actor ? actor.guestName : ''
	const avatarUrl = 'userId' in first ? (membersMap.get(first.userId)?.profilePictureUrl ?? null) : null
	if (!second) return { name: nameOf(first), avatarUrl }
	if (people.length === 2) return { name: `${nameOf(first)} and ${nameOf(second)}`, avatarUrl }
	return { name: `${nameOf(first)} and ${people.length - 1} others`, avatarUrl }
}

function memberName(member: OrgMember | undefined): string {
	return member?.firstName || member?.email || 'A teammate'
}
