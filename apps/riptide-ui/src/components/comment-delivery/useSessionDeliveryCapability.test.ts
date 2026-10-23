import type { Session } from '@humanlayer/db/tables/sessions'
import { describe, expect, test } from 'vitest'

import { getSessionDeliveryCapability } from './useSessionDeliveryCapability'

const session = (status: string): Pick<Session, 'id' | 'status'> => ({
	id: 'session-1',
	status: status as Session['status'],
})

describe('getSessionDeliveryCapability', () => {
	test.each(['ready_for_input', 'interrupted', 'failed', 'lost'])('sends to an agent idle in %s', (status) => {
		expect(getSessionDeliveryCapability(session(status))).toEqual({ kind: 'send', sessionId: 'session-1' })
	})

	test.each(['running', 'needs_approval', 'waiting_for_usage_limit'])('queues behind an agent in %s', (status) => {
		expect(getSessionDeliveryCapability(session(status))).toEqual({ kind: 'queue', sessionId: 'session-1' })
	})

	test.each(['launching', 'resuming', 'waiting_for_agent', 'interrupt_requested'])(
		'copies rather than reach an agent in %s',
		(status) => {
			expect(getSessionDeliveryCapability(session(status))).toEqual({ kind: 'copy' })
		},
	)

	test('copies when there is no session at all', () => {
		expect(getSessionDeliveryCapability(null)).toEqual({ kind: 'copy' })
	})

	test('asks nothing about the task, so a session without one still sends', () => {
		expect(getSessionDeliveryCapability({ id: 'session-1', status: 'ready_for_input' })).toEqual({
			kind: 'send',
			sessionId: 'session-1',
		})
	})
})
