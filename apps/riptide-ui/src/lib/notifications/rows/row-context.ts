import { NOTIFICATION_WINDOW_MS } from '../notification-row'
import type {
	NotificationArtifact,
	NotificationSession,
	NotificationSources,
	NotificationTask,
} from '../notification-sources'

export interface RowContext {
	sources: NotificationSources
	userId: string
	now: number
	session: (id: string) => NotificationSession | undefined
	task: (id: string) => NotificationTask | undefined
	taskName: (id: string | null) => string | null
	artifact: (id: string) => NotificationArtifact | undefined
	isUnseen: (key: string, at: number) => boolean
	isOutstanding: (key: string, at: number) => boolean
}

export function createRowContext(sources: NotificationSources): RowContext {
	const sessionsById = new Map(sources.sessions.map((session) => [session.id, session]))
	const tasksById = new Map(sources.tasks.map((task) => [task.id, task]))
	const artifactsById = new Map(sources.artifacts.map((artifact) => [artifact.id, artifact]))
	const isUnseen = (key: string, at: number) => {
		const seenAt = sources.seen[key]
		return seenAt === undefined || at > seenAt
	}
	return {
		sources,
		userId: sources.userId,
		now: sources.now,
		session: (id) => sessionsById.get(id),
		task: (id) => tasksById.get(id),
		taskName: (id) => (id ? (tasksById.get(id)?.name ?? null) : null),
		artifact: (id) => artifactsById.get(id),
		isUnseen,
		isOutstanding: (key, at) => sources.now - at < NOTIFICATION_WINDOW_MS && isUnseen(key, at),
	}
}
