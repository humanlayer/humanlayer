import { describe, expect, it } from 'vitest'

import { boardCounterpart, minimalistLayoutOverride, supportsMinimalistLayout } from './use-minimalist-layout'

describe('minimalist route boundary', () => {
	it.each([
		'/',
		'/tasks/task-id',
		'/sessions/session-id',
		'/pull-requests',
		'/board',
		'/artifacts',
		'/settings/experiments',
		'/settings/daemons',
		'/archive/tasks',
		'/archive/sessions',
	])('supports %s', (path) => {
		expect(supportsMinimalistLayout(path)).toBe(true)
	})
	it.each([
		'/auth/signin',
		'/auth/organizations/select',
		'/shared/artifacts/key',
		'/sessions',
		'/tasks/new',
		'/sessions/draft',
	])('preserves the existing route tree for %s', (path) => {
		expect(supportsMinimalistLayout(path)).toBe(false)
	})
	it.each(['comment', 'commentId', 'tab'])('preserves %s deep links and task lists', (key) => {
		expect(supportsMinimalistLayout('/tasks/task-id', { [key]: 'value' })).toBe(false)
	})
	it('opens document links, with or without a comment, and diff links in the side panel', () => {
		expect(supportsMinimalistLayout('/tasks/task-id', { artifactId: 'a' })).toBe(true)
		expect(supportsMinimalistLayout('/tasks/task-id', { artifactId: 'a', commentId: 'c' })).toBe(true)
		expect(supportsMinimalistLayout('/tasks/task-id', { diffFileId: 'f', diffCommentId: 'c' })).toBe(true)
		expect(supportsMinimalistLayout('/sessions/session-id', { diffCommentId: 'c' })).toBe(true)
		expect(supportsMinimalistLayout('/tasks/task-id', { focus: 'workspace' })).toBe(true)
	})
})

describe('minimal_ui override', () => {
	it.each([
		[true, true],
		['true', true],
		[false, false],
		['false', false],
		[undefined, undefined],
		['yes', undefined],
	])('reads %s as %s', (value, expected) => {
		expect(minimalistLayoutOverride({ minimal_ui: value })).toBe(expected)
	})
	it('accepts the short minui flag', () => {
		expect(minimalistLayoutOverride({ minui: 'true' })).toBe(true)
		expect(minimalistLayoutOverride({ minui: 'false' })).toBe(false)
	})
})

describe('switching interfaces from a board', () => {
	it('opens the minimalist board from the standard tasks page in board layout', () => {
		expect(boardCounterpart('/', {}, true, 'board')).toBe('/board')
		expect(boardCounterpart('/', { tab: 'tasks' }, true, 'board')).toBe('/board')
		expect(boardCounterpart('/', { tab: 'kanban' }, true, 'list')).toBe('/board')
	})
	it('keeps the minimalist home for the list layout and other tabs', () => {
		expect(boardCounterpart('/', {}, true, 'list')).toBeNull()
		expect(boardCounterpart('/', { tab: 'sessions' }, true, 'board')).toBeNull()
		expect(boardCounterpart('/tasks/task-id', {}, true, 'board')).toBeNull()
	})
	it('opens the standard board from the minimalist board', () => {
		expect(boardCounterpart('/board', {}, false, 'list')).toBe('/')
		expect(boardCounterpart('/', {}, false, 'board')).toBeNull()
	})
})
