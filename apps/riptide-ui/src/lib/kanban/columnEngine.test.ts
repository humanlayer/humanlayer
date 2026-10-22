import { formatKanbanCardAge, formatKanbanCardAgeLong } from '@humanlayer/ui/components/kanban'
import { RPI_LABELS, type SessionLabel } from '@humanlayer/ui/components/session-label-badge'
import { describe, expect, test } from 'vitest'

import {
	assignColumn,
	buildKanbanColumns,
	type KanbanSessionInput,
	type KanbanTaskInput,
	LABEL_TO_COLUMN,
} from './columnEngine'

function label(name: string): SessionLabel {
	return { name, title: name.replace('rpi:', '') }
}

function session(overrides: Partial<KanbanSessionInput> = {}): KanbanSessionInput {
	return {
		archived: false,
		labels: null,
		last_activity_at: 0n,
		...overrides,
	}
}

const resolveOwner = () => ({ initials: 'DW', avatarUrl: undefined })

describe('assignColumn', () => {
	test('maps every RPI_LABELS entry to its column per LABEL_TO_COLUMN', () => {
		for (const rpiLabel of RPI_LABELS) {
			// Every known RPI label must have an explicit column mapping in source.
			const expected = LABEL_TO_COLUMN[rpiLabel.name]
			expect(expected, `missing LABEL_TO_COLUMN entry for ${rpiLabel.name}`).toBeDefined()
			const column = assignColumn({}, [session({ labels: [rpiLabel], last_activity_at: 10n })])
			expect(column, `label ${rpiLabel.name}`).toBe(expected)
		}
	})

	test('skips no-label sessions and falls through to the next labeled session', () => {
		// Most-recently-active session has no labels; older session is labeled.
		const sessions = [
			session({ labels: null, last_activity_at: 100n }),
			session({ labels: [label('rpi:plan')], last_activity_at: 50n }),
		]
		expect(assignColumn({}, sessions)).toBe('planning')
	})

	test('draft task with no labeled session lands in todo', () => {
		expect(assignColumn({ is_draft: true }, [])).toBe('todo')
		expect(assignColumn({ is_draft: true }, [session({ labels: null, last_activity_at: 5n })])).toBe('todo')
	})

	test('excludes archived sessions even when most recent', () => {
		const sessions = [
			session({ archived: true, labels: [label('rpi:implementation')], last_activity_at: 100n }),
			session({ labels: [label('rpi:research')], last_activity_at: 50n }),
		]
		expect(assignColumn({}, sessions)).toBe('research-design')
	})

	test('most-recently-active labeled session wins (outline after research stays in Planning)', () => {
		const sessions = [
			session({ labels: [label('rpi:research')], last_activity_at: 30n }),
			session({ labels: [label('rpi:structure')], last_activity_at: 90n }),
		]
		expect(assignColumn({}, sessions)).toBe('planning')
	})

	test('uses the highest-ranked label within the winning session', () => {
		const sessions = [session({ labels: [label('rpi:research'), label('rpi:plan')], last_activity_at: 10n })]
		expect(assignColumn({}, sessions)).toBe('planning')
	})
})

describe('buildKanbanColumns', () => {
	test('produces the 5 ordered columns', () => {
		const columns = buildKanbanColumns({ tasks: [], resolveOwner })
		expect(columns.map((c) => c.id)).toEqual(['todo', 'research-design', 'planning', 'implementation', 'in-review'])
	})

	test('places tasks into their assigned columns with workflow badge', () => {
		const tasks: KanbanTaskInput[] = [
			{
				id: 't1',
				name: 'Research thing',
				resource_owner_user_id: 'u1',
				sessions: [session({ labels: [label('rpi:research')], last_activity_at: 10n })],
			},
			{
				id: 't2',
				name: 'Draft thing',
				is_draft: true,
				resource_owner_user_id: 'u1',
				sessions: [],
			},
		]
		const columns = buildKanbanColumns({ tasks, resolveOwner })
		const research = columns.find((c) => c.id === 'research-design')
		const todo = columns.find((c) => c.id === 'todo')

		expect(research?.cards.map((c) => c.id)).toEqual(['t1'])
		expect(research?.cards[0].workflowLabel.name).toBe('rpi:research')
		expect(todo?.cards.map((c) => c.id)).toEqual(['t2'])
		expect(todo?.cards[0].workflowLabel.name).toBe('rpi:todo')
	})

	test('sorts cards within a column by winning-session activity minute desc', () => {
		const tasks: KanbanTaskInput[] = [
			{
				id: 'older',
				name: 'Older',
				resource_owner_user_id: 'u1',
				sessions: [session({ labels: [label('rpi:plan')], last_activity_at: 10n })],
			},
			{
				id: 'newer',
				name: 'Newer',
				resource_owner_user_id: 'u1',
				sessions: [session({ labels: [label('rpi:structure')], last_activity_at: 60_010n })],
			},
		]
		const columns = buildKanbanColumns({ tasks, resolveOwner })
		const planning = columns.find((c) => c.id === 'planning')
		expect(planning?.cards.map((c) => c.id)).toEqual(['newer', 'older'])
	})

	test('sorts same-minute activity by task creation time instead of exact activity', () => {
		const minute = 1_700_000_040_000n
		const tasks: KanbanTaskInput[] = [
			{
				id: 'more-active-older-task',
				name: 'More active older task',
				created_at: 100n,
				resource_owner_user_id: 'u1',
				sessions: [session({ labels: [label('rpi:plan')], last_activity_at: minute + 50_000n })],
			},
			{
				id: 'less-active-newer-task',
				name: 'Less active newer task',
				created_at: 200n,
				resource_owner_user_id: 'u1',
				sessions: [session({ labels: [label('rpi:structure')], last_activity_at: minute + 10_000n })],
			},
		]

		const planning = buildKanbanColumns({ tasks, resolveOwner }).find((column) => column.id === 'planning')

		expect(planning?.cards.map((card) => card.id)).toEqual(['less-active-newer-task', 'more-active-older-task'])
	})

	test('sorts a newer activity minute first even when that task was created earlier', () => {
		const minute = 1_700_000_040_000n
		const tasks: KanbanTaskInput[] = [
			{
				id: 'newer-created',
				name: 'Newer created',
				created_at: 200n,
				resource_owner_user_id: 'u1',
				sessions: [session({ labels: [label('rpi:plan')], last_activity_at: minute + 59_999n })],
			},
			{
				id: 'newer-minute',
				name: 'Newer minute',
				created_at: 100n,
				resource_owner_user_id: 'u1',
				sessions: [session({ labels: [label('rpi:structure')], last_activity_at: minute + 60_000n })],
			},
		]

		const planning = buildKanbanColumns({ tasks, resolveOwner }).find((column) => column.id === 'planning')

		expect(planning?.cards.map((card) => card.id)).toEqual(['newer-minute', 'newer-created'])
	})

	test('sorts no-session fallback cards by task creation time', () => {
		const tasks: KanbanTaskInput[] = [
			{
				id: 'older',
				name: 'Older',
				created_at: 100n,
				resource_owner_user_id: 'u1',
				sessions: [],
			},
			{
				id: 'newer',
				name: 'Newer',
				created_at: 200n,
				resource_owner_user_id: 'u1',
				sessions: [],
			},
		]

		const todo = buildKanbanColumns({ tasks, resolveOwner }).find((column) => column.id === 'todo')

		expect(todo?.cards.map((card) => card.id)).toEqual(['newer', 'older'])
	})

	test('preserves input order when activity minute and creation time are equal', () => {
		const tasks: KanbanTaskInput[] = [
			{
				id: 'first',
				name: 'First',
				created_at: 100n,
				resource_owner_user_id: 'u1',
				sessions: [session({ labels: [label('rpi:plan')], last_activity_at: 60_010n })],
			},
			{
				id: 'second',
				name: 'Second',
				created_at: 100n,
				resource_owner_user_id: 'u1',
				sessions: [session({ labels: [label('rpi:structure')], last_activity_at: 60_020n })],
			},
		]

		const planning = buildKanbanColumns({ tasks, resolveOwner }).find((column) => column.id === 'planning')

		expect(planning?.cards.map((card) => card.id)).toEqual(['first', 'second'])
	})

	test('does not mutate task or session input order while sorting cards', () => {
		const firstSessions = [
			session({ id: 's1', labels: [label('rpi:plan')], last_activity_at: 60_010n }),
			session({ id: 's2', labels: [label('rpi:research')], last_activity_at: 10n }),
		]
		const tasks: KanbanTaskInput[] = [
			{
				id: 'first',
				name: 'First',
				created_at: 100n,
				resource_owner_user_id: 'u1',
				sessions: firstSessions,
			},
			{
				id: 'second',
				name: 'Second',
				created_at: 200n,
				resource_owner_user_id: 'u1',
				sessions: [session({ id: 's3', labels: [label('rpi:structure')], last_activity_at: 60_020n })],
			},
		]

		buildKanbanColumns({ tasks, resolveOwner })

		expect(tasks.map((task) => task.id)).toEqual(['first', 'second'])
		expect(firstSessions.map((item) => item.id)).toEqual(['s1', 's2'])
	})

	test('resolves owner display info onto cards', () => {
		const tasks: KanbanTaskInput[] = [
			{
				id: 't1',
				name: 'Owned',
				resource_owner_user_id: 'u1',
				sessions: [session({ labels: [label('rpi:plan')], last_activity_at: 5n })],
			},
		]
		const columns = buildKanbanColumns({
			tasks,
			resolveOwner: (userId) =>
				userId === 'u1' ? { initials: 'KH', avatarUrl: 'http://x/y.png' } : { initials: '?' },
		})
		const card = columns.find((c) => c.id === 'planning')?.cards[0]
		expect(card?.ownerInitials).toBe('KH')
		expect(card?.ownerAvatarUrl).toBe('http://x/y.png')
	})

	test('adds task owner plus non-archived session owners to the owner stack', () => {
		const tasks: KanbanTaskInput[] = [
			{
				id: 't1',
				name: 'Shared task',
				resource_owner_user_id: 'u1',
				sessions: [
					session({ resource_owner_user_id: 'u2', labels: [label('rpi:plan')], last_activity_at: 5n }),
					session({ resource_owner_user_id: 'u1', labels: [label('rpi:research')], last_activity_at: 3n }),
					session({ archived: true, resource_owner_user_id: 'u3', last_activity_at: 9n }),
				],
			},
		]

		const card = buildKanbanColumns({
			tasks,
			resolveOwner: (userId) => ({ initials: userId === 'u2' ? 'AT' : 'DW' }),
		}).find((c) => c.id === 'planning')?.cards[0]

		expect(card?.owners).toEqual([
			{ id: 'u1', initials: 'DW' },
			{ id: 'u2', initials: 'AT' },
		])
	})

	test('uses winning session activity for card age display', () => {
		const tasks: KanbanTaskInput[] = [
			{
				id: 't1',
				name: 'Aged',
				created_at: 1_700_000_000_000n,
				resource_owner_user_id: 'u1',
				sessions: [session({ labels: [label('rpi:plan')], last_activity_at: 1_700_000_100_000n })],
			},
		]
		const card = buildKanbanColumns({ tasks, resolveOwner }).find((c) => c.id === 'planning')?.cards[0]
		expect(card?.ageTimestampMs).toBe(1_700_000_100_000)
	})

	test('uses exact activity to choose the winning session, column, and age within one minute', () => {
		const minute = 1_700_000_040_000n
		const tasks: KanbanTaskInput[] = [
			{
				id: 't1',
				name: 'Advancing task',
				created_at: 1_700_000_000_000n,
				resource_owner_user_id: 'u1',
				sessions: [
					session({ labels: [label('rpi:plan')], last_activity_at: minute + 10_000n }),
					session({ labels: [label('rpi:implementation')], last_activity_at: minute + 50_000n }),
				],
			},
		]

		const card = buildKanbanColumns({ tasks, resolveOwner }).find((column) => column.id === 'implementation')
			?.cards[0]

		expect(card?.workflowLabel.name).toBe('rpi:implementation')
		expect(card?.ageTimestampMs).toBe(Number(minute + 50_000n))
	})

	test('falls back to task creation time when no labeled session sets card activity', () => {
		const tasks: KanbanTaskInput[] = [
			{
				id: 't1',
				name: 'Todo',
				created_at: 1_700_000_000_000n,
				resource_owner_user_id: 'u1',
				sessions: [],
			},
		]
		const card = buildKanbanColumns({ tasks, resolveOwner }).find((c) => c.id === 'todo')?.cards[0]
		expect(card?.ageTimestampMs).toBe(1_700_000_000_000)
	})

	test('formats card ages with minute, hour, day, and month units', () => {
		const now = 1_700_000_000_000
		expect(formatKanbanCardAge(now - 5 * 60 * 1000, now)).toBe('5m')
		expect(formatKanbanCardAge(now - 2 * 60 * 60 * 1000, now)).toBe('2h')
		expect(formatKanbanCardAge(now - 20 * 24 * 60 * 60 * 1000, now)).toBe('20d')
		expect(formatKanbanCardAge(now - 60 * 24 * 60 * 60 * 1000, now)).toBe('2mo')
	})

	test('formats long card ages for timestamp tooltips', () => {
		const now = 1_700_000_000_000
		expect(formatKanbanCardAgeLong(now - 1 * 60 * 1000, now)).toBe('1 minute')
		expect(formatKanbanCardAgeLong(now - 6 * 60 * 1000, now)).toBe('6 minutes')
		expect(formatKanbanCardAgeLong(now - 2 * 60 * 60 * 1000, now)).toBe('2 hours')
		expect(formatKanbanCardAgeLong(now - 20 * 24 * 60 * 60 * 1000, now)).toBe('20 days')
		expect(formatKanbanCardAgeLong(now - 60 * 24 * 60 * 60 * 1000, now)).toBe('2 months')
	})

	test('aggregates a live status indicator across the task’s sessions (sidebar precedence)', () => {
		const tasks: KanbanTaskInput[] = [
			{
				id: 't1',
				name: 'Running task',
				resource_owner_user_id: 'u1',
				sessions: [
					session({ labels: [label('rpi:plan')], last_activity_at: 5n, status: 'running' }),
					session({ labels: [label('rpi:research')], last_activity_at: 1n, status: 'ready_for_launch' }),
				],
			},
		]
		const card = buildKanbanColumns({ tasks, resolveOwner }).find((c) => c.id === 'planning')?.cards[0]
		// running beats pending
		expect(card?.status).toBe('running')
	})

	test('ignores archived sessions when computing status', () => {
		const tasks: KanbanTaskInput[] = [
			{
				id: 't1',
				name: 'Only archived is running',
				resource_owner_user_id: 'u1',
				sessions: [
					session({ labels: [label('rpi:plan')], last_activity_at: 5n, status: 'ready_for_input' }),
					session({ archived: true, last_activity_at: 9n, status: 'running' }),
				],
			},
		]
		const card = buildKanbanColumns({ tasks, resolveOwner }).find((c) => c.id === 'planning')?.cards[0]
		expect(card?.status).toBeUndefined()
	})

	test('draft task with no sessions has no status and lands in todo', () => {
		const tasks: KanbanTaskInput[] = [
			{ id: 'd1', name: 'Draft', is_draft: true, resource_owner_user_id: 'u1', sessions: [] },
		]
		const todo = buildKanbanColumns({ tasks, resolveOwner }).find((c) => c.id === 'todo')
		expect(todo?.cards.map((c) => c.id)).toEqual(['d1'])
		expect(todo?.cards[0]?.status).toBeUndefined()
		expect(todo?.cards[0]?.isDraft).toBe(true)
	})

	test('marks a card unread when any non-archived session is in unreadSessionIds', () => {
		const tasks: KanbanTaskInput[] = [
			{
				id: 't1',
				name: 'Has unread session',
				resource_owner_user_id: 'u1',
				sessions: [
					session({ id: 's1', labels: [label('rpi:plan')], last_activity_at: 5n }),
					session({ id: 's2', labels: [label('rpi:research')], last_activity_at: 3n }),
				],
			},
		]
		const card = buildKanbanColumns({ tasks, resolveOwner, unreadSessionIds: new Set(['s2']) }).find(
			(c) => c.id === 'planning',
		)?.cards[0]
		expect(card?.isUnread).toBe(true)
	})

	test('does not mark a card unread for an archived unread session', () => {
		const tasks: KanbanTaskInput[] = [
			{
				id: 't1',
				name: 'Only archived session is unread',
				resource_owner_user_id: 'u1',
				sessions: [
					session({ id: 's1', labels: [label('rpi:plan')], last_activity_at: 5n }),
					session({ id: 's2', archived: true, last_activity_at: 9n }),
				],
			},
		]
		const card = buildKanbanColumns({ tasks, resolveOwner, unreadSessionIds: new Set(['s2']) }).find(
			(c) => c.id === 'planning',
		)?.cards[0]
		expect(card?.isUnread).toBe(false)
	})

	test('card is not unread when no unreadSessionIds are provided', () => {
		const tasks: KanbanTaskInput[] = [
			{
				id: 't1',
				name: 'No unread state',
				resource_owner_user_id: 'u1',
				sessions: [session({ id: 's1', labels: [label('rpi:plan')], last_activity_at: 5n })],
			},
		]
		const card = buildKanbanColumns({ tasks, resolveOwner }).find((c) => c.id === 'planning')?.cards[0]
		expect(card?.isUnread).toBe(false)
	})

	test('non-draft task card is not marked as draft', () => {
		const tasks: KanbanTaskInput[] = [
			{ id: 't1', name: 'Launched', is_draft: false, resource_owner_user_id: 'u1', sessions: [] },
		]
		const todo = buildKanbanColumns({ tasks, resolveOwner }).find((c) => c.id === 'todo')
		expect(todo?.cards[0]?.isDraft).toBe(false)
	})
})
