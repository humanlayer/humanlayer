import type { Session } from '@humanlayer/db/tables/sessions'
import { beforeEach, describe, expect, it } from 'vitest'

import { chooseTaskSession, rememberedSession, rememberSession } from './task-navigation'

const sessions = [
	{ id: 'old', archived: false, status: 'ready_for_input', created_at: 1, updated_at: 50, last_activity_at: 50 },
	{ id: 'new', archived: false, status: 'ready_for_input', created_at: 2, updated_at: 20, last_activity_at: 20 },
	{ id: 'archive', archived: true, status: 'ready_for_input', created_at: 3, updated_at: 100, last_activity_at: 100 },
	{ id: 'draft', archived: false, status: 'draft', created_at: 4, updated_at: 200, last_activity_at: 200 },
] as unknown as Session[]

beforeEach(() => localStorage.clear())
describe('task landing selection', () => {
	it('prefers last-used active session, otherwise latest activity rather than newest creation', () => {
		expect(chooseTaskSession(sessions)?.id).toBe('old')
		expect(chooseTaskSession(sessions, undefined, 'new')?.id).toBe('new')
		expect(chooseTaskSession(sessions, undefined, 'archive')?.id).toBe('old')
		expect(chooseTaskSession(sessions, undefined, 'missing')?.id).toBe('old')
	})
	it('honors archived links and does not silently replace an inaccessible explicit session', () => {
		expect(chooseTaskSession(sessions, 'archive', 'new')?.id).toBe('archive')
		expect(chooseTaskSession(sessions, 'missing', 'new')).toBeNull()
		expect(chooseTaskSession([])).toBeNull()
	})
	it('remembers the session separately for each task', () => {
		rememberSession('one', 'new')
		rememberSession('two', 'old')
		expect(rememberedSession('one')).toBe('new')
		expect(rememberedSession('two')).toBe('old')
	})
})
