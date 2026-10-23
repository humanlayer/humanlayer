import type { NotificationActor, NotificationDestination, NotificationKind, NotificationRow } from '../notification-row'
import type { RowContext } from './row-context'
import { firstLine } from './row-text'

interface GroupedComment {
	id: string
	at: number
	actor: NotificationActor
	text: string
}

interface CommentGroup {
	key: string
	kind: NotificationKind
	subject: string
	taskId: string
	destination: (newestCommentId: string) => NotificationDestination
}

export function createCommentGroups(context: RowContext) {
	const groups = new Map<string, { group: CommentGroup; comments: GroupedComment[] }>()

	return {
		add(group: CommentGroup, comment: GroupedComment): void {
			if (!context.isOutstanding(group.key, comment.at)) return
			const existing = groups.get(group.key)
			if (existing) existing.comments.push(comment)
			else groups.set(group.key, { group, comments: [comment] })
		},

		rows(): NotificationRow[] {
			const rows: NotificationRow[] = []
			for (const { group, comments } of groups.values()) {
				const newestFirst = [...comments].sort((a, b) => b.at - a.at)
				const [newest] = newestFirst
				if (!newest) continue
				rows.push({
					key: group.key,
					kind: group.kind,
					at: newest.at,
					actors: uniqueActors(newestFirst.map((comment) => comment.actor)),
					count: newestFirst.length,
					subject: group.subject,
					taskName: context.taskName(group.taskId),
					detail: firstLine(newest.text),
					destination: group.destination(newest.id),
					dismissible: true,
				})
			}
			return rows
		},
	}
}

function uniqueActors(actors: NotificationActor[]): NotificationActor[] {
	const seen = new Set<string>()
	return actors.filter((actor) => {
		const id = 'userId' in actor ? actor.userId : 'guestName' in actor ? `guest:${actor.guestName}` : 'agent'
		if (seen.has(id)) return false
		seen.add(id)
		return true
	})
}
