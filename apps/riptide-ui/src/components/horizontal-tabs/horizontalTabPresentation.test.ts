import { describe, expect, test } from 'vitest'

import { getHorizontalTabPresentation, getHorizontalTabRoute } from './horizontalTabPresentation'

describe('horizontal tab presentation', () => {
	test('classifies task and session routes without confusing creation flows', () => {
		expect(getHorizontalTabRoute('/tasks/task-a?artifactId=artifact-a#comment-a')).toEqual({
			kind: 'task',
			taskId: 'task-a',
		})
		expect(getHorizontalTabRoute('/sessions/session-a')).toEqual({ kind: 'session', sessionId: 'session-a' })
		expect(getHorizontalTabRoute('/tasks/new')).toMatchObject({ kind: 'page', metadata: { label: 'New Task' } })
		expect(getHorizontalTabRoute('/sessions/draft')).toMatchObject({
			kind: 'page',
			metadata: { label: 'New Session' },
		})
	})

	test('uses live task names and gives task status priority over unread', () => {
		expect(
			getHorizontalTabPresentation({
				href: '/tasks/task-a',
				task: { name: 'Fix horizontal tabs' },
				taskSessions: [{ status: 'running', lastActivityAt: 10n }],
				isTaskUnread: true,
			}),
		).toEqual({
			label: 'Fix horizontal tabs',
			icon: 'tasks',
			indicator: { kind: 'task-status', status: 'running' },
		})
	})

	test('uses unread when a session has no visible status indicator', () => {
		expect(
			getHorizontalTabPresentation({
				href: '/sessions/session-a',
				session: { title: '', summary: 'Review pull request', status: 'ready_for_input', lastActivityAt: 10n },
				isUnread: true,
			}),
		).toEqual({
			label: 'Review pull request',
			icon: 'session',
			indicator: { kind: 'unread' },
		})
	})

	test('provides stable metadata for non-record pages', () => {
		expect(getHorizontalTabPresentation({ href: '/sessions?tab=drafts' })).toEqual({
			label: 'Drafts',
			icon: 'draft',
			indicator: { kind: 'none' },
		})
		expect(getHorizontalTabPresentation({ href: '/sessions?tab=context-shards' })).toEqual({
			label: 'Context Shards',
			icon: 'context-shards',
			indicator: { kind: 'none' },
		})
		expect(getHorizontalTabPresentation({ href: '/archive/tasks' })).toEqual({
			label: 'Archived Tasks',
			icon: 'archive',
			indicator: { kind: 'none' },
		})
	})
})
