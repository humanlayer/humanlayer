import type { KanbanCardModel as KanbanCard, KanbanColumns } from '@humanlayer/ui/components/kanban'
import { RPI_LABELS, type SessionLabel } from '@humanlayer/ui/components/session-label-badge'
import { Option, Schema } from 'effect'

import { activityMinute } from '@/lib/activitySorting'
import { aggregateTaskStatus } from '@/lib/taskStatus'

/** Fixed kanban column ids, left-to-right workflow order. */
export type ColumnId = 'todo' | 'research-design' | 'planning' | 'implementation' | 'in-review'

/** Ordered column definitions (titles match the prototype). */
export const KANBAN_COLUMN_DEFS: ReadonlyArray<{ id: ColumnId; title: string }> = [
	{ id: 'todo', title: 'Todo / Draft' },
	{ id: 'research-design', title: 'Research & Design' },
	{ id: 'planning', title: 'Planning' },
	{ id: 'implementation', title: 'Implementation' },
	{ id: 'in-review', title: 'In Review' },
]

/**
 * Map from RPI label name to its kanban column.
 * Labels not listed here fall through to `todo`.
 */
const COLUMN_LABEL_NAMES = [
	'rpi:todo',
	'rpi:research-questions',
	'rpi:research',
	'rpi:design-prd',
	'rpi:design-tdd',
	'rpi:design',
	'rpi:structure',
	'rpi:plan',
	'rpi:worktree-setup',
	'rpi:implementation',
	'rpi:describe-pr',
	'rpi:review',
] as const
const ColumnLabelName = Schema.Literals(COLUMN_LABEL_NAMES)

export const LABEL_TO_COLUMN: Record<(typeof COLUMN_LABEL_NAMES)[number], ColumnId> = {
	'rpi:todo': 'todo',
	'rpi:research-questions': 'research-design',
	'rpi:research': 'research-design',
	'rpi:design-prd': 'research-design',
	'rpi:design-tdd': 'research-design',
	'rpi:design': 'research-design',
	'rpi:structure': 'planning',
	'rpi:plan': 'planning',
	'rpi:worktree-setup': 'implementation',
	'rpi:implementation': 'implementation',
	'rpi:describe-pr': 'in-review',
	'rpi:review': 'in-review',
}

/** Session shape consumed by the engine. Plain schema data — no React, no queries. */
export interface KanbanSessionInput {
	/** Session id; used to look up unread state against `unreadSessionIds`. */
	id?: string
	archived: boolean
	labels: SessionLabel[] | null
	last_activity_at: bigint | null
	resource_owner_user_id?: string | null
	/** Raw session status string; aggregated into the card's live status indicator. */
	status?: string | null
}

/**
 * Get the progression rank of a label in `RPI_LABELS`. Higher = more progressed.
 * Unknown labels rank -1.
 */
function getLabelProgressIndex(label: SessionLabel): number {
	return RPI_LABELS.findIndex((l) => l.name === label.name)
}

function nonEmptyLabels(labels: SessionLabel[] | null): labels is SessionLabel[] {
	return Array.isArray(labels) && labels.length > 0
}

/**
 * Pick the highest-ranked (most progressed) label from a session's labels.
 * Returns null when none are recognized RPI labels.
 */
function highestRankedLabel(labels: SessionLabel[]): SessionLabel | null {
	let best: SessionLabel | null = null
	let bestIndex = -1
	for (const label of labels) {
		const index = getLabelProgressIndex(label)
		if (index > bestIndex) {
			bestIndex = index
			best = label
		}
	}
	return best
}

interface AssignResult {
	columnId: ColumnId
	/** Winning session's activity, used for within-column recency sort. */
	activity: bigint
	/** The label that determined placement (for the card's workflow badge). */
	label: SessionLabel
}

/**
 * Decide a task's column from its sessions.
 *
 * Only non-archived sessions that *have labels* contribute. Of those, the
 * session with the most recent `last_activity_at` wins, and the card is placed
 * by that winning session's highest-ranked label. Tasks with no labeled session
 * (e.g. drafts / not-yet-started) fall to `todo`.
 */
function assignColumnInternal(sessions: KanbanSessionInput[]): AssignResult | null {
	let winner: KanbanSessionInput | null = null
	let winnerActivity = -1n

	for (const session of sessions) {
		if (session.archived) continue
		if (!nonEmptyLabels(session.labels)) continue
		const activity = session.last_activity_at ?? 0n
		if (winner === null || activity > winnerActivity) {
			winner = session
			winnerActivity = activity
		}
	}

	if (winner === null || !nonEmptyLabels(winner.labels)) return null

	const topLabel = highestRankedLabel(winner.labels)
	if (topLabel === null) return null
	const columnLabelName = Option.getOrUndefined(Schema.decodeUnknownOption(ColumnLabelName)(topLabel.name))

	return {
		columnId: columnLabelName === undefined ? 'todo' : LABEL_TO_COLUMN[columnLabelName],
		activity: winner.last_activity_at ?? 0n,
		label: topLabel,
	}
}

/**
 * Public column-assignment helper.
 *
 * Returns the column id for a task given its sessions. Draft tasks (or any task
 * with no labeled, non-archived session) land in `todo`.
 */
export function assignColumn(_task: { is_draft?: boolean }, sessions: KanbanSessionInput[]): ColumnId {
	const result = assignColumnInternal(sessions)
	return result?.columnId ?? 'todo'
}

/** A task plus the projected data the engine needs to build its card. */
export interface KanbanTaskInput {
	id: string
	name: string
	created_at?: bigint | null
	is_draft?: boolean
	resource_owner_user_id: string | null
	sessions: KanbanSessionInput[]
}

/** Owner display info resolved per-user by the wired hook. */
export interface KanbanOwnerInfo {
	initials: string
	avatarUrl?: string
}

function getTaskOwnerIds(task: KanbanTaskInput): string[] {
	const ownerIds: string[] = []
	const seen = new Set<string>()

	const addOwner = (userId: string | null | undefined) => {
		if (!userId || seen.has(userId)) return
		seen.add(userId)
		ownerIds.push(userId)
	}

	addOwner(task.resource_owner_user_id)
	for (const session of task.sessions) {
		if (session.archived) continue
		addOwner(session.resource_owner_user_id)
	}

	return ownerIds
}

export interface BuildKanbanColumnsInput {
	tasks: KanbanTaskInput[]
	/** Resolve owner display info from a task's `resource_owner_user_id`. */
	resolveOwner: (userId: string | null) => KanbanOwnerInfo
	/**
	 * Unread session ids (from the shared unread store). A card is marked unread
	 * when any of its non-archived sessions is in this set — same calculation as
	 * the left-nav sidebar.
	 */
	unreadSessionIds?: Set<string>
}

interface CardWithActivity {
	card: KanbanCard
	activity: bigint
	createdAt: bigint
}

/**
 * Build the 5 ordered kanban columns from tasks + their sessions.
 *
 * Within each column, cards are sorted by the winning session's activity
 * minute, then task creation time, both descending.
 */
export function buildKanbanColumns(input: BuildKanbanColumnsInput): KanbanColumns {
	const unreadSessionIds = input.unreadSessionIds ?? new Set<string>()
	const buckets = new Map<ColumnId, CardWithActivity[]>()
	for (const def of KANBAN_COLUMN_DEFS) {
		buckets.set(def.id, [])
	}

	for (const task of input.tasks) {
		const assignment = assignColumnInternal(task.sessions)
		const columnId: ColumnId = assignment?.columnId ?? 'todo'
		const owner = input.resolveOwner(task.resource_owner_user_id)
		const owners = getTaskOwnerIds(task).map((userId) => ({ id: userId, ...input.resolveOwner(userId) }))
		const workflowLabel: SessionLabel = assignment?.label ?? { name: 'rpi:todo', title: 'todo' }
		const activity = assignment?.activity ?? -1n
		const ageTimestamp = assignment?.activity ?? task.created_at

		// Live status indicator — aggregated over ALL the task's non-archived
		// sessions with the same precedence the left-nav sidebar uses.
		const status = aggregateTaskStatus(
			task.sessions
				.filter((session) => !session.archived)
				.map((session) => ({
					status: session.status ?? null,
					lastActivityAt: session.last_activity_at,
				})),
		)

		// Unread — true when any non-archived session is unread, mirroring the
		// left-nav sidebar's task-level propagation (`sessions.some(isUnread)`).
		const isUnread = task.sessions.some(
			(session) => !session.archived && session.id !== undefined && unreadSessionIds.has(session.id),
		)

		buckets.get(columnId)?.push({
			activity,
			createdAt: task.created_at ?? 0n,
			card: {
				id: task.id,
				title: task.name,
				ageTimestampMs: ageTimestamp === null || ageTimestamp === undefined ? undefined : Number(ageTimestamp),
				ownerInitials: owner.initials,
				ownerAvatarUrl: owner.avatarUrl,
				owners,
				isDraft: task.is_draft ?? false,
				workflowLabel,
				status,
				isUnread,
			},
		})
	}

	return KANBAN_COLUMN_DEFS.map((def) => {
		const cards = (buckets.get(def.id) ?? [])
			.sort((a, b) => {
				const activityDifference = activityMinute(b.activity) - activityMinute(a.activity)
				if (activityDifference !== 0) return activityDifference
				if (b.createdAt === a.createdAt) return 0
				return b.createdAt > a.createdAt ? 1 : -1
			})
			.map((entry) => entry.card)

		return { id: def.id, title: def.title, cards }
	})
}
