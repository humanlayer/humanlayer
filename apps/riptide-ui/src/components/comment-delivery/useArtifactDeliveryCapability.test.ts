import type { Session } from '@humanlayer/db/tables/sessions'
import { describe, expect, test } from 'vitest'

import { getArtifactDeliveryCapability } from './useArtifactDeliveryCapability'

function session(status: string, taskId = 'task-1'): Pick<Session, 'id' | 'task_id' | 'status'> {
	return { id: 'session-1', task_id: taskId, status: status as Session['status'] }
}

describe('getArtifactDeliveryCapability', () => {
	test.each(['ready_for_input', 'interrupted', 'failed', 'lost'])('uses immediate send for %s', (status) => {
		expect(getArtifactDeliveryCapability(session(status), 'task-1')).toEqual({
			kind: 'send',
			sessionId: 'session-1',
		})
	})

	test.each(['running', 'needs_approval'])('uses queue for %s', (status) => {
		expect(getArtifactDeliveryCapability(session(status), 'task-1')).toEqual({
			kind: 'queue',
			sessionId: 'session-1',
		})
	})

	test.each(['launching', 'resuming', 'waiting_for_agent', 'interrupt_requested'])('uses copy for %s', (status) => {
		expect(getArtifactDeliveryCapability(session(status), 'task-1')).toEqual({ kind: 'copy' })
	})

	test('does not guess another session for the task-level or mismatched-task context', () => {
		expect(getArtifactDeliveryCapability(null, 'task-1')).toEqual({ kind: 'copy' })
		expect(getArtifactDeliveryCapability(session('running', 'task-2'), 'task-1')).toEqual({ kind: 'copy' })
	})
})
